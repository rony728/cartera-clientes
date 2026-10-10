# Protocolo de actualización Excel por correo V2

## Contrato

Las ediciones realizadas mediante `PATCH /api/v1/terminales/:terminal` se guardan primero en PostgreSQL. Una edición con uno o varios campos genera un solo correo aceptado por Microsoft Graph con:

- asunto exacto: `ACTUALIZAR_CARTERA_V2`;
- cuerpo `Text` compuesto exclusivamente por `JSON.stringify` del objeto;
- `version` numérica `2`, `terminal` textual y `cambios` con solo diferencias efectivas.

```json
{"version":2,"terminal":"00000284","cambios":{"NombreComercial":"COMERCIO ACTUALIZADO","Celular":"99999999","Zona":"CENTRO"}}
```

El contenido no incluye Markdown, texto adicional, `Terminal` dentro de `cambios`, metadatos internos ni valores no modificados. Los valores admitidos son texto o `null`; se conservan ceros iniciales, espacios, mayúsculas y cadenas vacías. `JSON.stringify` escapa comillas y controles para que un valor no pueda alterar la estructura.

## Columnas admitidas

`CodigoComercio`, `NombreComercial`, `Zona`, `Direccion`, `Ciudad`, `Inventario`, `SeriePOS`, `Modelo`, `Comunicacion`, `RedSimcard`, `SerieSimcard`, `Atendio`, `Celular`, `Ubicacion`, `TecnicoAsignado`, `IP`, `Mascara`, `Gateway`, `DNS`, `DNS2`, `PLATAFORMA`, `Correo` y `CategoriaComercio`.

La API rechaza cualquier otra columna. La PWA sigue mostrando propiedades dinámicas desconocidas, pero las presenta como solo lectura hasta que Power Automate tenga una expresión compatible.

## Cola, errores y conciliación

La transacción PostgreSQL actualiza la terminal, incrementa su versión, registra historial y crea una fila de `cola_sincronizacion` por campo. Todas comparten `operacion_id`. Antes de llamar a Graph, la operación pasa de `PENDIENTE` a `INCIERTO`, fija `fecha_envio` e incrementa un único intento. Así, una interrupción no habilita un reintento automático potencialmente duplicado.

- `ENVIADO`: Graph aceptó el correo. No confirma que Power Automate ni Excel lo hayan procesado.
- `PENDIENTE`: el cambio local se guardó, pero el intento externo no pudo iniciarse con auditoría completa; Graph no se invoca.
- `ERROR`: Graph rechazó o no pudo aceptar el envío. El cambio permanece en PostgreSQL e historial.
- `INCIERTO`: el intento comenzó, pero no se pudo acreditar su resultado final con seguridad.
- `CONFIRMADO`: un snapshot posterior a `fecha_envio` contiene el valor enviado.
- `CONFLICTO`: el snapshot posterior contiene otro valor. Excel continúa siendo la fuente de verdad de la importación.
- `SUPERADA`: una edición posterior reemplazó esa revisión local.

No existen reintentos automáticos. Resolver un `ERROR` o `INCIERTO` requiere revisión operativa e idempotencia antes de reenviar.

## Compatibilidad V1

`POST /api/cartera/celular` conserva el asunto `ACTUALIZAR_CARTERA|Terminal|Celular`, autenticación `X-API-Key` y respuesta HTTP 202. El `PATCH` autenticado nunca dispara simultáneamente V1 y V2.

## Power Automate y concurrencia

`OutActCartera` procesa el cuerpo con «Html a texto», analiza el JSON, obtiene por columna clave `Terminal` y actualiza las 23 columnas. Las expresiones conservan el valor leído cuando la clave no aparece en `cambios`.

«Obtener una fila» seguido de «Actualizar una fila» no es atómico. Una edición directa de Excel entre ambas acciones puede ser sobrescrita por valores leídos anteriormente. El control de versión del API protege ediciones concurrentes en PostgreSQL, pero no puede bloquear Excel ni convertir el conector de Power Automate en una transacción distribuida. La importación posterior registra la divergencia; la aceptación de Graph nunca debe mostrarse como confirmación de Excel.

## Prueba controlada y despliegue

Las pruebas automatizadas sustituyen el servicio de correo y no contactan Microsoft Graph ni Excel. Para actualizar Ubuntu posteriormente:

```sh
cd /ruta/al/repositorio
git pull --ff-only origin main
cd apps/api
npm ci
npm test
npm audit --omit=dev
npm run config:check
pm2 restart NOMBRE_PROCESO_PM2 --update-env
```

No hay migración nueva. Antes de una prueba funcional real, confirma que `MAIL_TO` apunta al buzón autorizado, que el caché MSAL es privado y que Power Automate espera exactamente el contrato V2. Realiza primero una edición sintética de un campo y verifica por separado PostgreSQL, cola, recepción del correo, ejecución del flujo y Excel. Este repositorio no acredita una prueba extremo a extremo contra el Excel real.
