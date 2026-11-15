"""Pruebas sin PostgreSQL, sudo ni datos reales."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('admin005',Path(__file__).with_name('admin-005.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


def clean_state():
    return dict(database='cartera_clientes',user='postgres',version='17.11',database_owner='postgres',
                roles=[dict(name=a.API,superuser=False,createdb=False,createrole=False)],
                objects=[],types=[],api_schema_create=False,importer_sessions=0)


class AdminTests(unittest.TestCase):
    def test_migration_exact_and_transaction_boundary(self):
        self.assertEqual(a.digest(a.MIGRATION),a.MIGRATION_SHA)
        sql=a.apply_sql('a'*64)
        self.assertEqual(sql.count('BEGIN;'),1)
        self.assertEqual(sql.count('COMMIT;'),1)
        self.assertLess(sql.index('CREATE ROLE'),sql.index('CREATE TABLE'))
        self.assertLess(sql.index('Objetos incompletos'),sql.index('COMMIT;'))
        self.assertIn('NOSUPERUSER NOCREATEDB NOCREATEROLE',sql)
        self.assertNotIn('DROP ',sql)
        self.assertNotIn('TRUNCATE TABLE',sql)
        self.assertNotIn('GRANT DELETE',sql)

    def test_requires_clean_database_and_role(self):
        a.preconditions(clean_state(),apply=True)
        for key,value in [('database','postgres'),('user',a.API),('objects',[{'name':'visitas_actuales'}]),
                          ('types',['visitas_actuales']),('api_schema_create',True)]:
            state=clean_state();state[key]=value
            with self.assertRaises(RuntimeError):a.preconditions(state,apply=True)
        state=clean_state();state['roles'].append({'name':a.IMPORTER})
        with self.assertRaises(RuntimeError):a.preconditions(state,apply=True)

    def test_default_is_read_only(self):
        with patch.object(a,'check_local'),patch.object(a,'state',return_value=clean_state()),patch.object(a,'private_file') as private,patch.object(a,'psql') as sql,patch('sys.argv',['admin-005.py']),contextlib.redirect_stdout(io.StringIO()):
            a.main()
            sql.assert_not_called();private.assert_not_called()

    def test_confirmation_required(self):
        with patch.object(a,'check_local'),patch.object(a,'state',return_value=clean_state()),patch.object(a,'private_file') as private,patch('sys.argv',['admin-005.py','--apply']),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):a.main()
            private.assert_not_called()

    def test_secret_file_permissions_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as root,patch.object(a,'PRIVATE',Path(root)/'private'):
            file=a.private_file('a'*64)
            self.assertEqual(file.stat().st_mode & 0o777,0o600)
            self.assertEqual(file.parent.stat().st_mode & 0o777,0o700)
            self.assertIn('VISITAS_IMPORT_ENABLED=false',file.read_text())
            with self.assertRaises(FileExistsError):a.private_file('b'*64)
            self.assertIn('DB_PASSWORD='+'a'*64,file.read_text())

    def test_psql_never_prints_password_on_error(self):
        result=Mock(returncode=1,stdout='',stderr='PASSWORD '+('a'*64))
        with patch.object(a.subprocess,'run',return_value=result) as run:
            with self.assertRaises(RuntimeError) as error:a.psql('password '+('a'*64))
            self.assertNotIn('a'*64,str(error.exception))
            self.assertIn('-n',run.call_args.args[0])
            self.assertNotIn('a'*64,' '.join(run.call_args.args[0]))
            self.assertEqual(run.call_args.kwargs['input'],'password '+('a'*64))

    def test_failed_apply_preserves_pending_secret(self):
        with tempfile.TemporaryDirectory() as root,patch.object(a,'PRIVATE',Path(root)/'private'),patch.object(a,'check_local'),patch.object(a,'state',return_value=clean_state()),patch.object(a,'psql',side_effect=RuntimeError('failure')),patch('sys.argv',['admin-005.py','--apply','--confirm','cartera_clientes:005']),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):a.main()
            self.assertTrue((a.PRIVATE/'importador.env.pending').exists())
            self.assertFalse((a.PRIVATE/'importador.env').exists())

    def test_reversion_does_not_drop_data_or_interrupt_sessions(self):
        state=clean_state();state['objects']=[{} for _ in a.RELATIONS];state['roles'].append(dict(name=a.IMPORTER,superuser=False,createdb=False,createrole=False))
        with patch.object(a,'check_local'),patch.object(a,'state',return_value=state),patch.object(a,'psql') as sql,patch('sys.argv',['admin-005.py','--revoke-importer','--confirm','cartera_clientes:revoke-importer']),contextlib.redirect_stdout(io.StringIO()):
            a.main()
            text=sql.call_args.args[0]
            self.assertNotIn('DROP ',text);self.assertNotIn('DELETE ',text)
            self.assertIn('NOLOGIN',text)
            self.assertNotIn('pg_terminate_backend',text)
        state['importer_sessions']=1
        with patch.object(a,'check_local'),patch.object(a,'state',return_value=state),patch.object(a,'psql') as sql,patch('sys.argv',['admin-005.py','--revoke-importer','--confirm','cartera_clientes:revoke-importer']),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):a.main()
            sql.assert_not_called()

if __name__=='__main__':unittest.main()
