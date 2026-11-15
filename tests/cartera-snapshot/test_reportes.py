import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock
from urllib.error import HTTPError

SOURCE = Path(__file__).resolve().parents[2] / 'deploy' / 'cartera-snapshot'
sys.path.insert(0, str(SOURCE))
import reportes_visitas as r

VALID = json.dumps([{'ID': 1, 'Terminal': '00001'}, {'ID': 2, 'Terminal': '00001'}]).encode()

class ReportesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.messages = Mock(return_value=[dict(id='m1', subject='Reporte de Visitas', receivedDateTime='2026-10-01')])
        self.attachments = Mock(return_value=[dict(id='a1', name='VisitasSoportePOS_1.json')])
        self.download = Mock(return_value=VALID)

    def run_report(self):
        return r.procesar(self.base, 'fake', *r.REPORTES[0], self.messages, self.attachments, self.download)

    def latest(self):
        return self.base / 'visitas/historico/ultimo'

    def test_initial_repeat_and_metadata(self):
        self.assertTrue(self.run_report())
        self.assertTrue(self.run_report())
        self.download.assert_called_once()
        self.assertEqual((self.latest() / 'data.json').read_bytes(), VALID)
        meta = json.loads((self.latest() / 'metadata.json').read_text())
        self.assertEqual(meta['records'], 2)
        self.assertEqual(len(meta['sha256']), 64)
        self.assertEqual((self.latest() / meta['name']).stat().st_mode & 0o777, 0o600)

    def test_exact_subject_and_patterns(self):
        self.messages.return_value[0]['subject'] = 'Reporte de Visitas Mensual'
        self.assertFalse(self.run_report())
        self.download.assert_not_called()
        self.messages.return_value[0]['subject'] = 'Reporte de Visitas'
        for name in ['MesVisitasSoportePOS_1.json', '../VisitasSoportePOS_x.json', 'VisitasSoportePOS_1.txt']:
            self.attachments.return_value[0]['name'] = name
            self.assertFalse(self.run_report())
        self.download.assert_not_called()

    def test_new_version_preserves_original(self):
        self.run_report()
        old = self.latest().resolve()
        self.messages.return_value[0]['id'] = 'm2'
        self.run_report()
        self.assertNotEqual(old, self.latest().resolve())
        self.assertTrue((old / 'VisitasSoportePOS_1.json').exists())
        self.assertEqual(self.download.call_count, 2)

    def test_invalid_new_version_preserves_latest(self):
        self.run_report()
        old = self.latest().resolve()
        self.messages.return_value[0]['id'] = 'm2'
        self.download.return_value = b'broken'
        self.assertFalse(self.run_report())
        self.assertEqual(old, self.latest().resolve())

    def test_corrupt_cache_redownloaded(self):
        self.run_report()
        (self.latest() / 'data.json').write_bytes(b'bad')
        self.assertTrue(self.run_report())
        self.assertEqual(self.download.call_count, 2)

    def test_fallback_to_older_valid_message(self):
        older = dict(self.messages.return_value[0])
        self.messages.return_value.insert(0, dict(id='m2', subject='Reporte de Visitas', receivedDateTime='2026-10-02'))
        self.messages.return_value.append(older)
        self.download.side_effect = [b'bad', VALID]
        self.run_report()
        self.assertEqual((self.latest() / 'data.json').read_bytes(), VALID)

    def test_validation(self):
        for data in [b'{}', b'null', b'[1]', b'[{"Terminal":"01"}]', b'[{"ID":true,"Terminal":"01"}]', b'[{"ID":1,"Terminal":1}]']:
            with self.assertRaises((ValueError, TypeError)):
                r.validar(data)
        self.assertEqual(len(r.validar(VALID)), 2)
        self.assertEqual(r.validar(b'[]'), [])
        self.assertEqual(len(r.validar(b'[{"ItemInternalId":"abc","Terminal":"00"}]')), 1)

    def test_independent_errors_and_one_auth(self):
        auth, snapshot = Mock(return_value='fake'), Mock()
        messages = Mock(side_effect=[HTTPError('https://example.invalid', 429, 'private', {}, None), []])
        self.assertEqual(r.ejecutar(self.base, auth, snapshot, messages, self.attachments, self.download), 1)
        auth.assert_called_once()
        snapshot.assert_called_once_with('fake')
        self.assertEqual(messages.call_count, 2)

    def test_concurrency(self):
        auth = Mock()
        with r.bloqueo(self.base):
            self.assertEqual(r.ejecutar(self.base, auth, Mock(), Mock(), Mock(), Mock()), 0)
        auth.assert_not_called()

    def test_snapshot_failure_does_not_stop_visits(self):
        messages = Mock(return_value=[])
        r.ejecutar(self.base, Mock(return_value='fake'), Mock(side_effect=RuntimeError()), messages, Mock(), Mock())
        self.assertEqual(messages.call_count, 2)


