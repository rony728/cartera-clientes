# PWA Cartera de Clientes

Frontend React/TypeScript para consulta rápida online y offline. Requiere Node.js 20.19 o superior.

## Desarrollo y pruebas

```sh
npm install
cp .env.example .env
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

`VITE_API_URL` es la única URL pública requerida. En desarrollo usa `http://127.0.0.1:3005`; el build de Ubuntu debe usar `https://api-cartera.rtdev.uk`. Las variables `VITE_*` son públicas: nunca deben contener claves o secretos.

## Build y despliegue

```sh
cd apps/web
npm ci
VITE_API_URL=https://api-cartera.rtdev.uk npm run build
```

El frontend se publica automáticamente en GitHub Pages desde `main`. La configuración del workflow, dominio, DNS y fallback de rutas está en [../../docs/github-pages.md](../../docs/github-pages.md). La API y PostgreSQL continúan en Ubuntu.

## Prueba manual mínima

1. Iniciar sesión y comprobar que abre Comercios.
2. Buscar, filtrar, ordenar y regresar desde detalle conservando parámetros.
3. Editar una activa, comprobar historial y probar conflicto desde dos pestañas.
4. Instalar la PWA, actualizar la copia, desconectar la red y buscar/exportar.
5. Verificar que logout borra la copia local y que `USUARIO` no ve inactivas ni administración.
6. Probar permisos denegados, selección de cámara y lectura QR/código en HTTPS.

## Consulta sin conexión

La búsqueda offline procesa la copia completa asociada al usuario en IndexedDB. Busca por coincidencia parcial en Terminal y en los valores comerciales —incluidos campos dinámicos— sin distinguir mayúsculas, minúsculas ni tildes. Los nombres internos de las propiedades no cuentan como coincidencias.

Los filtros, estado, orden y paginación se aplican sobre los registros locales. Las opciones de filtro también se derivan de la copia completa, sin consultar la API. Si una búsqueda conserva filtros en la URL, la pantalla muestra cuántos están activos y permite limpiarlos para distinguir un término ausente de una coincidencia excluida por filtros.

Las consultas locales de TanStack Query usan modo de red `always`: deben ejecutarse aunque el navegador y el propio cliente de consultas estén marcados sin conexión. Las claves de caché incluyen el usuario y el modo online/offline. El identificador de usuario se canoniza como texto antes de construir claves como `1:00000284` o consultar el índice `userId`; la autorización local se vuelve a comprobar al producirse la desconexión y una autorización vencida no habilita la cartera.

La pantalla diferencia un resultado válido sin coincidencias de un fallo al leer IndexedDB. Un error local permite reintentar y no elimina la copia descargada.

Para verificar una copia descargada, desconecta la red y prueba al menos una Terminal conocida y coincidencias parciales de Nombre comercial, Código de comercio, Serie POS e Inventario. Abre después la ficha para confirmar que sus campos dinámicos están disponibles.

Consulta [../../docs/frontend-architecture.md](../../docs/frontend-architecture.md) para contratos, seguridad y limitaciones.
