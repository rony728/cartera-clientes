# Publicación coordinada de la etapa 3

**Procedimiento preparado; no ejecutado. Requiere autorización de fusión/despliegue.**
No aplica migraciones, importaciones, cambios de datos ni flags. No instala dependencias.
Actualizar solo `cartera-clientes-api`; ningún otro proceso PM2.

## Estado comprobado durante la revisión

- PM2: `cartera-clientes-api`, id 2, online. CWD `/home/rony/cartera-clientes/apps/api`.
  Ejecuta npm mediante Node `/home/rony/.nvm/versions/node/v24.11.0/bin/node`.
- Salud local: HTTP 200, PostgreSQL conectado. Listado sin sesión: HTTP 401.
- `.env` 0600; `VISITAS_ENABLED=true`. `VISITAS_IMPORT_ENABLED` ausente, equivalente a false.
- Pages usa Actions; último despliegue exitoso comprobado: commit
  `65e47c047a6e7e7f0665cfeb6d05d1f84af13619`, ejecución `38910413009`, deployment `7120578866`.
  Volver a consultar este dato antes de publicar; podría haber cambiado.
- API de etapa 2 aprobada: mismo árbol de código que ese commit. Confirmar su correspondencia
  con la bitácora de despliegue antes de usarla para reversión. **El HEAD del checkout compartido
  no prueba qué revisión tiene cargada el proceso Node que ya estaba ejecutándose.**
- Existen archivos locales sin seguimiento de etapas anteriores: preservarlos. No usar
  `git clean`, `git reset --hard`, cambios de rama ni `git pull` sobre el checkout activo.

## Orden obligatorio

1. Fusionar el PR únicamente después de su aprobación. El nuevo workflow en `main`
   ejecuta comprobaciones y construye el artefacto, pero **omite el job deploy en push**.
   Comprobar explícitamente ese estado; Pages debe seguir sirviendo la versión anterior.
2. Fijar el SHA completo resultante de `main`, respaldar la configuración y preparar
   los tres archivos compatibles de la API de esa revisión.
3. Instalar esos tres archivos y reiniciar exclusivamente `cartera-clientes-api`.
4. Verificar salud, sesiones, contrato de variantes y regresiones con la PWA anterior.
   Si falla una comprobación crítica, revertir API y **no publicar Pages**.
5. Ejecutar manualmente el workflow de Pages con ese mismo SHA aprobado en `api_revision`.
6. Comprobar la PWA publicada, incluidos clientes con service worker y caché anterior.

`api_revision` es una confirmación del operador, no un sondeo remoto automático.
La comprobación bloquea un SHA distinto al de la ejecución, salvo una reversión donde
API y frontend vuelven al mismo SHA. No sustituye las pruebas del paso 4.

## Preparación de artefactos y respaldo (solo tras autorización)

Ejecutar en una terminal del usuario `rony`, sin `set -x`. No requiere sudo.
Las variables siguientes contienen identificadores/rutas, nunca credenciales.

```bash
set -euo pipefail
umask 077
REPO=/home/rony/cartera-clientes
API=/home/rony/cartera-clientes/apps/api
BASE_API=65e47c047a6e7e7f0665cfeb6d05d1f84af13619
BASE_WEB=65e47c047a6e7e7f0665cfeb6d05d1f84af13619
# Confirmar BASE_API en la bitácora y BASE_WEB en el último deployment exitoso.
RELEASE_SHA=$(gh api repos/rony728/cartera-clientes/git/ref/heads/main --jq .object.sha)
MERGED_PR_SHA=$(gh pr view 6 --repo rony728/cartera-clientes --json state,mergeCommit \
  --jq 'if .state == "MERGED" then .mergeCommit.oid else empty end')
test -n "$MERGED_PR_SHA" && test "$RELEASE_SHA" = "$MERGED_PR_SHA"
RELEASE_TAG="etapa3-${RELEASE_SHA:0:12}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
git -C "$REPO" fetch origin main
# Debe ser el merge aprobado del PR #6; detenerse si no coincide.
test "$(git -C "$REPO" rev-parse origin/main)" = "$RELEASE_SHA"
BACKUP_ROOT=/home/rony/cartera-clientes-backups
mkdir -p "$BACKUP_ROOT"
# No modificar los permisos de otros directorios existentes.
BACKUP=$(mktemp -d "$BACKUP_ROOT/etapa3-$(date -u +%Y%m%d-%H%M%S)-XXXXXX")
chmod 0700 "$BACKUP"
mkdir -m 0700 "$BACKUP/current" "$BACKUP/stage" "$BACKUP/rollback"
install -m 0600 "$API/.env" "$BACKUP/api.env"
sha256sum "$API/.env" > "$BACKUP/env.sha256"
printf '%s\n' "$RELEASE_SHA" > "$BACKUP/release-sha.txt"
printf '%s\n' "$RELEASE_TAG" > "$BACKUP/release-tag.txt"
printf '%s\n' "$BASE_WEB" > "$BACKUP/pages-previo-sha.txt"
```

