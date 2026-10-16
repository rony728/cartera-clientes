# Revisión del PR #5 — etapa 2

Conclusión: preparado para fusionar el código revisado. La migración 005 es aditiva
y apta para ejecución controlada posterior, con respaldo, ON_ERROR_STOP, rol de
migración separado y grants revisados. No se ha autorizado ni realizado despliegue.

## Hallazgos corregidos

1. El listado no permitía filtros ni orden por última visita: ahora admite presencia,
   rango ISO, antigüedad de 2/3 meses calendario y orden, todos en PostgreSQL antes
   de paginar cuando intervienen en la selección. «Reciente» sigue sin definición,
   por decisión del usuario; no se ha inventado un umbral.
2. Un null confundía ausencia total con visitas solo del mes siguiente: se añade
   tiene_visitas_registradas al listado y a la consulta individual.
3. Resolver todas las fuentes en cada lectura costaba ~348–443 ms en el ensayo de
   100000 filas fuente. Se incorpora visitas_actuales, una proyección por ID sin
   JSONB, mantenida atómicamente con las fuentes y con índices propios. El listado
   común agrega solo para las terminales de su página; los filtros/orden de visitas
   siguen calculándose sobre todos los candidatos antes de paginar. La búsqueda
   también restringe los candidatos antes de agregar.
4. Se perdían microsegundos al convertir Modified a Date de JavaScript: ahora se
   conservan hasta seis decimales en SQL, evitando empates de versiones artificiales.
5. Repetir un hash de una fuente previamente obsoleta podía atribuir una recepción
   nueva al contenido más reciente retenido: la actualización de procedencia ahora
   exige coincidencia exacta del JSONB almacenado con el contenido del reporte.
6. Se añaden límites de espera y ejecución SQL, revocación PUBLIC y ejemplo de
   grants mínimos; las pruebas ejercitan esos grants con roles no propietarios.

## Comprobaciones solicitadas

| Punto | Evidencia |
| --- | --- |
| Retención indefinida | PK por fuente/ID y PK canónica por ID; vaciar reportes no borra visitas. MAX puede seguir devolviendo una visita de 2020. Correcciones de Terminal/Fecha recalculan la última visita correcta. |
| Sin visitas / antigüedad | Pruebas de null sin filas, null con solo fechas excluidas, rango explícito, umbrales de agosto/julio en octubre y transición a enero. |
| Paginación | Filtros y orden por visitas preceden LIMIT; prueba de página de tamaño 1 cuya selección correcta cambia por el filtro. Páginas consecutivas no comparten terminales. |
| Futuro permitido | Corte exclusivo inicio del próximo mes local; se admite el último microsegundo del mes y se excluye exactamente el siguiente mes. No hay límite inferior en MAX. |
| Estadísticas | COUNT(id) de proyección única, varias visitas por terminal cuentan varias veces y un ID compartido entre fuentes cuenta una vez. Incluye ceros por técnico. |
| LEFT JOIN / rendimiento | Un agregado por terminal; cardinalidad estable con 1000 terminales y 50000 IDs procedentes de 100000 filas fuente. EXPLAIN confirma una sola ejecución del agregado. |
| Migración / roles | Instalación completa de 001–005 en PostgreSQL 17 efímero. API puede consultar sin acceso al JSONB; importador puede escribir sin DELETE/DDL. Pruebas de rollback incluso ante fallo de la proyección. |
| Aislamiento de cartera | JSON/archivo inválido y fallo de importación no afectan listado ni health ni últimas visitas válidas; las regresiones de sincronización/sesiones siguen pasando. |

## Resultados

- API: 102 pruebas satisfactorias, ninguna omitida.
- PostgreSQL: 30 pruebas satisfactorias, ninguna omitida, con datos sintéticos,
  socket privado sin TCP y servidor efímero detenido al finalizar.
- EXPLAIN ANALYZE en el último ensayo (100000 filas fuente, 50000 IDs, 1000 terminales):
  listado base 1,053 ms; con visitas 13,585 ms; búsqueda base 0,631 ms; con visitas
  0,561 ms; filtro/orden por antigüedad 64,117 ms. Son medidas locales de una
  ejecución, no una garantía de latencia en producción ni de retención ilimitada.

## Límites y activación pendiente

La retención no impone caducidad ni eliminación por ausencia. El coste de ordenar o
filtrar por visitas crece con los candidatos; monitorizar volumen/latencia y revisar
planes al crecer. Correcciones sin nueva versión Modified se resuelven por recepción,
con mensual ganando el empate, según la prioridad ya documentada; no se cambió esa
regla de negocio. No hay inferencia de bajas ni de mantenimiento fuera de los datos
registrados.

Antes de producción: respaldar y revisar propietario, grants heredados, existencia
de nombres nuevos y versión del esquema; ejecutar 005 una sola vez con
ON_ERROR_STOP y aplicar grants específicos a los roles reales. Mantener ambos flags
deshabilitados hasta una importación controlada y verificación de resultados.
La guía completa de activación/reversión está en visitas-etapa2.md. No ejecutar
setup de pruebas sobre producción. No se ha modificado producción, fusionado el PR,
reiniciado PM2 ni activado temporizadores durante esta revisión.
