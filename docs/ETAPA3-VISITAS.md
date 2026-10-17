# Etapa 3: última visita en la PWA

La fecha y la presencia de visitas provienen del listado `/api/v1/terminales`:
`ultima_visita` y `tiene_visitas_registradas`. No se consulta por tarjeta.

- Fechas `dd/MM/yyyy` y advertencias por meses calendario de `America/Tegucigalpa`.
- Ausencia confirmada: «Sin visitas registradas», con advertencia.
- Registros existentes sin fecha elegible: «Sin fecha de visita disponible», sin advertencia.
- Contrato antiguo/copia anterior sin estas propiedades: «Visitas no disponibles», sin inventar ausencia ni fechas.
- La advertencia empieza en dos meses calendario; no define un umbral de «reciente».
- La API conserva la regla de excluir fechas posteriores al mes actual y admitir futuras dentro del mes actual.

## Consultas

Filtros de presencia: `visitas=con|sin`; antigüedad: `visita_antiguedad_meses=2|3`;
orden: `orden=ultima_visita&direccion=asc|desc`. Los nulos quedan al final.
Los controles de rango y la URL de la PWA usan días `YYYY-MM-DD` inclusivos.
El cliente convierte a `visita_desde` inclusivo y `visita_hasta` exclusivo, a medianoche
UTC-06:00. Se conservan búsqueda, filtros y orden al paginar y volver de una ficha.
Las antigüedades y rangos requieren fecha elegible; no incluyen terminales sin fecha.

### Ajuste de compatibilidad para filtros equivalentes

Antes se descargaban todas las variantes de categorías equivalentes y se combinaban,
ordenaban y paginaban en el navegador. El parámetro opcional `filtros_variantes` es un
objeto JSON con campos permitidos y listas de variantes literales, enviado junto al
filtro habitual. La API valida campos, tamaños y tipos, y construye `= ANY($n::text[])`.
La unión, filtros de visitas, orden y paginación se ejecutan en una única consulta SQL;
las consultas antiguas sin variantes mantienen su comportamiento. No requiere DDL,
migraciones, roles ni permisos nuevos.

**Dependencia de despliegue:** actualizar la API con este PR antes de publicar la PWA.
La API anterior ignora el parámetro nuevo y podría omitir variantes de categorías.
Este trabajo no despliega ni reinicia la API ni publica la PWA.

## Carga, errores y modo offline

Se mantienen resultados anteriores mientras cambia la consulta, con indicador de carga
y paginación temporalmente deshabilitada. Un error ofrece reintentar o quitar filtros y
orden de visitas conservando la búsqueda comercial. No se convierte un error en «sin visitas».
Los errores generales de disponibilidad de la API siguen requiriendo recuperación del backend.
La copia offline guarda los campos del listado y aplica las mismas reglas antes de paginar,
con aviso de posible desactualización; no puede reconstruir visitas que no estén en la copia.

## Validación y límites operativos

Pruebas de fechas locales, límites de mes/año, ausencia/exclusión, orden con nulos,
serialización del rango, filtros y paginación, tabla, tarjetas, copia, navegación,
errores y regresiones de edición. Pruebas unitarias de API validan parámetros y SQL
parametrizado, incluyendo filtros anteriores a OFFSET/LIMIT. Las suites PostgreSQL de
integración requieren un entorno aislado y no se ejecutan sobre producción.
El runner limita la concurrencia a dos trabajadores y permite esperas acotadas para
renderizado diferido en máquinas con carga.

Comandos desde `apps/web`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
Desde `apps/api`: `npm test` (dobles de prueba; sin conexión productiva).
Revisión visual local con datos sintéticos a 360 px y 1440 px, sin solicitudes reales a la API.

No se cambia configuración productiva, JSON, descargadores, Power Automate, PostgreSQL,
PM2 ni importación automática. El problema pendiente de reportes mensuales vacíos se mantiene
fuera de esta etapa; no habilitar importaciones automáticas como parte del despliegue de la PWA.