class GraphTest(unittest.TestCase):
    def test_queries_pagination_and_legacy_snapshot(self):
        import types
        from unittest.mock import patch
        from urllib.parse import parse_qs, urlsplit
        fake_auth = types.ModuleType('auth_hotmail')
        fake_auth.obtener_token = Mock(side_effect=AssertionError('No real auth'))
        spec = importlib.util.spec_from_file_location('staged_downloader', SOURCE / 'listar_adjuntos.py')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'auth_hotmail': fake_auth, 'msal': types.ModuleType('msal')}):
            spec.loader.exec_module(module)
        def response(value):
            import io
            return io.BytesIO(json.dumps(value).encode())
        for subject in ['Cartera Snapshot', 'Reporte de Visitas', 'Reporte de Visitas Mensual']:
            with patch.object(module.urllib.request, 'urlopen', return_value=response({'value': []})) as http:
                module.obtener_mensajes('fake', subject)
                query = parse_qs(urlsplit(http.call_args.args[0].full_url).query)
                self.assertEqual(query['$filter'], [f"subject eq '{subject}'"])
        with patch.object(module.urllib.request, 'urlopen', side_effect=[response({'value': [{'id': 'a'}], '@odata.nextLink': 'https://graph.microsoft.com/next'}), response({'value': [{'id': 'b'}]})]):
            self.assertEqual(len(module.obtener_adjuntos('fake', 'm')), 2)
        with tempfile.TemporaryDirectory() as directory:
            module.ARCHIVO_SALIDA = str(Path(directory) / 'snapshot.json')
            with patch.object(module, 'obtener_mensajes', return_value=[{'id': 'm', 'receivedDateTime': '2026-10-01'}]), patch.object(module, 'obtener_adjuntos', return_value=[{'id': 'a', 'name': 'snapshot.json'}]), patch.object(module, 'descargar_adjunto', return_value=VALID):
                module.main('fake')
            self.assertEqual(Path(module.ARCHIVO_SALIDA).read_bytes(), VALID)
        fake_auth.obtener_token.assert_not_called()

    def test_monthly_initial(self):
        with tempfile.TemporaryDirectory() as directory:
            messages = Mock(return_value=[{'id': 'm', 'subject': r.REPORTES[1][1]}])
            self.assertTrue(r.procesar(directory, 'fake', *r.REPORTES[1], messages,
                            Mock(return_value=[{'id': 'a', 'name': 'MesVisitasSoportePOS_202610.json'}]),
                            Mock(return_value=VALID)))
            self.assertEqual((Path(directory) / 'visitas/mensual/ultimo/data.json').read_bytes(), VALID)


