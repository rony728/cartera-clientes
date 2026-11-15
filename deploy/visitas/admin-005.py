#!/usr/bin/env python3
"""Preparado para ejecutar manualmente en Ubuntu; por defecto solo lee.
No invocar con sudo: ejecutar como rony, con sudo -v en la misma terminal.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'database/migrations/005_visitas_tecnicas.sql'
MIGRATION_SHA = 'acb01b8902b8d25761ab8d74032ee18e11003bb6679adc2a88b70ee89aa86f5c'
BACKUP = Path('/home/rony/cartera-clientes-backups/pre005-20261016-082137-ZoatgX/cartera_clientes.dump')
BACKUP_SHA = '197a3527e1607b40a2dda52ee9d171022528cc44c34ea004a834238cc756822a'
PRIVATE = Path('/home/rony/cartera-visitas-private')
API = 'cartera_clientes_api'
IMPORTER = 'cartera_clientes_visitas_import'
TABLES = ['importaciones_visitas', 'visitas_reportes', 'visitas_fuentes', 'visitas_actuales']
VIEW = 'visitas_tecnicas'
SEQUENCE = 'importaciones_visitas_id_seq'
INDEXES = ['ix_visitas_resolucion', 'ix_visitas_terminal_fecha', 'ix_visitas_tecnico_fecha',
           'ix_visitas_fecha', 'ix_importaciones_visitas_inicio', 'ix_visitas_actuales_terminal_fecha',
           'ix_visitas_actuales_tecnico_fecha', 'ix_visitas_actuales_fecha'] + [t + '_pkey' for t in TABLES]
RELATIONS = TABLES + [VIEW, SEQUENCE] + INDEXES


def digest(path):
    sha = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            sha.update(chunk)
    return sha.hexdigest()


def psql(sql):
    # SQL/credencial solo por stdin. Nunca imprimir stderr, que podría repetir SQL.
    command = ['sudo', '-n', '-u', 'postgres', '/usr/lib/postgresql/17/bin/psql',
               '-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
               '-h', '/var/run/postgresql', '-p', '5432', '-U', 'postgres', '-d', 'cartera_clientes']
    result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=180,
                            env={'PATH': os.environ.get('PATH','/usr/bin:/bin'), 'HOME': str(Path.home()),
                                 'LANG':'C.UTF-8', 'PGCONNECT_TIMEOUT':'5'})
    if result.returncode:
        raise RuntimeError('PSQL_FALLO: no se mostrará SQL ni credenciales. Revisar acceso sudo -n y estado con --check. No reintentar --apply a ciegas.')
    return result.stdout.strip()


def quoted_list(items):
    return ','.join("'" + item + "'" for item in items)


def state():
    objects = quoted_list(RELATIONS)
    sql = f"""BEGIN READ ONLY;
