# Cartera de clientes

Monorepo para la aplicación de cartera de clientes.

## Componentes

- `apps/api`: API Node.js/Express ejecutada inicialmente en Ubuntu, conectada a PostgreSQL y con envío de actualizaciones mediante Microsoft Graph, correo y Power Automate hacia Excel en SharePoint.
- `apps/web`: carpeta reservada para la futura PWA de consulta y edición de la cartera.
- `docs`: documentación del proyecto.
- PostgreSQL se incorporará en una etapa futura como persistencia de la aplicación.

## Estado actual

La API permite consultar terminales paginadas en PostgreSQL, importar manualmente snapshots de Excel y enviar una actualización de celular a Power Automate. Para configurarla y ejecutarla, consulta [apps/api/README.md](apps/api/README.md).

Todavía no se implementan frontend/PWA, IndexedDB, Cloudflare Tunnel, autenticación de usuarios, edición desde la PWA ni resolución manual de conflictos.
