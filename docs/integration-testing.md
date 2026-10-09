# Pruebas de integración PostgreSQL

Esta suite ejecuta el motor de snapshots y la API HTTP contra PostgreSQL real. Usa exclusivamente datos sintéticos, no envía correos y no inicia el servicio PM2. No debe apuntar nunca a la base de producción `cartera_clientes`.

## Salvaguardas

La conexión solo se obtiene de `TEST_DATABASE_URL`; no existe fallback a `DATABASE_URL`, `DB_NAME` ni otras variables de producción. También es obligatorio declarar `TEST_DATABASE_NAME`, que debe coincidir con `current_database()` y con el nombre incluido en la URL. Se rechazan `cartera_clientes`, `postgres`, `template0` y `template1`.

Los scripts no crean ni eliminan bases o roles. La limpieza verifica de nuevo la identidad y el esquema, y luego ejecuta un `TRUNCATE` de las tablas conocidas dentro de una transacción. Esto elimina todos los datos de la base aislada, por lo que esa base debe dedicarse exclusivamente a la suite.

## Preparación aislada en Ubuntu

Crear una base y un rol exclusivos desde una sesión administrativa de PostgreSQL. Sustituye la contraseña de ejemplo y no reutilices credenciales de producción:

```sql
CREATE ROLE cartera_test LOGIN PASSWORD 'UNA_CONTRASEÑA_EXCLUSIVA_DE_PRUEBAS';
CREATE DATABASE cartera_clientes_pruebas OWNER cartera_test;
```

En `apps/api/.env`, además de la configuración normal de desarrollo, define:

```env
TEST_DATABASE_URL=postgresql://cartera_test:UNA_CONTRASEÑA_EXCLUSIVA_DE_PRUEBAS@127.0.0.1:5432/cartera_clientes_pruebas
TEST_DATABASE_NAME=cartera_clientes_pruebas
```

`.env` está ignorado por Git. No pongas contraseñas reales en `.env.example`, comandos compartidos, capturas o commits.

Instala dependencias y aplica las migraciones existentes únicamente a la base ya creada:

```sh
cd /ruta/a/cartera-clientes/apps/api
npm ci
npm run test:db:setup
```

El preparador consulta primero `current_database()`, después ejecuta `001_initial_schema.sql` y `002_auth_sessions.sql`. No ejecuta `CREATE DATABASE`, `DROP DATABASE` ni migraciones sobre otra conexión.

## Ejecución

Pruebas unitarias aisladas:

```sh
npm test
```

Pruebas de integración reales:

```sh
npm run test:db:check
npm run test:integration
```

La suite comprueba SQL real, JSONB, claves foráneas, importaciones iniciales y posteriores, historial, cola, conflictos, rollback, bloqueo asesor, umbral de ausencias, sesiones PostgreSQL, roles y CSRF. Limpia los datos sintéticos antes de cada caso y al finalizar. Si faltan las variables o el esquema, falla con instrucciones explícitas.

Para limpiar manualmente solo la base aislada verificada:

```sh
npm run test:db:clean
```

No ejecutes este comando si la base contiene información que quieras conservar.

## Validación de solo lectura del snapshot real

En Ubuntu, configura una ruta privada fuera del repositorio para el snapshot:

```sh
npm run snapshot:validate
```

Para validar otra copia, usa una ruta que no sea de fixtures de producción:

```sh
SNAPSHOT_VALIDATE_PATH=/ruta/solo-lectura/snapshot.json npm run snapshot:validate
```

El comando solo lee y analiza JSON. Informa compatibilidad, cantidad de registros, terminales únicas, tipo de identificador y rango de propiedades; nunca imprime terminales, nombres, teléfonos ni otros valores de clientes, y no abre una conexión PostgreSQL.

Resultado esperado para el snapshot confirmado actualmente: arreglo raíz, 1,000 registros, 1,000 terminales únicas, identificadores de texto y 27 propiedades por registro.

## Precauciones

- Mantén `SNAPSHOT_IMPORT_ENABLED=false` durante validaciones y pruebas. En producción solo debe cambiarse deliberadamente a `true` cuando el administrador vaya a usar la importación manual.
- No uses el usuario, contraseña ni URL de producción.
- No ejecutes el preparador sobre una base con esquema ya instalado: las migraciones no son un sistema de migración repetible.
- La validación del snapshot no equivale a una importación y no comprueba datos contra producción.
- Si una ejecución se interrumpe, vuelve a ejecutar `npm run test:db:clean` únicamente después de verificar las dos variables `TEST_DATABASE_*`.