Registrar nuevamente los archivos sin seguimiento y sus hashes en un manifiesto privado
antes de instalar. Al terminar deben conservar exactamente nombres, contenido y permisos.
Los comandos siguientes solo sustituyen tres archivos **rastreados** ya existentes:

```bash
FILES=(apps/api/src/terminales/validation.js apps/api/src/terminales/queries.js apps/api/src/terminales/routes.js)
for rel in "${FILES[@]}"; do
  git -C "$REPO" ls-files --error-unmatch "$rel" >/dev/null
  test -f "$REPO/$rel" && test ! -L "$REPO/$rel"
done
git -C "$REPO" archive "$RELEASE_SHA" "${FILES[@]}" | tar -xf - -C "$BACKUP/stage"
git -C "$REPO" archive "$BASE_API" "${FILES[@]}" | tar -xf - -C "$BACKUP/rollback"
for rel in "${FILES[@]}"; do
  mkdir -p "$BACKUP/current/$(dirname "$rel")"
  install -m 0600 "$REPO/$rel" "$BACKUP/current/$rel"
  node --check "$BACKUP/stage/$rel"
  node --check "$BACKUP/rollback/$rel"
done
find "$BACKUP" -type d -exec chmod 0700 {} +
find "$BACKUP" -type f -exec chmod 0600 {} +
```

`current/` guarda el contenido de disco, que puede corresponder al PR; `rollback/`
contiene el artefacto de la versión productiva anterior confirmada. No confundirlos.
Revisar el diff de los tres archivos y confirmar que los package-lock no cambiaron:

```bash
git -C "$REPO" diff "$BASE_API" "$RELEASE_SHA" -- apps/api/package.json apps/api/package-lock.json
# La salida debe estar vacía; no instalar ni actualizar paquetes.
git -C "$REPO" diff "$BASE_API" "$RELEASE_SHA" -- "${FILES[@]}"
```

Si aparece una dependencia o archivo de runtime adicional, detenerse y revisar este plan.
No copiar directorios completos ni usar archivos sin seguimiento como fuente de instalación.

## Instalar API y comprobarla (solo tras autorización)

Instalar validación y consultas antes de anunciar la capacidad desde las rutas. Los módulos
actuales permanecen cargados hasta el reinicio. Ante fallo parcial, restaurar el trío aprobado
antes de reiniciar; no dejar una instalación parcial.

```bash
for rel in "${FILES[@]}"; do
  dest="$REPO/$rel"
  mode=$(stat -c %a "$dest")
  tmp=$(mktemp "$(dirname "$dest")/.etapa3-XXXXXX")
  install -m "$mode" "$BACKUP/stage/$rel" "$tmp"
  mv -T "$tmp" "$dest"
  cmp "$BACKUP/stage/$rel" "$dest"
done
sha256sum -c "$BACKUP/env.sha256"
pm2 restart cartera-clientes-api
```

No usar `--update-env`, `pm2 restart all`, ni cambiar flags o secretos. El servicio existente
carga el mismo `.env` mediante dotenv. El respaldo de configuración es preventivo; este
procedimiento no modifica ni restaura `.env` automáticamente.

Prueba de salud sin mostrar la API key ni colocarla en argumentos del proceso:

```bash
cd "$API"
node <<'JS'
require('dotenv').config({quiet:true});
(async()=>{
 const base='http://127.0.0.1:'+Number(process.env.PORT||3005);
 const r=await fetch(base+'/api/v1/health',{headers:{'X-API-Key':process.env.API_KEY}});
 const b=await r.json();
 if(r.status!==200||b.database!=='connected')throw Error();
 const anon=await fetch(base+'/api/v1/terminales');
 if(anon.status!==401)throw Error();
 console.log('Salud y protección de sesión: correctas');
})().catch(()=>{console.error('Falló la comprobación de salud o sesión');process.exitCode=1;});
JS
```

Con una sesión ya autenticada en la PWA anterior, sin capturar cookies/tokens ni
solicitar contraseñas al agente, comprobar mediante GET:

- `/api/v1/terminales/filtros/opciones`: `capacidades.filtros_variantes=true`.
- Listado normal, búsqueda NombreComercial y Terminal, orden habitual y páginas 1/2.
- Listado con categoría y `filtros_variantes` de dos valores realmente disponibles;
  comprobar `filtros_variantes_aplicadas=true`, total y páginas; no asumir que el filtro literal incluye todas las variantes.
- Presencia con/sin visitas, antigüedad 2/3, rango y orden por `ultima_visita` asc/desc;
  nulos al final. El rango enviado a la API es `[desde,hasta)` con zona explícita.
- Última visita, estadísticas del **mes actual de Honduras**, estado de visitas solo ADMIN.
- Abrir edición y cancelar; no guardar ni enviar correos reales. Fotografías e historial
  siguen consultándose; comprobar también búsqueda/copia con la PWA anterior.
- Registrar PM2 online, salud, flags y conteos antes/después mediante consultas de lectura:
  terminales, fotografías, historial, visitas canónicas y auditoría de importaciones.
  No comparar producción con los conteos sintéticos de la suite.