class SeguridadTest(unittest.TestCase):
    setUp = ReportesTest.setUp
    run_report = ReportesTest.run_report
    latest = ReportesTest.latest

    def test_nonstandard_values_preserve_latest(self):
        self.run_report()
        original = self.latest().resolve()
        self.messages.return_value[0]['id'] = 'm2'
        for value in ['NaN', 'Infinity', '-Infinity']:
            with self.subTest(value=value):
                self.download.return_value = ('[{"ID":1,"Terminal":"001","Comentarios":' + value + '}]').encode()
                with self.assertRaises(ValueError):
                    r.validar(self.download.return_value)
                self.assertFalse(self.run_report())
                self.assertEqual(self.latest().resolve(), original)
                self.assertEqual((self.latest() / 'data.json').read_bytes(), VALID)

    def test_existing_directories_and_files_permissions(self):
        import os
        root_mode = self.base.stat().st_mode & 0o777
        for relative in ['visitas', 'visitas/historico', 'visitas/mensual', 'visitas/historico/versiones']:
            p = self.base / relative
            p.mkdir(exist_ok=True)
            p.chmod(0o777)
        self.run_report()
        for p in (self.latest() / 'data.json', self.latest() / 'metadata.json'):
            p.chmod(0o666)
        self.run_report()
        self.download.assert_called_once()
        for folder, _, files in os.walk(self.base / 'visitas', followlinks=False):
            self.assertEqual(Path(folder).stat().st_mode & 0o777, 0o700)
            for name in files:
                p = Path(folder) / name
                if not p.is_symlink():
                    self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.base.stat().st_mode & 0o777, root_mode)

    def test_permissions_do_not_follow_external_links(self):
        with tempfile.TemporaryDirectory() as external:
            outside = Path(external)
            outside.chmod(0o755)
            file = outside / 'external.json'
            file.write_bytes(VALID)
            file.chmod(0o644)
            r.preparar_permisos(self.base)
            (self.base / 'visitas/external_directory').symlink_to(outside, target_is_directory=True)
            (self.base / 'visitas/external_file.json').symlink_to(file)
            r.preparar_permisos(self.base)
            self.assertEqual(outside.stat().st_mode & 0o777, 0o755)
            self.assertEqual(file.stat().st_mode & 0o777, 0o644)

    def test_configured_budget_and_signal_handler_restored(self):
        import signal
        from unittest.mock import patch
        original_handler = signal.getsignal(signal.SIGALRM)
        captured = []
        def process(*_):
            captured.append(r.timeout_http())
            return True
        with patch.dict(r.os.environ, {'VISITAS_PRESUPUESTO_SEGUNDOS': '0.5'}), patch.object(r, 'procesar', side_effect=process):
            self.assertEqual(r.ejecutar(self.base, Mock(), Mock(), Mock(), Mock(), Mock()), 0)
        self.assertTrue(all(0 < t <= 0.5 for t in captured))
        self.assertEqual(len(captured), 2)
        self.assertEqual(signal.getsignal(signal.SIGALRM), original_handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_temporary_file_permissions(self):
        from unittest.mock import patch
        import os
        original = r.os.replace
        seen = []
        def replace(source, target):
            seen.append(Path(source).stat().st_mode & 0o777)
            return original(source, target)
        with patch.object(r.os, 'replace', side_effect=replace):
            r.escribir(self.base / 'simulado.json', VALID)
        self.assertEqual(seen, [0o600])
        self.assertEqual((self.base / 'simulado.json').stat().st_mode & 0o777, 0o600)

    def test_total_budget_interrupts_download_preserves_snapshot_and_latest(self):
        import time
        from unittest.mock import patch
        self.run_report()
        original = self.latest().resolve()
        self.messages.return_value[0]['id'] = 'm2'
        def slow(*_):
            time.sleep(1)
            return VALID
        snapshot_path = self.base / 'snapshot.json'
        snapshot = Mock(side_effect=lambda _: snapshot_path.write_bytes(b'snapshot-simulado'))
        started = time.monotonic()
        with patch.object(r, 'registrar') as log:
            result = r.ejecutar(self.base, Mock(return_value='fake'), snapshot,
                               self.messages, self.attachments, slow, segundos_visitas=0.05)
        self.assertLess(time.monotonic() - started, 0.7)
        self.assertEqual(result, 1)
        self.assertEqual(snapshot_path.read_bytes(), b'snapshot-simulado')
        self.assertEqual(self.latest().resolve(), original)
        log.assert_any_call('todos', 'presupuesto_agotado')
        # La alarma se elimina y el siguiente intento puede publicar el pendiente.
        import signal
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))
        self.assertTrue(self.run_report())
        self.assertNotEqual(self.latest().resolve(), original)

    def test_both_reports_share_budget(self):
        from unittest.mock import patch
        now = [100.0]
        def process(*_):
            now[0] += 0.6
            r.timeout_http()
            return True
        with patch.object(r.time, 'monotonic', side_effect=lambda: now[0]), patch.object(r, 'procesar', side_effect=process) as process_mock:
            result = r.ejecutar(self.base, Mock(return_value='fake'), Mock(), Mock(), Mock(), Mock(), segundos_visitas=1)
        self.assertEqual(result, 1)
        self.assertEqual(process_mock.call_count, 2)

    def test_default_config_and_invalid_budget_snapshot_first(self):
        from unittest.mock import patch
        import contextlib
        @contextlib.contextmanager
        def capture(value):
            self.assertEqual(value, 120)
            yield
        with patch.dict(r.os.environ, {}, clear=True), patch.object(r, 'presupuesto', side_effect=capture), patch.object(r, 'procesar', return_value=True):
            self.assertEqual(r.ejecutar(self.base, Mock(), Mock(), Mock(), Mock(), Mock()), 0)
        snapshot = Mock()
        with patch.dict(r.os.environ, {'VISITAS_PRESUPUESTO_SEGUNDOS': 'NaN'}):
            self.assertEqual(r.ejecutar(self.base, Mock(), snapshot, Mock(), Mock(), Mock()), 1)
        snapshot.assert_called_once()


