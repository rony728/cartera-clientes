# Arquitectura del frontend PWA

## Navegación, sesión y permisos

La pantalla inicial autenticada es Comercios. Móvil usa navegación inferior y escritorio menú lateral. `USUARIO` consulta y edita terminales activas; `ADMIN` también consulta inactivas, administra usuarios y solicita importaciones cuando el servidor las habilite. La API vuelve a aplicar todos los permisos.

La autenticación usa cookie `HttpOnly`, `Secure`, `SameSite=Lax`, `credentials: include` y CSRF conservado solo en memoria. No se almacenan contraseñas, cookies, API keys ni CSRF. La sesión del servidor dura siete días y sigue siendo revocable.

La URL de Comercios es la fuente de verdad para búsqueda, campo, filtros, estado, orden, dirección y página. Al abrir una ficha, el frontend asocia el desplazamiento vertical a una clave canónica de esos parámetros. Esa referencia viaja por ficha y edición y también queda en la entrada actual del historial para soportar Atrás/Adelante. La lista restaura después de tener resultados y únicamente ante coincidencia exacta; un contexto diferente elimina el marcador. No se persiste esta información en servidor ni IndexedDB.

## Datos online y offline

Online, cada búsqueda consulta PostgreSQL con páginas de 20, debounce de 300 ms, filtros y orden servidor; TanStack Query cancela respuestas obsoletas. La preparación offline descarga páginas de 100 y reemplaza IndexedDB solo tras completarse, conservando la copia anterior ante fallos.

IndexedDB separa terminales, preferencias y autorización por usuario. El acceso offline dura 24 horas desde la última autorización online. Logout elimina los datos de ese usuario. Offline es de solo lectura: edición, historial remoto, dashboard, usuarios y sincronización requieren conexión. Hoy se usa descarga completa consistente; la sincronización incremental queda pendiente.

La consulta offline recorre todos los registros de la copia local y aplica primero estado, búsqueda y filtros, luego orden y paginación. La búsqueda general examina Terminal, valores comerciales, `ubicacion_interna` y `referencia_interna`, nunca nombres de propiedades; normaliza mayúsculas y tildes, conserva identificadores como texto y admite nombres de campo equivalentes con diferencias de espacios o acentos. Las opciones de filtros y columnas se obtienen de IndexedDB cuando no hay conexión. Los filtros persistidos en la URL se muestran con un contador y pueden limpiarse desde el estado vacío. Las fichas completas se resuelven directamente por Terminal desde IndexedDB. Los objetos anteriores que todavía no contienen los campos internos siguen siendo válidos, por lo que no fue necesario cambiar la versión del esquema IndexedDB.

La normalización de categorías es una capa de presentación y comparación: recorta espacios externos, compara sin distinguir mayúsculas/minúsculas y agrupa equivalencias seguras. Nunca reescribe `datos_excel`. Offline compara la clave normalizada. Online, como la API conserva filtros exactos, el adaptador consulta cada variante observada, deduplica por Terminal, ordena y pagina en memoria. Así se mantiene el contrato, con el costo documentado de lecturas adicionales cuando un grupo tiene variantes.

TanStack Query trata las lecturas de IndexedDB como operaciones independientes de red (`networkMode: always`). Sin esa opción, su gestor de conectividad pausa también funciones locales y una consulta pendiente podía interpretarse erróneamente como un arreglo vacío. Las consultas de lista, filtros y detalle separan su caché por `user.id` y modo de conexión, por lo que una respuesta online fallida no reemplaza datos locales ni se comparten resultados entre usuarios. Los estados visuales distinguen carga, error de IndexedDB y cero coincidencias.

`AuthProvider` canoniza `user.id` como texto, vuelve a leer la autorización local al recibir el evento `offline` y descarta transiciones asíncronas obsoletas cuando la conectividad cambia rápidamente. IndexedDB usa el mismo identificador textual en autorización, metadatos, preferencias, índice `userId` y claves compuestas. Una autorización local vencida devuelve al inicio de sesión sin borrar automáticamente la cartera; solo logout elimina los datos del usuario.

El service worker precachea el shell y dependencias locales. Las llamadas `/api/` son `NetworkOnly` para no guardar respuestas autenticadas en Cache Storage.

## Edición, historial y Excel

