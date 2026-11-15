# Aplicación controlada de 005 en Ubuntu — preparado, NO ejecutado

## Identidades comprobadas y requisitos

- Servidor PostgreSQL 17, socket `/var/run/postgresql`, puerto 5432.
- Base real: `cartera_clientes`, propiedad de `postgres`.
- API real: `cartera_clientes_api`, sin superusuario, CREATEDB, CREATEROLE ni CREATE
  sobre public. Conservar sus permisos existentes de cartera.
- Nuevo rol propuesto (no existe todavía): `cartera_clientes_visitas_import`.
  LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
  NOBYPASSRLS y límite de dos conexiones. No será propietario ni miembro de otros roles.
- Los objetos de visitas continúan perteneciendo a `postgres`.
- Respaldo original protegido y restauración confirmada por el operador: 1003
  terminales, 3 fotografías/322212 bytes BYTEA, 25750 historiales, 9 tablas,
  29 índices y 5 secuencias. No eliminar esa copia ni la base de comprobación.

El usuario confirmó la restauración; el informe original del respaldo aún puede
indicar que la restauración estaba pendiente. Este procedimiento no lo sobrescribe.

Se cotejó la migración con GitHub `main` y con el merge
`65e47c047a6e7e7f0665cfeb6d05d1f84af13619`: contenido idéntico al archivo local.
SHA-256 obligatorio:

```
acb01b8902b8d25761ab8d74032ee18e11003bb6679adc2a88b70ee89aa86f5c
```

No hace falta editar la migración para cambiar propietarios. `admin-005.py` usa su
contenido verificado y los GRANT explícitos, parametrizados con los nombres reales.
Los BEGIN/COMMIT del archivo se integran en una sola transacción con la creación
del rol y los grants; un error SQL antes de COMMIT revierte todas esas operaciones.

## Permisos nuevos exactos

| Objeto | API | Importador |
| --- | --- | --- |
| Base cartera_clientes | CONNECT existente | CONNECT |
| Esquema public | USAGE existente, sin CREATE | USAGE, sin CREATE |
| Vista visitas_tecnicas | SELECT de id, terminal, fecha y tecnico | Sin grant directo |
| visitas_reportes e importaciones_visitas | SELECT | SELECT, INSERT, UPDATE |
| visitas_fuentes y visitas_actuales | Sin acceso directo | SELECT, INSERT, UPDATE |
| importaciones_visitas_id_seq | Sin acceso | USAGE, sin UPDATE |

Ningún DELETE, TRUNCATE ni DDL para el importador; ningún INSERT/UPDATE/DELETE
sobre visitas para la API. No se conceden privilegios sobre terminales, historial,
fotografías u otros objetos existentes. La vista no incluye JSONB privado.

Los derechos PUBLIC de PostgreSQL pueden permitir CONNECT a otras bases y TEMP;
no equivalen a acceso a sus tablas ni a administración. No se cambia PUBLIC de
bases existentes para imponer una política global. Si se requiere restringir la
conexión del rol a una sola base a nivel de autenticación, revisarlo por separado;
este procedimiento no edita pg_hba.conf ni credenciales existentes.

## Ejecución posterior, únicamente con autorización

Ejecutar como **rony en la terminal habitual de Ubuntu**, no mediante `sudo python3`.
`sudo -v` debe autorizarse allí; el ticket puede no existir en la terminal de Codex.
El script solo usa `sudo -n`: si falta el ticket, termina sin solicitar contraseña.

1. Preflight de lectura, sin crear archivos privados, rol ni objetos SQL:

```bash
cd /home/rony/cartera-clientes
sudo -v
python3 -B deploy/visitas/admin-005.py --check
```

Revisar que database/user sean cartera_clientes/postgres, propietario postgres,
PostgreSQL 17, objetos/tipos de 005 ausentes, rol importador ausente y API sin CREATE.
El script comprueba el checksum del respaldo y el de la migración sin actualizar
Git ni cambiar de rama. Aborta si la instalación no está limpia. Una migración ya
aplicada no se debe repetir. Tampoco reutiliza silenciosamente un rol ya existente.

2. Aplicar rol, migración y grants juntos:

```bash
python3 -B deploy/visitas/admin-005.py --apply --confirm cartera_clientes:005
```

