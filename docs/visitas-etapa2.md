# Etapa 2: visitas técnicas — pendiente de revisión y activación

## Alcance y compatibilidad

Migración aditiva `005_visitas_tecnicas.sql`. No cambia terminales, relaciones de
Excel, correo, frontend ni el descargador activado en etapa 1. No se ejecutan
importaciones al iniciar Express. No se ha aplicado esta migración a producción.

La nueva funcionalidad HTTP requiere `VISITAS_ENABLED=true` (por defecto false).
Con false, el listado mantiene su respuesta anterior sin consultar tablas nuevas;
las rutas nuevas responden 503 después de autenticar. Esto permite preparar el
código antes de habilitarlo, pero el despliegue debe seguir el orden indicado.

Se inspeccionaron migraciones, sesiones/roles, importación de cartera y el esquema
vivo mediante consultas exclusivamente de metadatos. Se leyeron los reportes
privados únicamente para verificar estructura/tipos/formatos; no se copian a Git.

## Modelo y resolución de diferencias

- `visitas_fuentes`: PK (fuente, ID SharePoint bigint positivo), Terminal de texto,
  Fecha/Modified/recepción timestamptz, técnico, tipo y registro completo JSONB.
  No hay FK a terminales: admite terminales inactivas o desconocidas.
- `visitas_tecnicas`: vista canónica con una sola fila por ID. Gana mayor Modified
  (un valor presente gana a uno ausente), luego recepción del reporte y, en empate,
  mensual sobre histórico. Esta prioridad es independiente del orden de importación.
  No se deduplica por terminal. La misma visita entre fuentes cuenta una sola vez.
- `visitas_reportes`: último hash, cantidad, recepción/procesamiento local y fecha de
  importación exitosa por fuente.
- `importaciones_visitas`: inicio/fin, resultado, código seguro de error y metadatos
  por reporte (hash/cantidad/fechas) de las importaciones completadas.

Se retienen las filas ausentes en reportes nuevos: ninguna importación borra visitas
ni interpreta ausencia como eliminación. En cada fuente también se rechaza retroceder
Modified/recepción de una fila existente. Un reporte con recepción anterior al último
aceptado hace fallar toda la importación. Correcciones con Modified igual y recepción
más reciente se admiten. Un reporte idéntico no reprocesa registros: si cambia su
recepción, solo actualiza la procedencia utilizada para desempatar. Un reintento sin
cambios conserva la fecha de importación exitosa y registra SIN_CAMBIOS.

Una visita previamente ausente puede seguir siendo la ganadora conservada hasta
que llegue una versión más reciente según esta prioridad. Los reportes no contienen
marcas de borrado: las bajas o correcciones administrativas requieren un diseño
posterior y no se deducen de una ventana de tres meses.

## Lectura e importación

El backend resuelve `ultimo` una vez por fuente y lee datos/metadatos desde ese
bundle. Verifica SHA-256, cantidad y fechas, limita tamaño a 30 MiB por archivo y
exige UTF-8 y JSON estrictos, ID único dentro de cada fuente, Terminal/técnico/tipo
de texto y fechas ISO con zona explícita. No convierte Terminal desde números.
Las fechas sin zona o inválidas se rechazan, no se interpretan con la zona del host.

Se validan ambos reportes antes de tocar filas de visitas. Toda modificación de
ambas fuentes, estados y resultado exitoso se confirma en una sola transacción,
con advisory lock exclusivo independiente del usado por cartera. Los errores
revierten las modificaciones y se registran por código seguro en el intento.
Un fallo de PostgreSQL que impida escribir también puede impedir registrar el error;
el ejecutor termina con código 1. SIGKILL puede dejar un intento PROCESANDO, pero
PostgreSQL revierte una transacción no confirmada; el ciclo siguiente reintenta.

## API de lectura

Todas las rutas usan la sesión persistente y verificación de usuario activo existentes:

| Ruta | Acceso y respuesta |
| --- | --- |
| `GET /api/v1/visitas/terminales/:terminal/ultima` | Usuarios autenticados; `{terminal, ultima_visita}`. Terminal desconocida: 404. Inactiva: 404 para usuario normal; ADMIN recibe null. |
| `GET /api/v1/visitas/estadisticas/mensual` | Usuarios autenticados; zona, límites desde/hasta y conteos para RTDOMINGUEZ/ERMEJIA, incluidos ceros. |
| `GET /api/v1/visitas/estado` | Solo ADMIN; estados de ambas fuentes y último intento. No incluye rutas ni registros JSON. |
| `GET /api/v1/terminales` | Con habilitación añade `ultima_visita` mediante agregado MAX y LEFT JOIN en una sola consulta, sin cambiar filtros, paginación ni orden. Inactivas: null. |

