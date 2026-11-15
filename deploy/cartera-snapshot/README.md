# Etapa 1: descarga de visitas (pendiente de activación)

Estos scripts son una propuesta desplegable; **no se ejecutan desde esta carpeta**.
El temporizador de producción continúa usando el script original. No se ha
contactado Graph ni ejecutado el descargador real durante el desarrollo.

## Archivos

- `listar_adjuntos.py`: copia del descargador existente, con asunto parametrizable,
  token inyectable, timeout HTTP de 60 segundos, paginación de adjuntos y entrada
  al coordinador. Mantiene selección, validación y destino del snapshot.
- `reportes_visitas.py`: coordinador y almacenamiento de visitas. Autentica una vez,
  actualiza primero el snapshot y después procesa cada categoría independientemente.
- `../../tests/cartera-snapshot/test_reportes.py`: pruebas aisladas con datos ficticios.

No se copia la autenticación al repositorio. En producción se reutilizará
`auth_hotmail.py` y su caché existente, sin cambios de permisos Graph.

## Contrato de almacenamiento

Bajo `/home/rony/cartera-snapshot/visitas/{historico,mensual}/`:

- `versiones/<identidad>-<version>/`: archivo original, `metadata.json` y enlace
  `data.json` al archivo original. Carpetas nuevas 0700 y archivos 0600.
- `versiones/<identidad>`: índice de la copia procesada por mensaje/adjunto.
- `ultimo`: enlace reemplazado atómicamente al bundle completo.

Rutas estables para la próxima etapa:
`visitas/historico/ultimo/data.json` y `visitas/mensual/ultimo/data.json`.
Los metadatos correspondientes están en `ultimo/metadata.json`.
Un consumidor que necesite ambos debe resolver `ultimo` una vez y leer ambos
archivos desde ese directorio resuelto, para evitar mezclar versiones concurrentes.

Metadatos: message_id, attachment_id, name, received_at, sha256, records y
processed_at (UTC). Antes de omitir una descarga se verifican la copia, su hash,
identidad, cantidad de registros y estructura. Se conservan versiones incluso
cuando reutilizan el mismo nombre original. No hay eliminación automática.

Los asuntos se filtran con `subject eq` y las visitas también se comparan
literalmente en Python. Los patrones distinguen histórico y mensual. Se recorren
mensajes del más reciente al más antiguo hasta encontrar una copia válida.
Cada error de candidato se registra sin volcar contenido o cuerpos HTTP.
Si hubo errores, la ejecución devuelve fallo aunque pudiera recuperar uno anterior.

Se acepta arreglo vacío (un mes puede no tener visitas). Cada fila exige ID
entero positivo o texto decimal positivo, o ItemInternalId de texto no vacío;
Terminal debe ser texto no vacío, nunca se convierte desde números. No se
filtran técnicos ni se deduplica por Terminal, ni se transforma el contenido.
Se rechazan explícitamente NaN, Infinity y -Infinity en cualquier campo.
Los campos restantes se conservan sin modificar. Esta validación estructural no
comprueba el significado de fechas ni constituye una importación de visitas.

El bloqueo Linux `flock` abarca autenticación y las tres categorías. Una ejecución
simultánea termina sin trabajar. El snapshot siempre se procesa antes de iniciar
el presupuesto de visitas. Las dos visitas comparten **120 segundos** por defecto,
configurables mediante `VISITAS_PRESUPUESTO_SEGUNDOS` (número finito positivo).
El valor predeterminado no requiere cambiar systemd ni su entorno.

