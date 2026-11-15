"""Descargas de visitas. Sin autenticación ni efectos al importar el módulo."""
import contextvars
import math
import signal
import stat
import time
import contextlib
import datetime
import fcntl
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

REPORTES = (
    ('historico', 'Reporte de Visitas', 'VisitasSoportePOS_*.json'),
    ('mensual', 'Reporte de Visitas Mensual', 'MesVisitasSoportePOS_*.json'),
)


class PresupuestoAgotado(BaseException):
    """Interrumpe también los manejadores de errores por candidato."""


_PLAZO = contextvars.ContextVar('plazo_visitas', default=None)


def timeout_http():
    plazo = _PLAZO.get()
    if plazo is None:
        return 60
    restante = plazo - time.monotonic()
    if restante <= 0:
        raise PresupuestoAgotado()
    return min(60, restante)


@contextlib.contextmanager
def presupuesto(segundos):
    # Linux/systemd, hilo principal. La alarma también corta DNS y lecturas
    # lentas que un timeout de socket por sí solo no limita globalmente.
    if signal.getitimer(signal.ITIMER_REAL) != (0.0, 0.0):
        raise RuntimeError('Ya existe una alarma activa')
    anterior = signal.getsignal(signal.SIGALRM)
    def agotar(*_):
        raise PresupuestoAgotado()
    signal.signal(signal.SIGALRM, agotar)
    contexto = _PLAZO.set(time.monotonic() + segundos)
    try:
        signal.setitimer(signal.ITIMER_REAL, segundos)
        yield
        timeout_http()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        _PLAZO.reset(contexto)
        signal.signal(signal.SIGALRM, anterior)


