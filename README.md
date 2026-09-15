# Cartera de clientes

Monorepo para la aplicación de cartera de clientes.

## Componentes

- `apps/api`: API Node.js/Express ejecutada inicialmente en Ubuntu, con envío de actualizaciones mediante Microsoft Graph, correo y Power Automate hacia Excel en SharePoint.
- `apps/web`: carpeta reservada para la futura PWA de consulta y edición de la cartera.
- `docs`: documentación del proyecto.
- PostgreSQL se incorporará en una etapa futura como persistencia de la aplicación.

## Estado actual

La API mínima ya permite enviar una actualización de celular a Power Automate. Para configurarla y ejecutarla, consulta [apps/api/README.md](apps/api/README.md).

Todavía no se implementan frontend/PWA, IndexedDB, PostgreSQL, Cloudflare Tunnel, autenticación de usuarios ni otros campos del Excel.
