# Cartera de clientes

Monorepo para la aplicación de cartera de clientes.

## Componentes

- `apps/api`: API Node.js/Express ejecutada inicialmente en Ubuntu, conectada a PostgreSQL y con envío de actualizaciones mediante Microsoft Graph, correo y Power Automate hacia Excel en SharePoint.
- `apps/web`: carpeta reservada para la futura PWA de consulta y edición de la cartera.
- `docs`: documentación del proyecto.
- PostgreSQL se incorporará en una etapa futura como persistencia de la aplicación.

## Estado actual

La API incluye sesiones persistentes, roles `ADMIN`/`USUARIO`, consultas paginadas en PostgreSQL, importación manual de snapshots de Excel y envío de actualizaciones a Power Automate. Para configurarla y ejecutarla, consulta [apps/api/README.md](apps/api/README.md) y [docs/authentication.md](docs/authentication.md).

Todavía no se implementan frontend/PWA, IndexedDB, Cloudflare Tunnel, edición desde la PWA ni resolución manual de conflictos.
