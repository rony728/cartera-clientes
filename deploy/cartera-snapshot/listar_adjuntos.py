import base64
import json
import os
import tempfile
import urllib.parse
import urllib.request

import msal

from auth_hotmail import obtener_token
from reportes_visitas import timeout_http


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ASUNTO = "Cartera Snapshot"

ARCHIVO_SALIDA = os.path.join(
    BASE_DIR,
    "snapshot.json",
)


def obtener_mensajes(token, asunto=ASUNTO):
    filtro = urllib.parse.quote(
        f"subject eq '{asunto.replace(chr(39), chr(39) * 2)}'"
    )

    url = (
        "https://graph.microsoft.com/v1.0/me/messages"
        f"?$filter={filtro}"
        "&$select=id,subject,receivedDateTime,sentDateTime,from"
        "&$top=100"
    )

    mensajes = []

    while url:
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
        )

        with urllib.request.urlopen(request, timeout=timeout_http()) as response:
            data = json.load(response)
        timeout_http()

        mensajes.extend(data.get("value", []))

        url = data.get("@odata.nextLink")

    return mensajes


def obtener_adjuntos(token, message_id):
    url = (
        "https://graph.microsoft.com/v1.0/me/messages/"
        + urllib.parse.quote(message_id, safe="")
        + "/attachments"
    )

    adjuntos = []
    while url:
        request = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=timeout_http()) as response:
            data = json.load(response)
        timeout_http()
        adjuntos.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
    return adjuntos



def descargar_adjunto(token, message_id, attachment_id):
    url = (
        "https://graph.microsoft.com/v1.0/me/messages/"
        + urllib.parse.quote(message_id, safe="")
        + "/attachments/"
        + urllib.parse.quote(attachment_id, safe="")
    )

    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )

    with urllib.request.urlopen(request, timeout=timeout_http()) as response:
        adjunto = json.load(response)
    timeout_http()

    content_bytes = adjunto.get("contentBytes")

    if not content_bytes:
        raise RuntimeError(
            "El adjunto no contiene contentBytes."
        )

    return base64.b64decode(content_bytes)


def validar_snapshot(contenido):
    try:
        datos = json.loads(
            contenido.decode("utf-8")
        )
    except Exception as e:
        raise RuntimeError(
            f"El archivo descargado no es JSON válido: {e}"
        )

    if not isinstance(datos, list):
        raise RuntimeError(
            "El snapshot no contiene una lista JSON."
        )

    if not datos:
        raise RuntimeError(
            "El snapshot está vacío."
        )

    for indice, registro in enumerate(datos, 1):
        if not isinstance(registro, dict):
            raise RuntimeError(
                f"El registro #{indice} no es un objeto JSON."
            )

    return datos


def guardar_snapshot_seguro(contenido):
    directorio = os.path.dirname(ARCHIVO_SALIDA)

    fd, archivo_temporal = tempfile.mkstemp(
        prefix=".snapshot-",
        suffix=".json",
        dir=directorio,
    )

    try:
        with os.fdopen(fd, "wb") as archivo:
            archivo.write(contenido)
            archivo.flush()
            os.fsync(archivo.fileno())

        with open(archivo_temporal, "rb") as archivo:
            contenido_verificacion = archivo.read()

        datos = validar_snapshot(
            contenido_verificacion
        )

        os.replace(
            archivo_temporal,
            ARCHIVO_SALIDA,
        )

        return len(datos)

    except Exception:
        if os.path.exists(archivo_temporal):
            os.remove(archivo_temporal)

        raise


def main(token=None):
    print("Autenticando con Hotmail...")

    token = token or obtener_token()

    print("Consultando mensajes...")

    mensajes = obtener_mensajes(token)

    print()
    print(f"Mensajes encontrados: {len(mensajes)}")

    if not mensajes:
        raise RuntimeError(
            f'No se encontraron mensajes con asunto "{ASUNTO}".'
        )

    mensajes.sort(
        key=lambda x: x.get(
            "receivedDateTime",
            "",
        ),
        reverse=True,
    )

    mensaje = mensajes[0]

    print()
    print("========================================")
    print("SNAPSHOT MÁS RECIENTE")
    print("========================================")
    print(
        f"Asunto:  {mensaje.get('subject')}"
    )
    print(
        f"Fecha:   {mensaje.get('receivedDateTime')}"
    )
    print(
        f"Enviado: {mensaje.get('sentDateTime')}"
    )

    remitente = mensaje.get("from", {})

    correo = (
        remitente
        .get("emailAddress", {})
        .get("address", "")
    )

    print(f"De:      {correo}")

    print()
    print("Consultando adjuntos...")

    adjuntos = obtener_adjuntos(
        token,
        mensaje["id"],
    )

    adjunto_json = None

    for adjunto in adjuntos:
        nombre = adjunto.get("name", "")

        if nombre.lower().endswith(".json"):
            adjunto_json = adjunto
            break

    if not adjunto_json:
        raise RuntimeError(
            "No se encontró ningún adjunto JSON."
        )

    print()
    print("========================================")
    print("DESCARGANDO SNAPSHOT")
    print("========================================")
    print(
        f"Archivo: {adjunto_json.get('name')}"
    )
    print(
        f"Tamaño:  {adjunto_json.get('size')} bytes"
    )

    contenido = descargar_adjunto(
        token,
        mensaje["id"],
        adjunto_json["id"],
    )

    print()
    print("Validando JSON...")

    cantidad = validar_snapshot(contenido)

    print(
        f"JSON válido. Registros: {len(cantidad)}"
    )

    cantidad_guardada = guardar_snapshot_seguro(
        contenido
    )

    print()
    print("========================================")
    print("SNAPSHOT ACTUALIZADO")
    print("========================================")
    print(
        f"Archivo:  {ARCHIVO_SALIDA}"
    )
    print(
        f"Registros: {cantidad_guardada}"
    )
    print(
        f"Tamaño:   {len(contenido)} bytes"
    )
    print("========================================")


if __name__ == "__main__":
    from reportes_visitas import ejecutar
    raise SystemExit(ejecutar(BASE_DIR, obtener_token, main, obtener_mensajes,
                             obtener_adjuntos, descargar_adjunto))
