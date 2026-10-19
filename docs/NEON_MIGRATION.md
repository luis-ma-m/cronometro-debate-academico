# Migración a Neon PostgreSQL

**Estado de esta rama: migración de esquema en curso; no está lista para el corte operativo.** La API de `api/index.ts` todavía contiene la ruta operativa de Google Sheets. No desplegar ni fusionar como migración terminada hasta sustituir esa ruta, validar la API y completar las pruebas de integración/concurrencia.

## Decisiones de arquitectura

- Neon PostgreSQL debe ser la única fuente de verdad para los datos del torneo.
- No se importan los datos de Google Sheets; la base nueva se inicializa limpia. Las reglas de negocio sí se conservan.
- El navegador nunca recibe credenciales de PostgreSQL.
- Redis se conserva exclusivamente para sesiones privadas de ocho horas, contador de intentos fallidos de quince minutos y claves de control por sala con revocación al rotarlas.
- No debe existir un bloqueo global Redis para escrituras del torneo. PostgreSQL coordinará operaciones por fila/sala; la activación de ronda es una operación global y transaccional.
- Las fases efectivas de una asignación deben ser un snapshot: editar un preset no modifica un debate ya preparado.

## Variables privadas

La conexión admite `NEON_DATABASE_URL` (preferida) o `DATABASE_URL`. No exponer ninguna de ellas al cliente ni crear variables con prefijo `VITE_`. La integración Neon de Vercel debe conectar Production y Preview a bases separadas. Mantén `ADMIN_PASSWORD` y las dos variables Upstash para la autenticación/control.

No retires aún `GOOGLE_SERVICE_ACCOUNT_JSON`: el handler operativo sigue dependiendo de Sheets. Retirarla antes de completar el adaptador rompería el servicio.

## Migraciones versionadas

- `db/migrations/0001_initial_schema.sql`: esquema relacional base.
- `db/migrations/0002_integrity_constraints.sql`: claims normalizados para evitar que un equipo aparezca en dos debates de una ronda; unicidad de juez por ronda; coherencia del puntero de ronda activa; integridad de actas frente a asignación, jueces y oradores.
- `scripts/migrate-db.mjs`: descubre migraciones versionadas en orden, comprueba SHA-256, registra versiones y aplica DDL junto al ledger dentro de una transacción protegida por advisory lock. Una versión aplicada con checksum distinto detiene la ejecución; la corrección debe ser una nueva migración, nunca reescribir una ya aplicada.

Comandos:
```bash
npm run db:status
npm run db:migrate
npm run db:seed
```

El runner bloquea por defecto su ejecución desde un runtime Vercel Production. Ejecuta migraciones de producción de forma administrativa y deliberada, una vez verificada la base de destino. No se ha ejecutado ninguna migración contra una base Neon en esta implementación.

## Modelo de datos y reglas que deben seguir en el servicio de dominio

Las tablas separan configuración, instituciones, equipos, jueces, oradores, salas físicas, rondas, presets/fases, asignaciones, snapshots de fases, jueces asignados, categorías, actas, puntuaciones, auditoría e idempotencia.

La base refuerza invariantes que puede expresar: referencias válidas, asignación única por sala/ronda, un equipo por ronda sin importar la postura, un juez por ronda, y que un acta coincida con los equipos, ronda, jueces y oradores de la asignación. Las reglas que dependen del estado operativo requieren además validación transaccional: incompatibilidades de equipo/juez, incompatibilidades recíprocas entre jueces, institución, número mínimo de jueces, debate finalizado, ronda clasificatoria, total igual a suma de categorías, límite de ocho oradores y puntuación individual de 0 a 10 en pasos de 0,5.

## Contrato de API que debe conservarse

`login`, `logout`, `getTournament`, `getPublicRoom`, `getRoomControllerToken`, `saveTournament`, `saveScoreConfig`, `getRoundActivationPreview`, `activateRound` y `updateRoomTimer`. La respuesta pública no debe exponer notas internas ni sesiones.

Cada transición de cronómetro debe validar sala física, asignación vigente, ronda activa, `activationRevision`, `timer_revision` esperada y clave de control; calcular el tiempo a partir de timestamps; actualizar la fila e insertar auditoría en la misma transacción. Las solicitudes críticas deben aceptar clave de idempotencia para devolver la respuesta ya confirmada cuando el cliente reintenta tras un timeout.

La activación debe bloquear la fila de configuración global y, en una sola transacción, validar debates pendientes y asignaciones de destino, pausar cronómetros salientes, reiniciar cronómetros entrantes, cambiar la ronda activa, incrementar `activation_revision` y registrar el evento. La activación forzada requiere confirmación explícita. El anuncio de 20 segundos debe mantenerse en el contrato que ya consume el frontend.

## Criterios de aceptación antes del corte

1. Sustituir `loadSheetData`, `tournamentFromData` y `writeTables` como ruta de persistencia; ninguna acción operativa puede llamar a Google Sheets.
2. Implementar guardado relacional completo con transacción y control de `revision`, incluidas instituciones, oradores, incompatibilidades, formatos, fases, asignaciones, categorías y actas.
3. Quitar `ledu:lock:spreadsheet` y cualquier bloqueo global equivalente. Las transiciones de salas diferentes deben progresar de forma independiente.
4. Implementar auditoría e idempotencia reales, no solo tablas de soporte.
5. Pruebas de regresión del contrato, reglas de negocio y estados límite de cronómetro; carreras simultáneas en la misma sala y en salas distintas; dos jueces/equipos reclamados concurrentemente; activaciones simultáneas; fallo entre transición y auditoría; y solicitudes repetidas.
6. Probar con una base Neon de test aislada y verificar al menos 20 operaciones válidas en 5 segundos sin pérdida ni duplicación.
7. Confirmar CI, typecheck de API, build frontend y despliegue Preview. No hacer corte ni retirar secretos de Sheets antes de completar lo anterior.

## Seguridad de despliegue

No ejecutar el seed en producción hasta verificar explícitamente el proyecto/base de destino. El seed es idempotente, no borra datos y crea únicamente valores predeterminados que falten. La integración Vercel/Neon no se ha validado desde el conector; la presencia de la variable debe comprobarse en el dashboard.
