# Inventario del puente heredado Gestión–Tabulación

**Baseline inspeccionado:** `feat/single-app-domain-contracts` · `2145631cff3c8257957892ff2bff72669c066920`  
**PR:** [#84](https://github.com/luis-ma-m/cronometro-debate-academico/pull/84)  
**Alcance:** inventario estático de lectores, escritores, claves, formatos y dependencias. No cambia el comportamiento ni migra datos.

## 1. Conclusión ejecutiva

El puente heredado no es una sola clave ni un único flujo. Es un conjunto de mecanismos que conviven:

1. Dos hand-offs globales de `localStorage` para pasar participantes y propuestas de ronda entre shells.
2. Un vínculo persistido dentro del torneo de Tabulación (`panelLink`) con identidad remota, cursor de revisión y mappings por entidad.
3. Snapshots base y conflictos pendientes por torneo para reconciliación de cambios remotos.
4. Confirmaciones de publicación de ronda que vuelven desde Gestión a Tabulación.
5. Una outbox durable en IndexedDB para publicación de rondas y actas oficiales.
6. Borradores móviles y operaciones de actas pendientes que también viven en `localStorage`.

Por tanto, retirar `HANDOFF_KEY` o `OUTBOX_KEY` por sí solas no unifica la persistencia. La transición tiene que cubrir también los mappings, cursores, snapshots de comparación, conflictos, ACKs, operaciones pendientes y borradores.

**No se ha eliminado, renombrado ni reescrito ninguna clave.** No se han ejecutado migraciones, despliegues ni escrituras en Neon.

## 2. Mapa de flujos

### 2.1 Gestión → Tabulación: participantes y vínculo inicial

1. `src/App.tsx` construye un `PanelHandoff` desde el torneo de Gestión mediante `buildPanelHandoff(data)`.
2. La acción `sendToTabulation` escribe el JSON en `ledu-tabulacion-handoff-v1` mediante `writeHandoff` y abre `/tabulacion#inicio`.
3. `HomeView` lee el hand-off con `readHandoff`; escucha el evento `storage` para esa clave.
4. Si existe sesión, `HomeView` también intenta obtener el torneo actual desde el backend. Si encuentra un torneo local ya vinculado, lo abre; si no, puede crear el torneo local desde el snapshot del backend.
5. En el flujo manual, el operador puede crear un torneo, fusionar participantes o revisar mappings para vincular un torneo existente. La fusión conserva atributos especializados de Tabulación y valida relaciones.
6. Tras guardar localmente, el código suele escribir el snapshot base y limpiar el hand-off global.

**Riesgos/dependencias:**
- El hand-off ocupa una única clave global, no una cola ni una clave aislada por torneo/operación.
- El payload incluye identidad canónica y revisión, pero la clave no identifica el productor, el consumidor ni una generación/nonce.
- Los consumidores limpian la misma clave global. Una transición debe impedir que un consumidor antiguo borre una entrega más reciente.
- El flujo automático de backend y el flujo manual de hand-off coexisten; no deben confundirse como dos fuentes autoritativas equivalentes.

### 2.2 Tabulación → Gestión: propuesta de ronda

1. `src/tabulation/views/RoundsView.tsx` construye `PanelOutbox` con `buildOutbox` y la guarda en `ledu-tabulacion-outbox-v1`.
2. `src/App.tsx` lee la propuesta con `readOutbox`.
3. Hay dos caminos distintos:
   - Importación local/manual en la ronda seleccionada, con revisión y confirmación del operador.
   - Publicación remota, que exige sesión, ID canónico del torneo, revisión de ronda esperada y validación de la propuesta antes de enviarla.
4. El payload conserva IDs de Tabulación y IDs traducidos al modelo de Gestión, además del mapping de entidades y la revisión base.

**Riesgos/dependencias:**
- También es una única clave global que se sobrescribe al preparar otra propuesta.
- El camino local/manual no equivale a la publicación remota confirmada.
- La sustitución de la propuesta anterior y su política de recuperación no están modeladas como una cola en esta clave.

### 2.3 Publicación remota y ACK de ronda

1. Tabulación encola operaciones en IndexedDB y ejecuta un worker asociado al ID canónico del torneo activo.
2. La base IndexedDB se llama `ledu-tabulation-sync-v1`, versión 2, object store `operations`, clave primaria `operationId` e índice `byTournamentCreatedAt`.
3. El dispatcher publica la ronda. Tras respuesta satisfactoria, escribe un ACK en `ledu-tabulation-publish-acks-v1`.
4. `HomeView` escucha esa clave, valida el ACK, incorpora los IDs de ronda/asignaciones y actualiza revisión/cursor en el torneo local.
5. El ACK se elimina solo después de guardar y confirmar el mapping local. Si el guardado falla, se conserva para reintentar.

**Importante:** el ACK de publicación y el estado de la operación en IndexedDB son artefactos distintos. No se deben fusionar ni limpiar como si fueran el mismo registro.

### 2.4 Gestión → Tabulación: sincronización remota de participantes

- `HomeView` consulta el torneo remoto al abrir el módulo y después cada 30 segundos, además de eventos online/focus/visibility.
- Compara el snapshot remoto con una base guardada por torneo.
- La base se guarda bajo `ledu-tabulacion-sync-base-v1:<tabTournamentId>`.
- Los conflictos o cambios que requieren revisión se guardan bajo `ledu-tabulacion-sync-pending-v1:<tabTournamentId>`.
- Antes de aplicar cambios compatibles, crea un backup del torneo local, guarda la modificación y solo entonces avanza la base.
- Un vínculo antiguo sin snapshot base obliga a revisión histórica del primer diff.

Este mecanismo es una reconciliación de snapshots; no es el mismo canal que el hand-off de importación inicial.

## 3. Inventario de persistencia

| Clave / almacén | Contenido | Lectores principales | Escritores / limpiadores |
|---|---|---|---|
| `ledu-tabulacion-handoff-v1` | Snapshot de equipos, oradores, jueces y salas; versión 1 | `HomeView` / `readHandoff` | Gestión / `sendToTabulation`; Tabulación lo limpia tras importación/vinculación |
| `ledu-tabulacion-outbox-v1` | Propuesta de ronda; versión 1 | Gestión / `readOutbox` | Tabulación / `RoundsView.sendToPanel` |
| `panelLink` dentro de `ledu-tabulacion-v1:<id>` | Identidad remota, nombre, fecha de vínculo, revisión, updatedAt, mappings explícitos | `HomeView`, bootstrap, `panelBridge`, `buildOutbox` | `mergeHandoff`, `tournamentFromHandoff`, reconciliación y ACK de ronda |
| `ledu-tabulacion-sync-base-v1:<id>` | Último snapshot remoto usado como base de comparación | `HomeView` | Importación, vinculación y pull remoto |
| `ledu-tabulacion-sync-pending-v1:<id>` | Snapshot base + snapshot remoto + fecha de detección | `HomeView` | Pull remoto al detectar conflictos; limpieza tras resolución |
| `ledu-tabulation-publish-acks-v1` | ACKs de ronda, hasta 100 entradas | Gestión/Tabulación en `HomeView` | Dispatcher al publicar; Tabulación elimina tras persistir mappings |
| IndexedDB `ledu-tabulation-sync-v1` v2 / `operations` | Operaciones idempotentes de publicación de ronda y actas, leases, intentos, estado y errores | Workers y pantallas de actas | `createSyncOutbox`, dispatchers y workers |
| `ledu-tabulation-acta-pending-v1:<assignmentId>` | Snapshot/entrada pendiente de guardado oficial de acta | `OfficialActaPublisher`, dispatcher | `OfficialActaPublisher`; se elimina al ACK o al limpiar el estado pendiente |
| `ledu-acta-borrador-v2:<version>:<key>:<debate>` | Borrador móvil de acta individual/conjunta | `JudgeActaApp` | `JudgeActaApp` |
| `ledu-acta-borrador-v1:<debate>` | Formato histórico de borrador móvil | Solo ruta de migración de `JudgeActaApp.loadDraft` | Lectura y copia a v2; no se observa borrado del original en esa ruta |
| `ledu-admin-session` | Sesión local del Gestor | Contrato compartido, Gestión y todavía lectores heredados de `HomeView` | Login/logout y contrato `managerSession` |
| `ledu-tabulacion-index-v1` | Índice de torneos locales y `activeId` | `TabStore`, búsqueda de vínculo desde Gestión | `TabStore` |
| `ledu-tabulacion-v1:<id>` | Modelo completo especializado de cada torneo local | `TabStore`, búsqueda de vínculo | `TabStore` |
| `ledu-tabulacion-backup-v1:<id>:<slot>` | Backups rotatorios (máximo 3 por torneo) | `TabStore` | `TabStore` |
| `ledu-tabulacion-log-v1:...` | Registro local paginado y metadatos de auditoría | `TabStore` / módulo de log | `TabStore` / módulo de log |
| `ledu-tabulacion-operador-v1` | Nombre del operador de Tabulación | `TabStore` | `TabStore` |
| `debate-control-pending-timer:<roomSlug>` | Acciones pendientes del cronómetro | Gestión | Gestión; se limpia al confirmar/reconciliar |

Las claves de sesión, cronómetro, borradores y datos del torneo comparten el espacio de almacenamiento del origen. El propio store advierte que la cuota es compartida con el panel; no debe asumirse que la disponibilidad de una clave implica capacidad para escribir las demás.

## 4. Hallazgos que condicionan la migración

### H1 — Sesión compartida: resuelto en el incremento actual

El hallazgo se corrigió en `src/tabulation/views/HomeView.tsx`: tanto el bootstrap desde Gestión como el pull remoto periódico utilizan ahora `readManagerSession(window.localStorage)`. Se retiró el parser local y el parseo inline. Los límites de longitud del token, token no vacío y expiración entera segura quedan centralizados en `src/contracts/managerSession.ts`.

La cobertura de parseo/expiración/corrupción permanece en `src/contracts/managerSession.test.ts`; la CI del nuevo HEAD debe confirmar la integración. No se cambia la clave persistida ni el formato, por lo que no requiere migración de sesiones.

### H2 — Los hand-offs son buzones de una sola posición

Handoff y outbox son claves globales de valor único. No tienen:
- identificador de entrega/operación independiente del contenido;
- estado pendiente/consumido;
- ACK de consumo;
- retención de varias entregas;
- compare-and-clear que garantice que solo se borra la generación leída.

El formato incluye timestamps y el outbox incluye IDs, pero eso no evita por sí solo carreras de sobrescritura o limpieza entre pestañas.

### H3 — La identidad depende de mappings persistidos dentro del modelo local

`panelLink.idMap` traduce IDs locales de equipos, oradores, jueces y salas a IDs remotos. Se utiliza para snapshots compartidos y para construir propuestas de ronda. Eliminar el hand-off sin migrar y validar estos mappings rompería la trazabilidad entre actas, debates, asignaciones y entidades.

### H4 — La reconciliación necesita su base histórica

El snapshot base y el conflicto pendiente son necesarios para detectar cambios divergentes. No son cachés prescindibles: retirar sus claves sin un reemplazo equivalente fuerza una revisión histórica y puede impedir una sincronización automática segura.

### H5 — Hay dos persistencias de sincronización diferentes

- El outbox de propuestas/actas es IndexedDB y tiene leases, idempotencia y estados.
- El hand-off/outbox manual, ACK de ronda, base de comparación y conflictos viven en localStorage.

Una unificación debe decidir qué operaciones se convierten en comandos del outbox durable y cuáles son lecturas/proyecciones, sin duplicar envíos ni perder ACKs.

### H6 — La aplicación aún conserva índice multi-torneo local

`TabStore` persiste un índice con múltiples entradas, carga torneos por ID y mantiene backups/logs por torneo. Gestión recorre el índice para encontrar un torneo vinculado. Esto contradice el objetivo final de un único torneo activo, pero **no debe simplificarse en esta fase**: antes hacen falta exportación verificable, migración de todos los datos y recuperación probada.

### H7 — Borradores de actas son datos de usuario, no residuos del bridge

La app móvil migra borradores antiguos v1 a v2 al leerlos. La migración futura no debe borrar el origen hasta que se confirme que el destino se escribió correctamente y que la recuperación funciona.

## 5. Plan de transición compatible

### Fase A — Cerrar el inventario (este commit)

- Identificar lectores, escritores, formatos y propietarios.
- Registrar las claves y dependencias anteriores.
- No modificar ni limpiar almacenamiento.

### Fase B — Centralizar acceso y validación

1. Cambiar los lectores de sesión de `HomeView` a `readManagerSession`; retirar el parser duplicado solo tras pruebas equivalentes.
2. Crear un repositorio de persistencia de aplicación con interfaces explícitas para:
   - snapshot de participantes;
   - propuesta/publicación de ronda;
   - mappings y cursor remoto;
   - base de reconciliación y conflicto pendiente;
   - confirmaciones durables.
3. Versionar y validar todos los DTOs en las fronteras. No aceptar JSON mediante casts.
4. Añadir telemetría/diagnóstico sin registrar tokens ni payloads sensibles.

### Fase C — Introducir el puente nuevo en paralelo

1. Añadir un formato/almacén nuevo sin cambiar ni borrar v1.
2. Implementar dual-write temporal donde cada escritor pueda confirmar ambas persistencias; si una escritura falla, no marcar la operación como migrada.
3. Implementar dual-read con precedencia explícita, validación y detección de divergencia; no elegir silenciosamente el registro más reciente.
4. Añadir IDs de entrega/operación y ACK verificable; un ACK solo se consume después de persistir su efecto local.
5. Mantener compatibilidad de lectura v1 para datos ya guardados y fixtures históricos.

### Fase D — Migración y rollback

1. Exportar una copia verificable de localStorage e IndexedDB antes de migrar.
2. Migrar mappings, cursores, snapshots base, conflictos, ACKs y operaciones pendientes sin alterar sus IDs.
3. Verificar conteos, hashes, relaciones y round-trip de ida/vuelta.
4. Permitir volver al lector v1 mientras el origen siga intacto.
5. No retirar un lector/escritor v1 hasta que la telemetría y las pruebas demuestren que ningún flujo depende de él.

### Fase E — Retirada y simplificación

1. Retirar claves de hand-off solo después de migrar todos sus consumidores.
2. Retirar el índice multi-torneo únicamente después de backup/export, migración al torneo activo y prueba de restauración.
3. Mantener formatos históricos de actas y enlaces mientras existan enlaces compartidos.
4. Eliminar código y claves únicamente con evidencia de ausencia de consumidores y procedimiento de rollback probado.

## 6. Pruebas de aceptación necesarias

- Dos pestañas producen hand-offs consecutivos: ningún consumidor puede borrar una entrega posterior.
- Gestión y Tabulación abiertas simultáneamente: una propuesta no se sobrescribe ni se importa en el torneo incorrecto.
- Recarga/cierre del navegador en cada paso: persistencia y recuperación de hand-off, propuesta, ACK y conflicto.
- Cuota local agotada / almacenamiento bloqueado: no se confirma una migración parcial ni se borra la fuente.
- Sesión caducada, corrupta, demasiado larga y actualizada en otra pestaña: ambos shells aplican el mismo parser.
- Mappings con IDs faltantes, duplicados, cruzados y relaciones rotas: rechazo seguro sin mutación.
- Timeout después de commit remoto: mismo `operationId`, recuperación por reintento y ACK verificable.
- Pull remoto con cambios concurrentes: snapshot base y conflicto sobreviven recarga y reinicio.
- Borradores móviles v1 y v2: lectura, migración, escritura y recuperación sin perder el original antes de verificar el destino.
- Exportación/restauración de todos los datos locales, incluidos backups, logs y operaciones IndexedDB.

## 7. Estado y límites de esta entrega

- [x] CI del HEAD inspeccionado `2145631cff3c8257957892ff2bff72669c066920`: E2E, cobertura, typecheck y build correctos (run `41266254358`).
- [x] Lectores/escritores principales de hand-off y outbox manual identificados.
- [x] Persistencia de mappings, snapshots base, conflictos y ACKs identificada.
- [x] Persistencia IndexedDB y borradores de actas identificados.
- [x] Duplicación de lectura de sesión detectada y corregida en `1dde284333ce2c2caa6d3deb602b973c58df9992`.
- [ ] Repositorio de persistencia común implementado.
- [ ] Dual-read/dual-write implementado y probado.
- [ ] Migración/rollback de datos locales implementados y probados.
- [ ] Retirada de claves heredadas autorizada y completada.

Este documento es inventario y diseño de transición, no certifica que la aplicación única esté terminada. La PR #84 continúa en Draft y apilada sobre PR #79.
