# Migración de LEDU Control a Neon PostgreSQL

**Estado de esta rama:** la API operativa ya usa el adaptador PostgreSQL para lecturas y escrituras; se han retirado del handler los clientes y llamadas de Google Sheets. El esquema y el adaptador tienen CI, typecheck y build automatizados. El corte no está autorizado todavía: faltan pruebas de integración con Neon aislado, concurrencia/rendimiento y validación funcional de las reglas contra la base real.

## Decisiones de arquitectura

- Neon PostgreSQL es la única fuente de verdad de la API de esta rama. No se importan datos de Google Sheets; la base se inicializa limpia, conservando las reglas de negocio.
- El navegador nunca recibe credenciales PostgreSQL.
- Redis queda limitado a sesiones privadas de ocho horas, contador de intentos fallidos de quince minutos y claves de control por sala.
- No existe un bloqueo global Redis para las escrituras. El guardado del torneo compara la revisión global en la transacción; cada cronómetro se actualiza con compare-and-swap de su revisión.
- Las fases efectivas de una asignación se guardan como snapshot; editar un preset no altera un debate ya preparado.

## Variables privadas

La conexión acepta `NEON_DATABASE_URL` (preferida) o `DATABASE_URL`. Nunca exponerlas al cliente ni crear variables con prefijo `VITE_`. Production y Preview deben apuntar a bases distintas. Mantén `ADMIN_PASSWORD` y las dos variables Upstash para autenticación y control.

El handler operativo ya no lee `GOOGLE_SERVICE_ACCOUNT_JSON` ni llama a Google Sheets. No obstante, no retires los secretos ni la hoja antigua hasta completar las pruebas de Preview y acordar el corte; una versión anterior de la aplicación todavía podría necesitarlos.

## Migraciones versionadas

- `db/migrations/0001_initial_schema.sql`: esquema relacional base.
- `db/migrations/0002_integrity_constraints.sql`: claims normalizados para evitar que un equipo aparezca en dos debates de una ronda; unicidad de juez por ronda; coherencia del puntero de ronda activa; integridad de actas frente a asignación, jueces y oradores.
- `db/migrations/0003_normalize_incompatibilities.sql`: migra las listas heredadas a tablas con claves foráneas para incompatibilidades equipo–juez y juez–juez; comprueba reciprocidad antes de retirar las columnas de arrays.
- `db/migrations/0004_preserve_scored_assignment_identity.sql`: impide cambiar de ronda, sala física o equipos una asignación que ya tenga un acta, para proteger el historial.
- `db/migrations/0005_normalize_assignment_claims.sql`: mueve la unicidad de sala física y equipo a tablas de claims para que una transacción pueda intercambiar asignaciones sin colisiones transitorias.
- `db/migrations/0006_scorecard_judge_consistency.sql`: valida al final de cada transacción que el acta registre exactamente los jueces de la asignación.
- `db/migrations/0007_scope_judge_consistency_checks.sql`: limita esa comprobación a la acta afectada para evitar escaneos completos en cada cambio.
- `db/migrations/0008_preserve_scored_assignment_snapshots.sql`: hace inmutables los jueces y las fases efectivas de una asignación con acta, además de la identidad de ronda/sala/equipos.
- `scripts/migrate-db.mjs`: descubre migraciones versionadas en orden, comprueba SHA-256, registra versiones y aplica DDL junto al ledger dentro de una transacción protegida por advisory lock. Si una versión aplicada tiene otro checksum, se detiene; cualquier corrección debe ser una nueva migración.

Comandos administrativos:
```bash
npm run db:status
npm run db:migrate
npm run db:status
npm run db:seed
```

El runner bloquea por defecto las migraciones desde el runtime Vercel Production. No se ha ejecutado ninguna migración ni seed contra la base Neon de producción en este trabajo. Verifica proyecto, rama y cadena de conexión antes de ejecutarlos.

## Persistencia y concurrencia implementadas

`api/postgres-store.ts` ofrece una capa de compatibilidad para mantener el contrato de dominio actual, pero traduce las filas a tablas normalizadas. Las lecturas se realizan con snapshot repeatable-read. Cada escritura multi-tabla se ejecuta en una transacción y se revierte íntegramente ante error.

