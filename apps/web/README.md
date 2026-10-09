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

Consulta [../../docs/frontend-architecture.md](../../docs/frontend-architecture.md) para contratos, seguridad y limitaciones.
