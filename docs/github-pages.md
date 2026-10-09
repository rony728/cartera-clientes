# Despliegue del frontend en GitHub Pages

La PWA se compila y publica desde `apps/web` mediante `.github/workflows/deploy-pages.yml`. La API y PostgreSQL permanecen en Ubuntu; el artefacto Pages contiene únicamente `apps/web/dist`.

## Flujo automático

Cada push a `main` y cada ejecución manual realiza:

1. `npm ci` en `apps/web`.
2. ESLint, TypeScript y Vitest.
3. Build con `VITE_API_URL=https://api-cartera.rtdev.uk`.
4. Verificación de `index.html`, `404.html`, `CNAME`, manifest y Service Worker.
5. Carga del directorio `apps/web/dist` con `actions/upload-pages-artifact`.
6. Publicación con `actions/deploy-pages` en el entorno `github-pages`.

El workflow usa las acciones oficiales `checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact` y `deploy-pages`. No carga el repositorio completo como artefacto ni utiliza secretos de aplicación.

## Activación manual en GitHub

GitHub Pages para un repositorio privado personal requiere un plan que lo permita, actualmente GitHub Pro; en organizaciones requiere GitHub Team o Enterprise Cloud. El sitio publicado será público aunque el código fuente permanezca privado, salvo controles específicos disponibles en determinados planes Enterprise.

Al preparar este despliegue, la API de GitHub rechazó la activación con HTTP 422 porque el plan actual de la cuenta no admite Pages para este repositorio privado. Antes de que el workflow pueda publicar, se debe actualizar a un plan compatible o decidir explícitamente cambiar la visibilidad del repositorio. Este trabajo no cambia la visibilidad.

Con permisos administrativos:

1. Abrir `Settings → Pages` en `rony728/cartera-clientes`.
2. En `Build and deployment`, seleccionar `GitHub Actions` como fuente.
3. En `Custom domain`, registrar `cartera.rtdev.uk` y guardar.
4. Esperar a que GitHub valide DNS y emita el certificado.
5. Activar `Enforce HTTPS` únicamente cuando GitHub lo habilite.

El archivo `CNAME` se incluye en el artefacto porque forma parte del requisito y facilita su inspección. En despliegues mediante GitHub Actions, GitHub exige además configurar el dominio en `Settings → Pages`; el archivo por sí solo no activa el dominio.

## DNS

En la zona DNS de `rtdev.uk`, crear o reemplazar exclusivamente el registro del frontend:

```text
Tipo:   CNAME
Nombre: cartera
Destino: rony728.github.io
```

El destino no debe incluir `/cartera-clientes`. No modificar `api-cartera.rtdev.uk`, que continúa apuntando al servicio Ubuntu existente. Antes de cambiar DNS, conviene verificar el dominio en la cuenta de GitHub para reducir el riesgo de apropiación del subdominio.

Si Cloudflare administra la zona, comprueba que no exista otro CNAME o ruta de Tunnel para `cartera`. Para la validación inicial del certificado es recomendable mantener el registro como `DNS only`; cualquier cambio posterior del proxy debe validarse sin alterar el registro de la API.

La propagación DNS puede tardar hasta 24 horas. En Windows se puede comprobar con:

```powershell
Resolve-DnsName cartera.rtdev.uk -Type CNAME
```

El resultado esperado es `rony728.github.io`. Esto no confirma por sí solo que Pages o HTTPS estén listos; también deben revisarse `Settings → Pages` y el deployment más reciente del entorno `github-pages`.

## Rutas SPA y PWA

Vite usa `base: '/'`, adecuado para el dominio personalizado. GitHub Pages no permite configurar un fallback HTTP para SPA, por lo que `public/404.html` redirige la ruta solicitada hacia `/` usando el parámetro temporal `__spa_route`. Un script pequeño en `index.html` restaura esa ruta mediante `history.replaceState` antes de cargar React. Así se mantienen `BrowserRouter`, URLs limpias, query strings, cookies y autenticación.

Una vez instalado el Service Worker, Workbox atiende navegaciones con `index.html`. El manifest, icono, `start_url`, `scope` y recursos usan la raíz del dominio. Las solicitudes a `https://api-cartera.rtdev.uk/api/` son `NetworkOnly` y nunca se guardan en Cache Storage.

La URL predeterminada `https://rony728.github.io/cartera-clientes/` no es el destino soportado por este build, porque los recursos se generan para la raíz del dominio personalizado.

## Verificación posterior

Después de habilitar Pages y configurar DNS:

1. Confirmar que el workflow termina en verde y muestra la URL del deployment.
2. Abrir `https://cartera.rtdev.uk/`.
3. Abrir directamente `/login`, `/comercios`, `/dashboard` y una ruta de detalle; recargar cada una.
4. Verificar login, cookie, CSRF y llamadas a `https://api-cartera.rtdev.uk`.
5. Instalar la PWA, recargarla offline y verificar que la API no aparece en Cache Storage.
6. Confirmar manifest, icono y Service Worker en las herramientas del navegador.

No se debe afirmar que el dominio está operativo hasta que DNS, certificado, deployment y estas pruebas reales hayan sido comprobados.
