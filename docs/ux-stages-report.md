# Informe de mejoras UX — etapas 1 a 4

Fecha de cierre técnico: 2026-10-10. Alcance: frontend PWA. No se modificaron API, PostgreSQL, sincronización, Power Automate, contratos de datos, Cloudflare, PM2 ni Ubuntu.

## Cambios entregados

- Etapa 1: densidad y jerarquía de Comercios, búsqueda predeterminada por Nombre comercial, Herramientas, filtros compactos, tarjetas móviles seleccionables, copia rápida y representación de datos vacíos.
- Etapa 2: ficha priorizada, grupos secundarios, historial después de los datos, edición ordenada por tareas, tipos de campo adecuados, acciones únicas y persistentes, conflictos sin pérdida y contrato futuro de fotografía documentado.
- Etapa 3: selector de columnas adaptable y persistente, normalización segura de filtros, orden accesible, tablas accesibles del Dashboard, estados vacíos accionables y feedback unificado de copia.
- Etapa 4: retorno a la posición exacta de la lista, propagación del contexto por ficha/edición, tabla de escritorio con ancho controlado y desplazamiento indicado, áreas táctiles y seguras reforzadas, y regresiones automatizadas.

## Estado de los hallazgos

La correspondencia se reconstruye a partir del alcance explícito de las cuatro etapas; el repositorio no contiene un documento de auditoría independiente con las descripciones originales.

| Hallazgo | Tema verificado | Estado | Evidencia o pendiente |
| --- | --- | --- | --- |
| UX-001 | Densidad y navegación de Comercios móvil | Parcialmente resuelto | Tarjetas compactas, navegación inferior y controles adaptables; falta prueba física en 360/390/430 px. |
| UX-002 | Campo de búsqueda inicial | Resuelto | Nombre comercial es el valor predeterminado y los parámetros explícitos se respetan. |
| UX-003 | Acciones secundarias | Resuelto | Herramientas reúne actualización, columnas y exportación con cierre por Escape/exterior. |
| UX-004 | Filtros y orden móvil | Resuelto | Panel compacto, contador, limpieza y orden móvil sin alterar URL/consulta. |
| UX-005 | Retorno a posición de la lista | Resuelto | Restauración condicionada por contexto exacto; soporta detalle, edición, Cancelar e historial. |
| UX-006 | Selección de texto en tarjetas | Parcialmente resuelto | La tarjeta ya no es un enlace contenedor y admite selección CSS; falta pulsación prolongada real. |
| UX-007 | Copia rápida de identificadores | Resuelto | Terminal, Serie POS e Inventario se copian sin activar navegación y anuncian resultado. |
| UX-008 | Datos vacíos | Resuelto | Se distingue “Sin dato”/guion de ausencia estructural sin alterar registros. |
| UX-009 | Configuración de columnas | Resuelto | Filas cohesionadas, controles descriptivos, scroll interno, columnas dinámicas y preferencias por usuario. |
| UX-010 | Variantes equivalentes de filtros | Resuelto con limitación | Agrupación online/offline sin reescritura; online puede ejecutar varias lecturas por grupo. |
| UX-011 | Jerarquía de ficha | Resuelto | Identidad, datos principales, grupos, fotografía y luego historial. |
| UX-012 | Ordenamiento accesible | Resuelto | `aria-sort`, dirección anunciada, foco y activación por teclado. |
| UX-013 | Interpretación accesible del Dashboard | Resuelto con limitación | Gráficos interactivos acompañados por tablas de categoría/cantidad y navegación filtrada; el frontend solo puede reagrupar las categorías entregadas por el endpoint estadístico. |
| UX-014 | Edición móvil y tipos de entrada | Parcialmente resuelto | Orden, `tel`/`email`, una acción de guardado y barra segura; falta teclado virtual real. |
| UX-015 | Estado vacío de búsqueda | Resuelto | Diferencia carga/error/vacío y ofrece Limpiar búsqueda/Quitar filtros sin consulta extra. |
| UX-016 | Desbordamiento de tabla escritorio | Resuelto | Anchos fijos para datos críticos, truncado consultable y scroll indicado cuando hay muchas columnas. |
| UX-017 | Confirmación de copia | Resuelto | “Copiado”/error por `aria-live`, sin avisos duplicados ni navegación accidental. |

## Matriz de validación

Automatizado en Vitest/jsdom: permisos, rutas, URL, retorno exacto, descarte de scroll obsoleto, Cancelar edición, online/offline, IndexedDB, filtros equivalentes, Dashboard, columnas, copia, estados vacíos, seguridad de UI y flujo con 1,000 registros. TypeScript, ESLint y build se ejecutan como puertas independientes.

Se ejecutó además una revisión en navegador del build local con API sintética de solo lectura:

| Vista | Resultado |
| --- | --- |
| 360, 390, 430 y 768 px | Tarjetas y navegación inferior visibles; búsqueda dentro del viewport; sin overflow horizontal; controles de copia de 42 px. |
| 1366 px, columnas predeterminadas | Tabla visible, 1041 px de contenido en 1041 px disponibles; sin overflow de página. |
| 1366 px, 13 columnas | Scroll interno de 1590 px en contenedor de 1041 px, pista visible y sin overflow de página. |
| Ficha y edición a 360 px | Sin overflow horizontal; retorno/edición de 42 px; acciones de edición contenidas y visibles. |

Validación manual requerida antes de producción:

1. Repetir la matriz 360, 390, 430, 768 y 1366 px en navegadores/dispositivos objetivo, incluido WebKit móvil; la revisión local no sustituye hardware real.
2. En móvil real, abrir el teclado en búsqueda y edición; confirmar campo enfocado, acciones visibles, navegación inferior y área segura.
3. Verificar pulsación prolongada y selección de texto sin apertura accidental de ficha.
4. Habilitar muchas columnas y comprobar pista, foco y desplazamiento horizontal; con columnas predeterminadas a 1366 px no debe existir desbordamiento apreciable.
5. Probar cámara, linterna, PWA instalada y transición online → offline → online en equipos reales.
6. Ejecutar Lighthouse desde un entorno servido por HTTPS y sesión de prueba. No se registró una puntuación desde jsdom porque no sería representativa.

Riesgos conocidos: una selección con varias categorías equivalentes puede multiplicar las lecturas GET porque el contrato actual filtra por valor exacto; se deduplica por Terminal y no se realizan escrituras. El Dashboard suma correctamente las variantes presentes en la respuesta, pero el endpoint limita cada distribución y una variante fuera de ese límite no puede incorporarse sin cambiar el backend.

## Integración

Las ramas son acumulativas: `ux/etapa-2-ficha-comercios` parte de etapa 1, `ux/etapa-3-filtros-accesibilidad` parte de etapa 2 y `ux/etapa-4-navegacion-regresion` parte de etapa 3. Para revisión integral basta usar la rama de etapa 4. Integrar mediante pull request hacia la rama de desarrollo elegida, ejecutar sus verificaciones y solo después promover a `main`; no es necesario fusionar las etapas individualmente.