class PresupuestoGraphTest(unittest.TestCase):
    def module(self):
        import types
        from unittest.mock import patch
        fake = types.ModuleType('auth_hotmail')
        fake.obtener_token = Mock(side_effect=AssertionError('No real auth'))
        spec = importlib.util.spec_from_file_location('budget_downloader', SOURCE / 'listar_adjuntos.py')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'auth_hotmail': fake, 'msal': types.ModuleType('msal')}):
            spec.loader.exec_module(module)
        return module

    def test_pagination_budget_and_remaining_http_timeout(self):
        import io
        from unittest.mock import patch
        module = self.module()
        for query in [lambda: module.obtener_mensajes('fake', 'Reporte de Visitas'),
                      lambda: module.obtener_adjuntos('fake', 'm')]:
            now = [10.0]
            timeouts = []
            def request(*_, timeout):
                timeouts.append(timeout)
                now[0] += 0.6
                return io.BytesIO(b'{"value":[],"@odata.nextLink":"https://graph.microsoft.com/next"}')
            with patch.object(r.time, 'monotonic', side_effect=lambda: now[0]), patch.object(module.urllib.request, 'urlopen', side_effect=request):
                with self.assertRaises(r.PresupuestoAgotado), r.presupuesto(1):
                    query()
            self.assertEqual(len(timeouts), 2)
            self.assertAlmostEqual(timeouts[0], 1)
            self.assertAlmostEqual(timeouts[1], 0.4)

    def test_download_body_is_interrupted_by_total_deadline(self):
        import io
        import time
        from unittest.mock import patch
        module = self.module()
        class SlowBody(io.BytesIO):
            def read(self, *args):
                time.sleep(1)
                return super().read(*args)
        with patch.object(module.urllib.request, 'urlopen', return_value=SlowBody(b'{"contentBytes":"W10="}')):
            with self.assertRaises(r.PresupuestoAgotado), r.presupuesto(0.05):
                module.descargar_adjunto('fake', 'm', 'a')

    def test_snapshot_validation_remains_unchanged(self):
        module = self.module()
        self.assertEqual(len(module.validar_snapshot(b'[{"x":NaN}]')), 1)

if __name__ == '__main__':
    unittest.main()
