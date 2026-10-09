# Arquitectura del frontend PWA

## Navegación, sesión y permisos

La pantalla inicial autenticada es Comercios. Móvil usa navegación inferior y escritorio menú lateral. `USUARIO` consulta y edita terminales activas; `ADMIN` también consulta inactivas, administra usuarios y solicita importaciones cuando el servidor las habilite. La API vuelve a aplicar todos los permisos.

La autenticación usa cookie `HttpOnly`, `Secure`, `SameSite=Lax`, `credentials: include` y CSRF conservado solo en memoria. No se almacenan contraseñas, cookies, API keys ni CSRF. La sesión del servidor dura siete días y sigue siendo revocable.

## Datos online y offline

Online, cada búsqueda consulta PostgreSQL con páginas de 20, debounce de 300 ms, filtros y orden servidor; TanStack Query cancela respuestas obsoletas. La preparación offline descarga páginas de 100 y reemplaza IndexedDB solo tras completarse, conservando la copia anterior ante fallos.

IndexedDB separa terminales, preferencias y autorización por usuario. El acceso offline dura 24 horas desde la última autorización online. Logout elimina los datos de ese usuario. Offline es de solo lectura: edición, historial remoto, dashboard, usuarios y sincronización requieren conexión. Hoy se usa descarga completa consistente; la sincronización incremental queda pendiente.

El service worker precachea el shell y dependencias locales. Las llamadas `/api/` son `NetworkOnly` para no guardar respuestas autenticadas en Cache Storage.

## Edición, historial y Excel

`PATCH /api/v1/terminales/:terminal` exige sesión, CSRF y versión. Actualiza PostgreSQL, historial y cola en una transacción. Un conflicto HTTP 409 devuelve la versión vigente sin sobrescribir el formulario local. Terminal e internos no son editables; los campos JSONB desconocidos se muestran y editan automáticamente.

Solo `Celular` tiene contrato confirmado con Power Automate (`ACTUALIZAR_CARTERA|Terminal|Celular`). Otros campos quedan guardados en PostgreSQL e historial como `PENDIENTE_INTEGRACION`; no se presentan como actualizados en Excel. Correo aceptado significa `ENVIADO`, no confirmado: la confirmación depende de un snapshot posterior.

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

Se reutilizan autenticación, usuarios, terminales y sincronizaciones existentes. No hay migraciones nuevas.

El endpoint de filtros devuelve `datos` con valores distintos autorizados y `campos` con nombres JSONB descubiertos. Esto permite buscar y seleccionar columnas nuevas sin codificarlas en el frontend; los usuarios normales solo derivan metadatos de terminales activas.

## Limitaciones verificables

- Fotografías y linterna no tienen integración productiva.
- Campos distintos de `Celular` no tienen transporte Power Automate.
- Las pruebas PostgreSQL reales y pruebas físicas de cámara/offline no se ejecutaron en Windows; deben repetirse en la base aislada y dispositivos objetivo.
- Se prepara el build, pero no se despliega ni cambia Cloudflare, PM2 o Ubuntu.