- La configuración usa `tournament_settings.revision` como compare-and-swap.
- Las transiciones del cronómetro actualizan `room_assignments` con condición sobre `timer_revision`, de modo que dos solicitudes basadas en la misma revisión no pueden sobrescribirse silenciosamente.
- La transición y su evento de auditoría se guardan en la misma transacción.
- Las escrituras de torneo y actas usan claves deterministas basadas en la revisión esperada y el contenido de la petición; la activación usa la revisión de activación, ronda y modo forzado; el cronómetro usa sala, asignación, acción y revisión esperada. Los reintentos devuelven la respuesta confirmada sin repetir efectos.
- La activación de ronda se guarda en una transacción que contiene la revisión global, la ronda activa, las asignaciones afectadas, los cronómetros y el evento.
- Se mantiene la validación de dominio del backend para incompatibilidades, jueces mínimos, estado finalizado, rondas clasificatorias y puntuaciones; las restricciones SQL refuerzan las referencias y los invariantes relacionales.

La capa conserva los nombres de las funciones internas heredadas para reducir el riesgo de reescribir todo el dominio a la vez; ya no representan pestañas ni hacen llamadas a Sheets. Los datos operativos están en PostgreSQL.

## Reglas de datos

Las tablas separan configuración, instituciones, equipos, jueces, oradores, incompatibilidades, salas físicas, rondas, presets/fases, asignaciones, snapshots de fases, jueces asignados, categorías, actas, puntuaciones, auditoría e idempotencia.

La base refuerza la asignación única por sala/ronda, un equipo por ronda independientemente de la postura, un juez por ronda y la coherencia de actas con ronda, equipos, jueces y oradores. Las reglas cruzadas de institución e incompatibilidades se comprueban en el servicio de dominio antes de iniciar o guardar. Las categorías históricas referenciadas no se pueden eliminar por las claves foráneas.

## Contrato de API conservado

`login`, `logout`, `getTournament`, `getPublicRoom`, `getRoomControllerToken`, `saveTournament`, `saveScoreConfig`, `getRoundActivationPreview`, `activateRound` y `updateRoomTimer`. Se mantiene el envoltorio de respuesta `{ ok, data }` o `{ ok: false, error }`. La respuesta pública no expone notas internas ni sesiones.

La activación conserva el rechazo de debates pendientes salvo confirmación explícita, la pausa de cronómetros salientes, el reinicio de asignaciones entrantes, el incremento de `activationRevision` y el anuncio de veinte segundos.

## Pruebas de integración Neon

`tests/neon.integration.test.ts` ejecuta las migraciones completas y verifica restricciones reales de PostgreSQL, swaps de salas, asignación de jueces, consistencia de actas, revisiones de cronómetro y rollback atómico. Por seguridad, queda omitido en CI normal y solo se activa si se configuran ambas variables `NEON_TEST_DATABASE_URL` y `NEON_TEST_DATABASE_ISOLATED=1`.

Ejecuta `npm test` únicamente con una base de test desechable y aislada. La suite crea y elimina un esquema temporal aleatorio; no habilites el flag para Production ni para una base con datos que quieras conservar. La integración real aún debe ejecutarse explícitamente antes del corte.

## Criterios pendientes antes del corte

1. Aplicar migraciones y seed en una base Neon de test aislada y ejecutar pruebas funcionales reales de ida y vuelta para todas las entidades.
2. Probar las restricciones SQL en PostgreSQL real: dos equipos reclamados a la vez, jueces en dos salas, actas incoherentes y cambios de ronda concurrentes.
3. Probar carreras de cronómetro en la misma sala y salas diferentes, activaciones simultáneas, repetición tras timeout y fallo entre actualización y auditoría.
4. Medir al menos 20 operaciones válidas en 5 segundos sin pérdida ni duplicación.
5. Ejecutar typecheck, todos los tests, build y despliegue Preview; verificar todas las acciones de frontend y reglas de puntuación.
6. Solo tras esas comprobaciones, planificar el cambio deliberado de Production. No mergear ni retirar secretos antiguos antes de tener evidencias de integración y rendimiento.

## Rollback

No se importan ni modifican los datos de Google Sheets: permanecen separados y dejan de ser la fuente operativa de esta rama. Un rollback al código antiguo no recibiría las escrituras nuevas; debe planificarse explícitamente teniendo en cuenta que la base PostgreSQL será la fuente de verdad después del corte.
