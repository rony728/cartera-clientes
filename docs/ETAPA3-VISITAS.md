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
La API anuncia `capacidades.filtros_variantes=true` en las opciones. Si falta esa capacidad,
la PWA bloquea solo las consultas que requieren expansión y ofrece quitar filtros; nunca
publica una página parcial como completa. Cada respuesta con variantes confirma además
`filtros_variantes_aplicadas=true`; si falta, se rechaza incluso con la capacidad cacheada
tras una reversión de la API.
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
integración se verificaron en PostgreSQL 17 efímero, con socket privado y TCP deshabilitado.
No utilizan la base ni credenciales productivas.
El runner limita la concurrencia a dos trabajadores y permite esperas acotadas para
renderizado diferido en máquinas con carga.

Comandos desde `apps/web`: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
Desde `apps/api`: `npm test` (dobles de prueba; sin conexión productiva).
Revisión visual local con datos sintéticos a 360 px y 1440 px, sin solicitudes reales a la API.

No se cambia configuración productiva, JSON, descargadores, Power Automate, PostgreSQL,
PM2 ni importación automática. El problema pendiente de reportes mensuales vacíos se mantiene
fuera de esta etapa; no habilitar importaciones automáticas como parte del despliegue de la PWA.

La publicación automática en push a main se sustituye por compilación y publicación manual
confirmada después de verificar la API. Procedimiento y reversión: [DESPLIEGUE-ETAPA3.md](DESPLIEGUE-ETAPA3.md).

## Revisión previa a integración del PR #6

Resultado final: 108/108 pruebas web, 104/104 unitarias de API y 32/32 de integración
con PostgreSQL **17.11**. TypeScript, ESLint, build PWA, sintaxis YAML del workflow y
sintaxis bash del procedimiento verificados. El clúster de pruebas se crea con directorio
privado, socket exclusivo y `listen_addresses=''`; se detiene y elimina al finalizar.
Las variables de conexión del proceso de pruebas también apuntan al clúster efímero,
para que ningún pool auxiliar herede un destino productivo.

Las pruebas reales de SQL comprueban dos campos con variantes combinados con visitas,
los totales y páginas 1/2, orden asc/desc y nulos al final, búsquedas anteriores, valores
literales que parecen inyección, confirmación HTTP de aplicación de variantes, límites
locales de enero y fechas futuras dentro/fuera del mes actual. No se cambió la regla de MAX.
Se mantienen las regresiones de edición, copia, navegación, permisos, fotos y caché offline.

Medición final con EXPLAIN ANALYZE/BUFFERS sobre datos sintéticos:

| Consulta | Tiempo PostgreSQL |
| --- | ---: |
| Listado con visitas | 19,9 ms |
| Búsqueda por terminal con visitas | 0,8 ms |
| Antigüedad por meses | 112,5 ms |
| Variantes y orden por visita | 142,6 ms |
| Variantes y filtro de 2 meses (página 3) | 139,8 ms |
| Variantes y rango de fechas | 143,8 ms |

Volumen: 1.000 terminales, 100.000 filas de fuente, 50.000 IDs únicos. Se comprueban
páginas sin duplicados y agregados ejecutados una sola vez, sin derrames de ordenamiento
ni agregación a disco. Son muestras locales, sin simular concurrencia de usuarios;
otras ejecuciones bajo carga variaron. No constituyen un SLA productivo.

Problemas corregidos en la revisión:

1. Publicación automática en main podía adelantarse a la API: ahora push solo construye;
   publicar requiere workflow_dispatch y confirmar la revisión API comprobada.
2. API antigua podía ignorar variantes y devolver resultados parciales: detección de
   capacidad y confirmación por respuesta, incluida una reversión con capacidad cacheada.

No se detectaron otros bloqueos para fusionar. La autorización de despliegue sigue
separada y exige comprobar la API antes de publicar Pages. El procedimiento fija una
etiqueta del merge para poder revertir aunque main avance. La confirmación SHA del
workflow depende de comprobaciones del operador y no autentica por sí sola al servidor.
Los clientes con service worker no se actualizan instantáneamente; conservar la API
compatible durante la propagación y seguir las pruebas de la guía.

Los siete archivos locales originalmente sin seguimiento se verificaron mediante hashes
y modos, sin sobrescribirlos ni eliminarlos. La salud productiva observada fue 200 y
PostgreSQL conectado, sin ejecutar migraciones, importaciones ni reiniciar PM2.
