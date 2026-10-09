# Cartera de Clientes

Monorepositorio de una aplicación empresarial para consultar y mantener una cartera de terminales POS. Incluye una PWA React offline-first, una API Express ejecutada en Ubuntu, PostgreSQL y sincronización controlada con Excel de SharePoint mediante Microsoft Graph, correo y Power Automate.

## Aplicaciones

- `apps/web`: PWA React + TypeScript + Vite. Búsqueda paginada, filtros, detalle y edición, historial, dashboard, administración, exportación y escáner.
- `apps/api`: API Express, sesiones PostgreSQL, roles, CSRF, consultas y sincronización.
- `database/migrations`: esquema PostgreSQL versionado.
- `docs`: arquitectura, seguridad, pruebas y despliegue.

## Desarrollo

```sh
cd apps/api
npm install
npm test
npm run start:api

cd ../web
npm install
cp .env.example .env
npm run dev
```

La guía del frontend está en [apps/web/README.md](apps/web/README.md), sus decisiones técnicas en [docs/frontend-architecture.md](docs/frontend-architecture.md) y el despliegue automático en [docs/github-pages.md](docs/github-pages.md). Ningún `.env`, token, contraseña o API key debe incorporarse al repositorio ni al bundle web.