Si no hay sesión segura disponible, detener la publicación hasta completar esas
comprobaciones manuales. No crear usuarios ni sesiones sintéticas en producción.

## Publicar Pages (solo después de comprobar la API)

Tras validar la API, crear una etiqueta explícita del merge aprobado para que publicación y
reversión no dependan de futuros cambios en main. No sobrescribir etiquetas existentes.
Desde el repositorio con gh autenticado, usar el SHA completo ya fijado:

```bash
test "$(gh api repos/rony728/cartera-clientes/git/ref/heads/main --jq .object.sha)" = "$RELEASE_SHA"
git -C "$REPO" tag -a "$RELEASE_TAG" "$RELEASE_SHA" -m "Publicación coordinada de etapa 3"
git -C "$REPO" push origin "refs/tags/$RELEASE_TAG"
# Si la etiqueta ya existe, detenerse y verificar su destino; nunca forzarla.
test "$(git -C "$REPO" rev-parse "$RELEASE_TAG^{commit}")" = "$RELEASE_SHA"
gh workflow run deploy-pages.yml --repo rony728/cartera-clientes --ref "$RELEASE_TAG" -f api_revision="$RELEASE_SHA"
gh run list --repo rony728/cartera-clientes --workflow deploy-pages.yml --event workflow_dispatch --limit 5
# Seleccionar la ejecución recién creada: head_sha debe ser RELEASE_SHA.
# Sustituir RUN_ID por ese identificador antes de ejecutar:
gh run watch RUN_ID --repo rony728/cartera-clientes --exit-status
```

Si `main` cambió, no confirmar otro SHA por conveniencia: volver a fijar/revisar los artefactos.
Comprobar deployment exitoso para el SHA correcto, dominio, rutas SPA, manifest y `sw.js`.
En móvil/escritorio comprobar fecha, avisos, nulos, filtros, ambas direcciones, redimensión,
paginación, retorno de ficha, siete copias y edición cancelada. Actualizar la PWA instalada,
probar una pestaña anterior y una nueva; refrescar la copia offline de manera explícita,
desconectar/reconectar y comprobar separación por usuario. No borrar IndexedDB ni sesiones
para forzar la actualización. Un cliente antiguo puede seguir usando su shell precargado.

## Reversión

Recuperar BACKUP, RELEASE_SHA, RELEASE_TAG y BASE_WEB del registro privado de esta
intervención. Comprobar que la etiqueta remota sigue apuntando al merge aprobado.
No despachar la reversión desde un main que haya avanzado a otra revisión.

**Fallo de API antes de publicar:** Pages permanece en su SHA anterior. Restaurar únicamente
el trío de `rollback/`, con reemplazo temporal/atómico y modos existentes como en la instalación,
reiniciar solo `cartera-clientes-api` y repetir salud y consultas con la PWA anterior.
No deshacer migraciones ni tocar datos o flags.

```bash
for rel in "${FILES[@]}"; do
  dest="$REPO/$rel"
  mode=$(stat -c %a "$dest")
  tmp=$(mktemp "$(dirname "$dest")/.etapa3-rollback-XXXXXX")
  install -m "$mode" "$BACKUP/rollback/$rel" "$tmp"
  mv -T "$tmp" "$dest"
  cmp "$BACKUP/rollback/$rel" "$dest"
done
sha256sum -c "$BACKUP/env.sha256"
pm2 restart cartera-clientes-api
# Repetir el bloque de salud y las pruebas GET indicadas arriba.
```

**Fallo de PWA después de publicar:** conservar primero la API nueva compatible con ambos
frontends y republicar el frontend anterior desde el workflow de la etiqueta de release confirmada:

```bash
gh workflow run deploy-pages.yml --repo rony728/cartera-clientes --ref "$RELEASE_TAG" \
  -f api_revision="$RELEASE_SHA" -f frontend_revision="$BASE_WEB"
```

Comprobar el deployment y probar actualización de service worker en clientes existentes.
Aunque el workflow de control tenga SHA nuevo, el código/artifact de frontend debe ser
el SHA `BASE_WEB` elegido mediante checkout; comprobar ese paso en los logs de Actions.
Conservar la API compatible mientras puedan quedar clientes nuevos cacheados.

**Fallo crítico de API con PWA nueva ya publicada:** restaurar primero la disponibilidad
comercial de la API anterior y publicar inmediatamente el par anterior confirmado:

```bash
# Después de restaurar y comprobar la API BASE_API:
test "$BASE_API" = "$BASE_WEB"
gh workflow run deploy-pages.yml --repo rony728/cartera-clientes --ref "$RELEASE_TAG" \
  -f api_revision="$BASE_API" -f frontend_revision="$BASE_WEB"
```

La PWA nueva detectará la ausencia de la capacidad y mostrará un error recuperable para
categorías equivalentes, en lugar de resultados parciales. Los clientes sin actualizar
pueden requerir volver a abrir la aplicación; una reversión de Pages no invalida
instantáneamente todos los service workers. No eliminar cachés privados globalmente.
Conservar respaldos y hashes; verificar de nuevo el manifiesto de archivos sin seguimiento.