`PATCH /api/v1/terminales/:terminal` exige sesión, CSRF y versión. Actualiza PostgreSQL e historial en una transacción. Un conflicto HTTP 409 devuelve la versión vigente sin sobrescribir el formulario local. Terminal y campos técnicos no son editables. Los 23 campos configurados en Power Automate se pueden editar; campos JSONB desconocidos continúan visibles, pero son de solo lectura. `ubicacion_interna` y `referencia_interna` son columnas nulas de `terminales`, se editan por el mismo endpoint y generan historial PWA sin crear cola, correo ni conflicto de Excel.

Cada guardado transmite únicamente las diferencias efectivas de campos Excel en un correo `ACTUALIZAR_CARTERA_V2`, aunque cambien varios campos. Los cambios internos quedan fuera del mensaje, incluso en una edición mixta. La PWA distingue el guardado solo interno (`NO_APLICA`) de `ENVIADO`, `ERROR` o `INCIERTO`. Correo aceptado significa `ENVIADO`, no confirmado: la confirmación depende de un snapshot posterior. El endpoint V1 de `Celular` se conserva, pero no interviene en el flujo de edición. Consulta [power-automate-v2.md](power-automate-v2.md).

La importación ignora defensivamente nombres internos que pudieran aparecer en un snapshot y solo reemplaza `datos_excel`; por ello nunca sobrescribe las columnas internas. La migración `003_internal_terminal_fields.sql` agrega ambas columnas sin `NOT NULL`, valores por defecto ni actualización masiva.

## Exportación, escáner y fotografías

La exportación obtiene todos los resultados coincidentes, respeta filtros/permisos/columnas, preserva identificadores como texto y neutraliza fórmulas. Offline exporta la copia autorizada disponible y lo indica en el nombre.

ZXing se carga bajo demanda, funciona desde recursos instalados y procesa video solo en el dispositivo. Permite seleccionar cámara, maneja permisos denegados y ofrece linterna únicamente cuando `MediaTrackCapabilities` informa soporte; queda pendiente su validación física por dispositivo.

`CommercePhoto` define estados `empty`, `loading`, `error` y `ready`; hoy la ficha muestra vacío y carga deshabilitada. Contrato futuro: binario y metadatos independientes del JSON Excel, asociados a `Terminal`, con GET/POST autenticados, límites MIME/tamaño, autorización, auditoría y reemplazo atómico. Un snapshot o inactivación nunca debe borrar la foto.

## API añadida

- `GET /api/v1/terminales/filtros/opciones`
- `GET /api/v1/terminales/dashboard/resumen`
- `GET /api/v1/terminales/:terminal/historial`
- `PATCH /api/v1/terminales/:terminal`
- `POST /api/v1/auth/password`

Se reutilizan autenticación, usuarios, terminales y sincronizaciones existentes. La única migración de esta etapa es `003_internal_terminal_fields.sql`.

El Dashboard muestra la importación solo a `ADMIN`. Solicita confirmación antes del POST, envía `confirmar_importacion: true` con el token CSRF en memoria y, si el servidor detecta más del 10% de ausencias, exige una segunda confirmación antes de reenviar `confirmar_inactivacion_masiva: true`.

El endpoint de filtros devuelve `datos` con valores distintos autorizados y `campos` con nombres JSONB descubiertos. Esto permite buscar y seleccionar columnas nuevas sin codificarlas en el frontend; los usuarios normales solo derivan metadatos de terminales activas.

## Limitaciones verificables

- Fotografías y linterna no tienen integración productiva.
- No se ha ejecutado desde este repositorio una prueba funcional extremo a extremo con el flujo y Excel reales; la aceptación de Graph no la sustituye.
- Las pruebas PostgreSQL reales y pruebas físicas de cámara no se ejecutaron en Windows; deben repetirse en la base aislada y dispositivos objetivo. La transición completa online → offline → online, búsqueda, paginación y apertura de fichas sí se cubren con los componentes React, `AuthProvider`, cliente API, TanStack Query e IndexedDB simulado, incluida una copia sintética de 1,000 registros.
- Se prepara el build, pero no se despliega ni cambia Cloudflare, PM2 o Ubuntu.
- No hay Playwright ni infraestructura E2E visual en el repositorio. La responsividad se protege con estructura CSS y pruebas de comportamiento, pero los anchos 360/390/430/768/1366, teclado virtual, áreas seguras, selección por pulsación prolongada y gestos deben confirmarse manualmente en dispositivos/navegadores objetivo.