El límite combina reloj monotónico, comprobaciones entre operaciones y una alarma
`SIGALRM`/`ITIMER_REAL` en el hilo principal de Linux. Cada solicitud HTTP usa el
menor entre 60 segundos y el tiempo restante; la alarma también interrumpe una
lectura lenta, paginación o validación que consuma el presupuesto. No hay procesos
o hilos en segundo plano. La alarma se desarma al salir y se restaura el manejador.
Si ya existía otra alarma, se rechaza la etapa de visitas sin reemplazarla.
Al agotarse el tiempo se registra `presupuesto_agotado`, se devuelve salida 1 y
se preservan las publicaciones completas anteriores. Puede quedar un bundle
incompleto no publicado, que no se reutiliza como copia válida. El próximo ciclo
vuelve a buscar candidatos y reutiliza las copias completas verificadas; no se
persiste un cursor de paginación. Si histórico consume repetidamente todo el
presupuesto, mensual puede seguir pendiente: revisar latencia y dimensionar el
presupuesto en la prueba controlada, sin sacrificar la prioridad del snapshot.

No hay reintentos HTTP internos; cualquier intento futuro debe permanecer dentro
del mismo contexto de presupuesto. El siguiente ciclo del temporizador vuelve a
intentar. No se modifica TimeoutStartUSec. El tiempo del snapshot/autenticación
sigue teniendo su comportamiento previo; este límite solo abarca visitas.
Como cualquier timeout en espacio de usuario, depende de la planificación del SO;
no garantiza un corte inmediato durante una espera de kernel no interrumpible.
La autenticación mantiene el mecanismo
MSAL existente, incluido el flujo interactivo si la caché deja de ser utilizable.

## Validación y activación pendiente

Pruebas, desde la raíz del repositorio:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/cartera-snapshot -v
```

Se creó copia con permisos preservados del script original, fuera de Git:
`/home/rony/cartera-snapshot/backups/etapa1-20261016T130055Z/listar_adjuntos.py`.
No contiene la caché MSAL ni se copiaron credenciales al repositorio.

Después de revisión y autorización, habrá que instalar ambos scripts juntos en
`/home/rony/cartera-snapshot`, coordinando la sustitución con el temporizador para
que no observe una instalación parcial. No hace falta cambiar el servicio ni el
temporizador: el ExecStart existente sigue apuntando a listar_adjuntos.py y se
mantienen los 15 minutos. El próximo ciclo tras instalar ya activaría las visitas;
por eso no se han sustituido los scripts activos en esta etapa.

No se modifican snapshot.json, caché, PostgreSQL, API, frontend ni PWA. La vuelta
atrás consistiría en restaurar el script respaldado, dejando los nuevos datos
separados para revisión. No ejecutar comandos de activación sin autorización.

## Permisos y futura instalación (no ejecutada)

Se crea y corrige `visitas/`, ambas categorías, `versiones/` y los bundles con
0700, incluso si existían con permisos más amplios. Los archivos regulares bajo
visitas se corrigen a 0600; los temporales se crean con mkstemp (0600). No se
siguen enlaces en la reparación y se rechazan archivos con enlaces duros para
no cambiar permisos de archivos externos. Los enlaces simbólicos de publicación
no tienen permisos efectivos propios: sus destinos están protegidos. No se
cambian permisos del directorio base ni de otros directorios de la automatización.

Después de autorizar y coordinar la instalación con el temporizador, preparar
ambos scripts como usuario rony usando `install -m 0600` en nombres temporales
del mismo directorio activo. Publicar primero reportes_visitas.py y por último
listar_adjuntos.py mediante renombrado. No usar una copia que herede 0664 del
repositorio. No hace falta permiso de ejecución: systemd invoca Python.
Mantener todos los directorios de visitas en 0700 y no copiar datos ni cachés.
Estos son requisitos de instalación; no se ha instalado ni activado nada.

Validación de las correcciones: 23 pruebas satisfactorias (las 12 originales y
11 nuevas), con datos simulados y directorios temporales. Incluyen presupuesto
compartido/configurable, interrupción real de lectura lenta, paginación con reloj
simulado, reintento posterior, preservación del snapshot y último reporte válido,
constantes JSON no estándar, permisos existentes/generados/temporales y enlaces
externos sin modificación de sus destinos.