SELECT json_build_object(
 'database',current_database(),'user',current_user,'version',current_setting('server_version'),
 'database_owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
 'roles',(SELECT json_agg(json_build_object('name',rolname,'superuser',rolsuper,'createdb',rolcreatedb,
   'createrole',rolcreaterole,'inherit',rolinherit,'login',rolcanlogin,'replication',rolreplication,
   'bypassrls',rolbypassrls,'connection_limit',rolconnlimit)) FROM pg_roles WHERE rolname IN ('{API}','{IMPORTER}')),
 'objects',COALESCE((SELECT json_agg(json_build_object('name',relname,'kind',relkind,'owner',pg_get_userbyid(relowner)))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ({objects})),'[]'::json),
 'types',COALESCE((SELECT json_agg(typname) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
   WHERE n.nspname='public' AND typname IN ({quoted_list(TABLES+[VIEW]+['_'+t for t in TABLES+[VIEW]])})),'[]'::json),
 'indexes',COALESCE((SELECT json_agg(json_build_object('name',c.relname,'valid',i.indisvalid,'ready',i.indisready))
   FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ({quoted_list(INDEXES)})),'[]'::json),
 'table_privileges',COALESCE((SELECT json_agg(json_build_object('role',r.rolname,'table',c.relname,
   'select',has_table_privilege(r.oid,c.oid,'SELECT'),'insert',has_table_privilege(r.oid,c.oid,'INSERT'),
   'update',has_table_privilege(r.oid,c.oid,'UPDATE'),'delete',has_table_privilege(r.oid,c.oid,'DELETE'),
   'truncate',has_table_privilege(r.oid,c.oid,'TRUNCATE')))
   FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ({quoted_list(TABLES)}) AND r.rolname IN ('{API}','{IMPORTER}')),'[]'::json),
 'api_view_columns',COALESCE((SELECT json_agg(json_build_object('column',a.attname,
   'select',has_column_privilege('{API}',c.oid,a.attnum,'SELECT')))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='public' AND c.relname='{VIEW}' AND a.attnum>0 AND NOT a.attisdropped),'[]'::json),
 'api_schema_create',has_schema_privilege('{API}','public','CREATE'),
 'importer_sessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='{IMPORTER}'));
ROLLBACK;"""
    return json.loads(psql(sql))


def check_local():
    if os.getuid() != Path('/home/rony').stat().st_uid:
        raise RuntimeError('Ejecutar como rony, no como root/postgres.')
    if Path('/home/rony').stat().st_mode & 0o022:
        raise RuntimeError('Directorio padre escribible por grupo/otros: revisar destino de credenciales.')
    if digest(MIGRATION) != MIGRATION_SHA:
        raise RuntimeError('La migración no coincide con la versión aprobada de main.')
    if digest(BACKUP) != BACKUP_SHA:
        raise RuntimeError('El respaldo no coincide con el SHA-256 aprobado.')


def preconditions(current, apply=False):
    if current['database'] != 'cartera_clientes' or current['user'] != 'postgres' or current['database_owner'] != 'postgres':
        raise RuntimeError('Base, usuario o propietario inesperados.')
    if not current['version'].startswith('17.'):
        raise RuntimeError('Se esperaba PostgreSQL 17.')
    api = next((r for r in current['roles'] or [] if r['name'] == API), None)
    if not api or api['superuser'] or api['createdb'] or api['createrole'] or current['api_schema_create']:
        raise RuntimeError('Privilegios de API inesperados: revisar antes de continuar.')
    if apply and (current['objects'] or current['types'] or any(r['name'] == IMPORTER for r in current['roles'])):
        raise RuntimeError('Ya hay objetos o rol importador: detener; no es una instalación inicial limpia.')


def assertions():
    # Se ejecutan antes de COMMIT: un privilegio/objeto incorrecto revierte todo.
    return f"""
DO $$
DECLARE r record; col text; actual bigint;
BEGIN
 IF current_database()<>'cartera_clientes' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Destino incorrecto'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ({quoted_list(RELATIONS)})) <> {len(RELATIONS)} THEN
   RAISE EXCEPTION 'Objetos incompletos'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND relname IN ({quoted_list(RELATIONS)}) AND pg_get_userbyid(relowner)<>'postgres') THEN
   RAISE EXCEPTION 'Propietario incorrecto'; END IF;
 IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ({quoted_list(INDEXES)}) AND (NOT i.indisvalid OR NOT i.indisready)) THEN
   RAISE EXCEPTION 'Indice invalido'; END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid IN
   (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ({quoted_list(TABLES)})) AND NOT convalidated) THEN
   RAISE EXCEPTION 'Restriccion sin validar'; END IF;
 FOR r IN SELECT unnest(ARRAY[{quoted_list(TABLES)}]) AS name LOOP
   EXECUTE format('SELECT count(*) FROM public.%I',r.name) INTO actual;
   IF actual<>0 THEN RAISE EXCEPTION 'No se esperaba importar datos'; END IF;
   IF NOT has_table_privilege('{IMPORTER}','public.'||r.name,'SELECT') OR
      NOT has_table_privilege('{IMPORTER}','public.'||r.name,'INSERT') OR
      NOT has_table_privilege('{IMPORTER}','public.'||r.name,'UPDATE') OR
      has_table_privilege('{IMPORTER}','public.'||r.name,'DELETE') OR
      has_table_privilege('{IMPORTER}','public.'||r.name,'TRUNCATE') THEN
     RAISE EXCEPTION 'Privilegios importador incorrectos'; END IF;
   IF has_table_privilege('{API}','public.'||r.name,'INSERT') OR
      has_table_privilege('{API}','public.'||r.name,'UPDATE') OR
      has_table_privilege('{API}','public.'||r.name,'DELETE') OR
      has_table_privilege('{API}','public.'||r.name,'TRUNCATE') THEN
     RAISE EXCEPTION 'API con escritura de visitas'; END IF;
 END LOOP;
 IF has_table_privilege('{API}','public.visitas_fuentes','SELECT') OR
    has_table_privilege('{API}','public.visitas_actuales','SELECT') OR
    has_table_privilege('{API}','public.visitas_tecnicas','SELECT') THEN RAISE EXCEPTION 'API con lectura privada'; END IF;
 FOREACH col IN ARRAY ARRAY['id','terminal','fecha','tecnico'] LOOP
   IF NOT has_column_privilege('{API}','public.visitas_tecnicas',col,'SELECT') THEN RAISE EXCEPTION 'Falta lectura de vista'; END IF;
 END LOOP;
 IF NOT has_table_privilege('{API}','public.visitas_reportes','SELECT') OR
    NOT has_table_privilege('{API}','public.importaciones_visitas','SELECT') OR
    NOT has_sequence_privilege('{IMPORTER}','public.{SEQUENCE}','USAGE') OR
    has_sequence_privilege('{IMPORTER}','public.{SEQUENCE}','UPDATE') THEN RAISE EXCEPTION 'Grants incompletos'; END IF;
 IF has_schema_privilege('{IMPORTER}','public','CREATE') THEN RAISE EXCEPTION 'Importador puede crear objetos'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   CROSS JOIN LATERAL aclexplode(c.relacl) acl WHERE n.nspname='public'
   AND c.relname IN ({quoted_list(RELATIONS)}) AND acl.grantee=0) THEN
   RAISE EXCEPTION 'Acceso PUBLIC inesperado'; END IF;
 IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='{IMPORTER}')) THEN
   RAISE EXCEPTION 'Importador miembro de otros roles'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{IMPORTER}' AND
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit OR rolconnlimit<>2)) THEN
   RAISE EXCEPTION 'Atributos peligrosos'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
     AND c.relkind IN ('r','p','v','m') AND c.relname NOT IN ({quoted_list(TABLES+[VIEW])})
     AND (has_table_privilege('{IMPORTER}',c.oid,'SELECT') OR has_table_privilege('{IMPORTER}',c.oid,'INSERT')
       OR has_table_privilege('{IMPORTER}',c.oid,'UPDATE') OR has_table_privilege('{IMPORTER}',c.oid,'DELETE'))) THEN
   RAISE EXCEPTION 'Importador con acceso a objetos ajenos'; END IF;