def directorio_privado(path):
    path.mkdir(exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        raise ValueError('Directorio de visitas inseguro')
    path.chmod(0o700)


def preparar_permisos(base):
    raiz = Path(base) / 'visitas'
    directorio_privado(raiz)
    for categoria, _, _ in REPORTES:
        directorio_privado(raiz / categoria)
    # No seguir enlaces: ultimo, data.json e índices no requieren chmod.
    for carpeta, directorios, archivos in os.walk(raiz, followlinks=False):
        timeout_http()
        Path(carpeta).chmod(0o700)
        for nombre in archivos:
            archivo = Path(carpeta) / nombre
            if not archivo.is_symlink():
                if not stat.S_ISREG(archivo.lstat().st_mode) or archivo.stat().st_nlink != 1:
                    raise ValueError('Archivo de visitas inseguro')
                archivo.chmod(0o600)


def rechazar_constante(_):
    raise ValueError('Constante JSON no estándar')


def registrar(categoria, evento, error=None):
    # Nunca registrar cuerpos HTTP, tokens, contenido de registros ni excepciones crudas.
    extra = ''
    if error is not None:
        extra = f' tipo={type(error).__name__}'
        if isinstance(getattr(error, 'code', None), int):
            extra += f' http={error.code}'
    print(f'visitas categoria={categoria} evento={evento}{extra}', flush=True)


def validar(contenido):
    datos = json.loads(contenido.decode('utf-8'), parse_constant=rechazar_constante)
    if not isinstance(datos, list):
        raise ValueError('Se requiere un arreglo JSON')
    for fila in datos:
        if not isinstance(fila, dict):
            raise ValueError('Registro inválido')
        identificador = fila.get('ID')
        alternativo = fila.get('ItemInternalId')
        valido_id = (isinstance(identificador, int) and not isinstance(identificador, bool)
                     and identificador > 0) or (isinstance(identificador, str)
                     and identificador.isdecimal() and int(identificador) > 0)
        valido_alternativo = isinstance(alternativo, str) and bool(alternativo.strip())
        if not (valido_id or valido_alternativo):
            raise ValueError('Identificador de visita inválido')
        if not isinstance(fila.get('Terminal'), str) or not fila['Terminal'].strip():
            raise ValueError('Terminal debe ser texto no vacío')
    return datos


def escribir(path, contenido):
    fd, temporal = tempfile.mkstemp(prefix='.tmp-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as archivo:
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())
        os.replace(temporal, path)
    finally:
        if os.path.exists(temporal):
            os.unlink(temporal)


def sincronizar_directorio(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


@contextlib.contextmanager
def bloqueo(base):
    fd = os.open(Path(base) / '.descargas.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def procesar(base, token, categoria, asunto, patron, mensajes, adjuntos, descargar):
    timeout_http()
    preparar_permisos(base)
    destino = Path(base) / 'visitas' / categoria
    versiones = destino / 'versiones'
    directorio_privado(versiones)
    candidatos = sorted((m for m in mensajes(token, asunto) if m.get('subject') == asunto),
                        key=lambda m: m.get('receivedDateTime', ''), reverse=True)
    hubo_error = False
    for mensaje in candidatos:
        timeout_http()
        try:
            archivos = adjuntos(token, mensaje['id'])
        except Exception as error:
            registrar(categoria, 'error_listando_adjuntos', error)
            hubo_error = True
            continue
        for adjunto in archivos:
            timeout_http()
            nombre = adjunto.get('name', '')
            if (not fnmatch.fnmatchcase(nombre, patron) or '/' in nombre or '\\' in nombre
                    or adjunto.get('@odata.type', '#microsoft.graph.fileAttachment')
                    != '#microsoft.graph.fileAttachment'):
                continue
            identidad = hashlib.sha256(json.dumps([mensaje['id'], adjunto['id']],
                                                   ensure_ascii=True).encode()).hexdigest()
            version = versiones / identidad
            try:
                try:
                    meta = json.loads((version / 'metadata.json').read_text())
                    contenido = (version / nombre).read_bytes()
                    datos = validar(contenido)
                    reutilizar = (meta['message_id'] == mensaje['id']
                                  and meta['attachment_id'] == adjunto['id']
                                  and meta['name'] == nombre
                                  and meta['sha256'] == hashlib.sha256(contenido).hexdigest()
                                  and meta['records'] == len(datos)
                                  and bool(meta['processed_at']))
                except (OSError, ValueError, KeyError, TypeError):
                    reutilizar = False
                if not reutilizar:
                    contenido = descargar(token, mensaje['id'], adjunto['id'])
                    timeout_http()
                    datos = validar(contenido)
                    timeout_http()
                    # Bundle único: nunca sobrescribir una versión previamente publicada.
                    version = versiones / (identidad + '-' + uuid.uuid4().hex)
                    version.mkdir(mode=0o700)
                    meta = dict(message_id=mensaje['id'], attachment_id=adjunto['id'],
                                name=nombre, received_at=mensaje.get('receivedDateTime'),
                                sha256=hashlib.sha256(contenido).hexdigest(), records=len(datos),
                                processed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
                    escribir(version / nombre, contenido)
                    escribir(version / 'metadata.json', json.dumps(meta, ensure_ascii=False).encode())
                    os.symlink(nombre, version / 'data.json')
                    sincronizar_directorio(version)
                    indice_temporal = versiones / ('.indice-' + uuid.uuid4().hex)
                    try:
                        os.symlink(version.name, indice_temporal)
                        os.replace(indice_temporal, versiones / identidad)
                    finally:
                        indice_temporal.unlink(missing_ok=True)
                    sincronizar_directorio(versiones)
                timeout_http()
                # Puntero atómico que publica juntos datos y metadatos.
                temporal = destino / ('.ultimo-' + uuid.uuid4().hex)
                try:
                    os.symlink(str(version.relative_to(destino)), temporal)
                    os.replace(temporal, destino / 'ultimo')
                    sincronizar_directorio(destino)
                finally:
                    temporal.unlink(missing_ok=True)
                registrar(categoria, 'copia_verificada' if reutilizar else 'version_guardada')
                return not hubo_error
            except Exception as error:
                registrar(categoria, 'adjunto_rechazado', error)
                hubo_error = True
    registrar(categoria, 'sin_version_valida')
    return False


def ejecutar(base, autenticar, snapshot, mensajes, adjuntos, descargar, segundos_visitas=None):
    try:
        with bloqueo(base):
            try:
                token = autenticar()
            except Exception as error:
                registrar('todos', 'error_autenticacion', error)
                return 1
            exito = True
            try:
                snapshot(token)
            except Exception as error:
                registrar('snapshot', 'error_actualizacion', error)
                exito = False
            try:
                segundos = float(segundos_visitas if segundos_visitas is not None else
                                 os.environ.get('VISITAS_PRESUPUESTO_SEGUNDOS', '120'))
                if not math.isfinite(segundos) or segundos <= 0:
                    raise ValueError('Presupuesto inválido')
                with presupuesto(segundos):
                    for categoria, asunto, patron in REPORTES:
                        timeout_http()
                        try:
                            correcto = procesar(base, token, categoria, asunto, patron,
                                                 mensajes, adjuntos, descargar)
                            exito = correcto and exito
                        except Exception as error:
                            registrar(categoria, 'error_reporte', error)
                            exito = False
            except PresupuestoAgotado:
                registrar('todos', 'presupuesto_agotado')
                exito = False
            except Exception as error:
                registrar('todos', 'error_etapa_visitas', error)
                exito = False
            return 0 if exito else 1
    except BlockingIOError:
        registrar('todos', 'ejecucion_ya_activa')
        return 0