No hay endpoint de importación ni acceso HTTP a archivos. `datos` JSONB permanece
privado. No se expone ID SharePoint ni comentarios/datos personales de visitas.
La fecha máxima se calcula sobre todos los datos importados retenidos para cada
terminal activa. Null indica ausencia en los datos disponibles, no ausencia histórica
de mantenimiento. Las estadísticas cuentan visitas por ID, incluidas terminales
inactivas/desconocidas; los técnicos restantes se conservan sin entrar en estos dos
conteos. No se utiliza EsMesActual ni VisitaValidada como filtro implícito.

Los límites del mes se calculan en SQL usando America/Tegucigalpa y CURRENT_TIMESTAMP:
`[inicio_mes, inicio_mes_siguiente)`. Se incluyen fechas futuras del mes actual,
pero no posteriores a su fin. La última visita incluye meses anteriores. El periodo
y los conteos se obtienen en una misma sentencia para evitar cruces de mes.
Los índices cubren ID/resolución, terminal/fecha, técnico/fecha y fecha; conviene
medir EXPLAIN ANALYZE con volumen representativo antes de ampliar la retención.

## Automatización preparada, no activada

`npm run visitas:import` importa ambos archivos locales y exige
`VISITAS_IMPORT_ENABLED=true`. `VISITAS_ROOT` permite un directorio privado alternativo;
por defecto se usa `~/cartera-snapshot/visitas`. El CLI no consulta Graph ni envía
correos. No acepta rutas desde solicitudes HTTP.

`deploy/visitas/*.example` propone servicio oneshot y temporizador independientes
cada cinco minutos: consultar hashes periódicamente evita depender de eventos de
symlinks que pueden perderse. El importador omite cargas de contenido sin cambios.
No se ha instalado ninguna unidad. No se altera cartera-snapshot.timer/service ni
su intervalo. El lock evita concurrencia manual/programada; los procesos terminan
con salida 1 ante error y el siguiente ciclo reintenta ambos reportes.

## Pruebas y preparación para activación posterior

```sh
cd /home/rony/cartera-clientes/apps/api
npm test
# Solo contra una base expresamente aislada y verificada:
npm run test:db:setup
npm run test:integration
```

Configurar TEST_DATABASE_URL/TEST_DATABASE_NAME exclusivamente para una base de
pruebas vacía; jamás usar cartera_clientes, postgres, template0 o template1.
La suite verifica nombre real antes de migrar/truncar. Setup incluye ahora 005.
Las pruebas usan datos sintéticos. La ejecución de desarrollo usó PostgreSQL 17
en un cluster efímero, socket privado y sin escucha TCP, detenido al terminar.

Activación posterior, **solo después de aprobar el PR y autorizar producción**:

1. Respaldar PostgreSQL y comprobar roles/espacio y acceso privado de lectura a bundles.
2. Aplicar únicamente 005 con `psql -v ON_ERROR_STOP=1` bajo el rol de migración;
   conceder SELECT sobre vista y tablas de estado a la API y DML/uso de secuencias
   sobre las tablas nuevas al rol importador. No se requieren privilegios Graph.
   No ejecutar test:db:setup sobre una base existente: instala todo el esquema.
3. Instalar código revisado. Ejecutar una importación controlada con
   VISITAS_IMPORT_ENABLED=true, comprobar tablas/auditoría y hashes sin mostrar JSON.
4. Activar VISITAS_ENABLED=true en la configuración privada y recargar la API
   mediante el procedimiento habitual, con autorización separada. Verificar sesión,
   roles, nulos, estadísticas y listado antes de habilitar la programación.
5. Sustituir la ruta Node de la unidad .example por la del runtime de Ubuntu;
   instalar unidades nuevas revisadas y habilitar el timer de visitas. Mantener
   intactas las unidades de descarga existentes. Vigilar estado y tiempos de importación.

Reversión: detener/deshabilitar solo el nuevo timer de importación y quitar
VISITAS_ENABLED; desplegar la versión anterior de API según el procedimiento
aprobado. Las tablas aditivas pueden conservarse sin afectar cartera; no borrar
visitas ni ejecutar DROP como reversión operativa. Nunca detener la descarga de
etapa 1. La activación del importador es independiente de la habilitación HTTP.

Resultado final de desarrollo: 100 pruebas de API y 23 pruebas PostgreSQL
satisfactorias, sin omisiones. Incluyen regresión previa, prioridad entre fuentes,
contenido repetido, filas retenidas, errores, rollback, concurrencia, sesión/roles,
fechas futuras, cambio de año y febrero bisiesto. El lector también validó ambos
bundles reales en modo de solo lectura, sin importarlos ni copiar sus datos.
Para repetir la integración sin configurar una base persistente:

```sh
python3 /home/rony/cartera-clientes/apps/api/scripts/test-visitas-isolated.py /usr/lib/postgresql/17/bin
```

El script crea y destruye exclusivamente su cluster temporal; necesita los binarios
y pg_trgm ya instalados, no toca servicios systemd ni usa credenciales productivas.
