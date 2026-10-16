"""Pruebas contra PostgreSQL efímero. No usa la configuración DB de producción.

Uso: python3 scripts/test-visitas-isolated.py /usr/lib/postgresql/17/bin
Requiere binarios PostgreSQL y extensión pg_trgm instalados; nunca instala paquetes.
"""
from pathlib import Path
import os
import subprocess
import sys
import tempfile

binary = Path(sys.argv[1]) if len(sys.argv) == 2 else None
if binary is None or not (binary / 'initdb').is_file():
    raise SystemExit('Indica el directorio de binarios PostgreSQL instalado.')
api = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cartera-visitas-test-') as root:
    started = False
    def run(args, **kwargs):
        subprocess.run(args, check=True, cwd=api, **kwargs)
    try:
        run([str(binary / 'initdb'), '-D', root + '/data', '-A', 'trust', '--no-locale', '-E', 'UTF8'], stdout=subprocess.DEVNULL)
        run([str(binary / 'pg_ctl'), '-D', root + '/data', '-l', root + '/postgres.log', '-o',
             "-k " + root + " -c listen_addresses=''", '-w', 'start'], stdout=subprocess.DEVNULL)
        started = True
        run([str(binary / 'createdb'), '-h', root, 'cartera_visitas_test'])
        env = {**os.environ, 'TEST_DATABASE_NAME': 'cartera_visitas_test',
               'TEST_DATABASE_URL': 'postgresql:///cartera_visitas_test?host=' + root}
        run(['npm', 'run', 'test:db:setup'], env=env)
        run(['npm', 'run', 'test:integration'], env=env)
    finally:
        if started:
            run([str(binary / 'pg_ctl'), '-D', root + '/data', '-m', 'fast', '-w', 'stop'], stdout=subprocess.DEVNULL)