END $$;
"""


def apply_sql(password):
    if not re.fullmatch('[0-9a-f]{64}', password):
        raise RuntimeError('Formato de secreto interno no valido.')
    migration = MIGRATION.read_text()
    if not migration.startswith('BEGIN;') or not migration.rstrip().endswith('COMMIT;'):
        raise RuntimeError('Limites transaccionales inesperados.')
    body = migration[len('BEGIN;'):].rstrip()[:-len('COMMIT;')]
    qualified = ','.join('public.' + n for n in TABLES+[VIEW])
    return f"""BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_database()<>'cartera_clientes' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Destino incorrecto'; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('cartera-clientes:005:provision')) THEN RAISE EXCEPTION 'Administracion concurrente'; END IF;
END $$;
SET LOCAL password_encryption='scram-sha-256';
CREATE ROLE {IMPORTER} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE
 NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE {IMPORTER} IN DATABASE cartera_clientes SET search_path=pg_catalog,public;
ALTER ROLE {IMPORTER} IN DATABASE cartera_clientes SET statement_timeout='60s';
ALTER ROLE {IMPORTER} IN DATABASE cartera_clientes SET lock_timeout='5s';
ALTER ROLE {IMPORTER} IN DATABASE cartera_clientes SET idle_in_transaction_session_timeout='120s';
{body}
REVOKE ALL ON {qualified} FROM {API},{IMPORTER},PUBLIC;
REVOKE ALL ON SEQUENCE public.{SEQUENCE} FROM {API},{IMPORTER},PUBLIC;
GRANT CONNECT ON DATABASE cartera_clientes TO {IMPORTER};
GRANT USAGE ON SCHEMA public TO {API},{IMPORTER};
GRANT SELECT(id,terminal,fecha,tecnico) ON public.{VIEW} TO {API};
GRANT SELECT ON public.visitas_reportes,public.importaciones_visitas TO {API};
GRANT SELECT,INSERT,UPDATE ON {','.join('public.'+n for n in TABLES)} TO {IMPORTER};
GRANT USAGE ON SEQUENCE public.{SEQUENCE} TO {IMPORTER};
{assertions()}
COMMIT;
"""


def private_file(password):
    # Crear una sola vez, sin modificar .env de la API ni sobrescribir un secreto.
    PRIVATE.mkdir(mode=0o700)
    os.chmod(PRIVATE, 0o700)
    pending = PRIVATE / 'importador.env.pending'
    content = (f'DB_HOST=127.0.0.1\nDB_PORT=5432\nDB_NAME=cartera_clientes\nDB_USER={IMPORTER}\n'
               f'DB_PASSWORD={password}\nVISITAS_ENABLED=false\nVISITAS_IMPORT_ENABLED=false\n')
    fd = os.open(pending, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd,'w') as out:
        out.write(content); out.flush(); os.fsync(out.fileno())
    for folder in [PRIVATE, PRIVATE.parent]:
        fd = os.open(folder,os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
    return pending


def check_importer_login():
    file = PRIVATE / 'importador.env'
    if not file.exists():
        return 'no_configurado'
    if PRIVATE.is_symlink() or file.is_symlink() or file.stat().st_uid != os.getuid() or file.stat().st_mode & 0o077:
        raise RuntimeError('Permisos inseguros en credencial del importador.')
    values = dict(line.split('=',1) for line in file.read_text().splitlines() if '=' in line)
    command = ['/usr/lib/postgresql/17/bin/psql','-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1',
               '-h','127.0.0.1','-p','5432','-U',IMPORTER,'-d','cartera_clientes',
               '-c',"BEGIN READ ONLY; SELECT current_database()||':'||current_user; ROLLBACK;"]
    result = subprocess.run(command,text=True,capture_output=True,timeout=15,
        env={'PATH':'/usr/bin:/bin','PGPASSWORD':values['DB_PASSWORD'],'PGCONNECT_TIMEOUT':'5'})
    return 'correcto' if result.returncode == 0 and result.stdout.strip() == 'cartera_clientes:'+IMPORTER else 'fallo_no_se_modifica_autenticacion'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--check',action='store_true',help='Solo lectura (acción predeterminada)')
    group.add_argument('--apply',action='store_true',help='Crear rol + 005 + grants; requiere autorización externa')
    group.add_argument('--revoke-importer',action='store_true',help='Reversión de acceso sin borrar objetos/datos')
    parser.add_argument('--confirm',default='')
    args = parser.parse_args()
    os.umask(0o077)
    check_local()
    current = state()
    preconditions(current, apply=args.apply)
    print(json.dumps(current,ensure_ascii=False,indent=2))
    if args.apply:
        if args.confirm != 'cartera_clientes:005':
            raise RuntimeError('Falta --confirm cartera_clientes:005; no se aplicó nada.')
        if PRIVATE.exists() or PRIVATE.is_symlink():
            raise RuntimeError('Existe el directorio privado. Revisar un intento anterior; no sobrescribir.')
        password = secrets.token_hex(32)
        pending = private_file(password)
        psql(apply_sql(password))
        os.replace(pending, PRIVATE/'importador.env')
        fd = os.open(PRIVATE,os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
        print('Transacción confirmada. Credencial 0600 fuera de Git; flags false. No se importaron visitas.')
        print(json.dumps(state(),ensure_ascii=False,indent=2))
        login = check_importer_login()
        print('Conexion de lectura del importador:',login)
        if login != 'correcto':
            raise RuntimeError('005 y rol YA confirmados; falla la conexión del importador. No reejecutar --apply ni cambiar autenticación automáticamente.')
    elif args.revoke_importer:
        if args.confirm != 'cartera_clientes:revoke-importer':
            raise RuntimeError('Falta confirmación de reversión.')
        importer = next((r for r in current['roles'] if r['name'] == IMPORTER), None)
        if not importer or importer.get('superuser') or importer.get('createdb') or importer.get('createrole'):
            raise RuntimeError('No se reconoce el rol importador mínimo esperado.')
        if current['importer_sessions']:
            raise RuntimeError('Hay sesiones del importador: esperar su finalización, no se interrumpirán.')
        if len(current['objects']) != len(RELATIONS):
            raise RuntimeError('No se reconoce una instalación 005 completa.')
        psql(f"""BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_database()<>'cartera_clientes' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Destino incorrecto'; END IF;
END $$;
ALTER ROLE {IMPORTER} NOLOGIN;
REVOKE INSERT,UPDATE ON {','.join('public.'+n for n in TABLES)} FROM {IMPORTER};
REVOKE USAGE ON SEQUENCE public.{SEQUENCE} FROM {IMPORTER};
COMMIT;""")
        print('Acceso del importador deshabilitado. Tablas, datos, rol y credencial conservados.')
    else:
        print('SOLO LECTURA: no se crearon roles, archivos privados ni objetos SQL.')
        if (PRIVATE/'importador.env').exists():
            print('Conexion de lectura del importador:',check_importer_login())

if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(str(error),file=sys.stderr)  # Solo mensajes internos controlados, nunca stderr de psql.
        sys.exit(1)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        # No imprimir excepciones crudas: pueden incluir SQL/secretos en stderr.
        print('No se completó la acción. No reintentar a ciegas: revisar sudo -n, hashes, --check y posibles archivos .pending. No se muestran secretos.',file=sys.stderr)
        sys.exit(1)