El comando incluye todos los CREATE ROLE, ALTER ROLE, DDL y GRANT necesarios. La
contraseña aleatoria se genera en memoria y solo se envía a psql por stdin; nunca
va en argumentos, mensajes de salida ni Git. PostgreSQL almacena el verificador SCRAM; la contraseña se transmite a psql por stdin local.
El rol tiene statement_timeout=60s, lock_timeout=5s e idle_in_transaction=120s
solo para esta base. El script tiene un lock de administración y esperas limitadas.

Antes de COMMIT verifica:

- 4 tablas, 1 vista, 1 secuencia y 12 índices (8 explícitos y 4 PK), todos de postgres.
- Índices válidos/listos y restricciones validadas.
- Las cuatro tablas vacías: no ejecuta ninguna importación.
- Privilegios efectivos de API/importador, acceso PUBLIC ausente y ninguna membresía
  ni acceso del importador a tablas ajenas a visitas.

La credencial se prepara primero como archivo privado pendiente; al confirmar la
transacción pasa a:

```
/home/rony/cartera-visitas-private/importador.env
```

Directorio 0700 y archivo 0600, propiedad de rony. Contiene DB_HOST/PORT/NAME/USER,
la contraseña nueva y ambos flags VISITAS_ENABLED/VISITAS_IMPORT_ENABLED en false.
No se modifica `.env` de la API ni se instala ninguna unidad systemd. No mostrar
este archivo, ni usar `set -x`, `cat` o registros de entorno para diagnosticarlo.

El script verifica después una conexión TCP de **solo lectura** con el rol nuevo,
usando la credencial privada sin mostrarla. Si la política pg_hba existente impide
esa conexión, informa que la migración ya quedó confirmada y se detiene: no cambia
la autenticación ni se debe repetir --apply. La configuración de autenticación
real del rol nuevo no puede comprobarse antes de que exista.

3. Inspección posterior:

```bash
python3 -B deploy/visitas/admin-005.py --check
```

Muestra los objetos/propietarios, índices, atributos del rol, permisos efectivos
por tabla/columna y resultado de la conexión privada si existe el archivo. No
muestra contraseñas. Verificar además la salud de cartera con el procedimiento
habitual de la API sin mostrar su API key. La migración no habilita endpoints ni
reinicia PM2. No importar visitas ni activar flags/timers en esta intervención.

## Fallos y reversión sin destruir datos

- **Antes de COMMIT:** PostgreSQL revierte rol y objetos/grants nuevos. El archivo
  `importador.env.pending` queda conservado para diagnóstico privado; no reintentar
  automáticamente ni borrarlo sin comprobar el estado real.
- **Resultado incierto o fallo tras COMMIT:** ejecutar --check en una nueva conexión.
  No asumir rollback por una interrupción de red, timeout o fallo al renombrar el
  archivo. Si el rol/objetos existen y solo quedó .pending, preservar ese archivo
  secreto y revisar la recuperación; el script se niega a sobrescribirlo.
- **Reversión operativa posterior:** mantener ambos flags false y sin programar el
  importador. Si hay una programación futura, su parada requiere una intervención
  separada; este script no toca servicios ni termina sesiones.

Para bloquear nuevas conexiones del importador y quitar escritura, conservando
rol, credencial y todos los objetos/datos:

```bash
sudo -v
python3 -B /home/rony/cartera-clientes/deploy/visitas/admin-005.py \
  --revoke-importer --confirm cartera_clientes:revoke-importer
python3 -B /home/rony/cartera-clientes/deploy/visitas/admin-005.py --check
```

La reversión usa ALTER ROLE NOLOGIN y REVOKE de INSERT/UPDATE y USAGE de secuencia.
Aborta si hay sesiones del importador, para no interrumpirlas. No borra objetos,
no restaura sobre producción, no revoca permisos anteriores de cartera y no modifica
el acceso de descarga de etapa 1. La reactivación requerirá autorización y un plan
explícito de reposición de grants; no se hace reaplicando 005.

## Validación de esta preparación

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s deploy/visitas -p test_admin_005.py -v
```

Ocho pruebas offline con subprocess simulado y carpetas temporales: modo lectura
predeterminado, confirmación obligatoria, destino limpio, límites transaccionales,
permisos/secretos, errores sin exposición y reversión no destructiva. No ejecutan
SQL, crean roles ni conectan a producción. La migración y sus grants básicos ya
fueron probados en PostgreSQL aislado durante la revisión del PR #5; el nuevo
wrapper administrativo no se ha ejecutado realmente con --apply.
