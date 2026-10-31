# Checklist de validación final — PR #79

> Documento operativo para retomar las verificaciones que requieren deployments, Preview y/o una base PostgreSQL real. No sustituye los criterios de aceptación de los documentos vinculantes. Un punto pendiente significa que aún no existe evidencia suficiente para darlo por validado; no implica necesariamente que la funcionalidad esté rota.

## 1. Vercel Preview — cuando se recupere cuota

### Despliegue y configuración
- [ ] Crear un deployment Preview de feat/tabulation-manager-sync. El bloqueo conocido es build-rate-limit; distinguirlo de errores reales de build.
- [ ] Confirmar que el deployment utiliza el HEAD de la PR y no un deployment anterior o caché.
- [ ] Comprobar las variables de entorno Preview requeridas por API/Redis y NEON_DATABASE_URL, sin exponer valores en logs.
- [ ] Confirmar que NEON_DATABASE_URL está limitada a Preview y a esta rama; comprobar explícitamente que Production no se ha alterado.
- [ ] Revisar logs de build, runtime y funciones API: inicialización, timeouts y dependencias.
- [ ] Ejecutar smoke tests contra health y las rutas reales de sincronización; validar códigos HTTP y contratos de respuesta.

### API y sesión
- [ ] Probar autenticación con sesión válida y rechazo de sesión ausente, inválida o caducada.
- [ ] Verificar aislamiento por torneo/usuario: no se puede leer ni escribir otro torneo manipulando IDs.
- [ ] Comprobar errores 4xx/5xx, timeout y Retry-After; la outbox no debe confirmar operaciones prematuramente.
- [ ] Confirmar que logs no contienen tokens, connection strings ni payloads privados de actas.

## 2. Neon Preview — pruebas de integración reales

> Ejecutar exclusivamente contra la rama/base Neon de pruebas usada por Preview. No ejecutar migraciones, escrituras destructivas ni concurrencia contra Production.

### Migraciones y esquema
- [ ] Confirmar conectividad desde Vercel Preview a Neon de pruebas.
- [ ] Inspeccionar migraciones pendientes y aplicar solo las necesarias en la base de pruebas.
- [ ] Verificar aplicación ordenada desde una base limpia y desde una base con el esquema previo esperado.
- [ ] Confirmar constraints, índices, claves foráneas, unicidad e integridad referencial.
- [ ] Comprobar que repetir el mecanismo de migración no duplica ni corrompe datos.
- [ ] Confirmar que ninguna migración altera o elimina tablas/datos fuera del alcance.

### F3 — vínculo, reconciliación y outbox
- [ ] Probar vínculo inicial con torneo de prueba, revisión remota e idMap; no emparejar identidades automáticamente por nombre.
- [ ] Abrir el torneo en dos navegadores/dispositivos y verificar propagación de cambios remotos compatibles.
- [ ] Probar cambios simultáneos sobre el mismo campo: ambas versiones deben conservarse y aparecer como conflicto, sin last-write-wins.
- [ ] Desconectar red, crear cambios locales, recargar/cerrar y reabrir; verificar persistencia y reintento al reconectar.
- [ ] Verificar exclusión de worker entre pestañas, leases expirados, backoff, Retry-After y recuperación tras timeout ambiguo.
- [x] Añadida prueba E2E de navegador para migración IndexedDB v1 → v2: conserva una operación pendiente antigua, crea el índice `byTournamentCreatedAt`, recupera un lease expirado y demuestra que dos repositorios/pestañas no reclaman la misma operación.
- [ ] Ejecutar esa prueba sobre el navegador y el perfil de datos reales de operación; la prueba automatizada usa una base IndexedDB aislada de Playwright.
- [ ] Confirmar que una respuesta remota vacía/errónea no se interpreta como borrado y no se pierden entidades históricas.
- [ ] Verificar que operaciones sin dispatcher no se marcan como confirmadas ni se descartan.

## 3. F4 — actas oficiales: pruebas PostgreSQL/Neon y Preview

- [x] Implementado: primer guardado automático si no hay versión oficial; operación persistida antes de la escritura y recuperación idempotente con el mismo `operationId` tras timeout, recarga o reconexión.
- [x] Implementado: al expandir una sala se carga el historial automáticamente y el contador aparece en la cabecera de su tarjeta; las versiones incluyen detalle de solo lectura.
- [ ] Validar los dos recorridos anteriores con datos reales en Neon Preview y navegador multi-dispositivo.

- [ ] Aplicar la migración de fuentes de acta en Neon Preview y verificar constraints/índices.
- [ ] Probar guardado inicial judges, conservando papeletas, votos, notas, oradores y metadatos.
- [ ] Probar guardado joint, conservando ganador declarado, rúbrica, ítems, puntuaciones, sanciones, notas y snapshot de reglas.
- [ ] Probar elimination, conservando ganador, perdedor y equipos que avanzan; no forzar el resultado dentro de una RoundScorecard clasificatoria.
- [ ] Verificar que la proyección a RoundScorecard solo ocurre cuando es semánticamente compatible y mantiene trazabilidad al source/hash/reglas.
- [ ] Repetir operationId con mismo hash: debe devolver el resultado original sin duplicar versión ni contador.
- [ ] Reutilizar operationId con hash/scope distinto: debe rechazarse como IDEMPOTENCY_MISMATCH.
- [ ] Probar sustitución con diff y confirmación; verificar nueva versión inmutable, supersedes, auditoría y contador incrementado exactamente una vez.
- [ ] Cancelar el diff y comprobar que no hay escritura ni cambio del acta oficial.
- [ ] Simular dos sustituciones concurrentes sobre la misma revisión: solo una confirma; la otra recibe conflicto.
- [ ] Simular timeout posterior al commit y recuperar con el mismo operationId; no debe crearse una segunda versión.
- [x] Añadida prueba unitaria de regresión: si falla la inserción de auditoría después de insertar la fuente, la operación ejecuta `ROLLBACK`, no ejecuta `COMMIT` y no registra una clave de idempotencia incompleta (cliente PostgreSQL simulado).
- [ ] Forzar fallo durante auditoría/proyección/contador contra PostgreSQL real y comprobar rollback transaccional completo.
- [ ] Verificar que revisión obsoleta obliga a descargar y comparar de nuevo (409), sin sobrescribir el acta vigente.
- [ ] Confirmar historial y contador consistentes entre dispositivos y tras recarga.
- [ ] Verificar autorización por torneo/asignación y rechazo de IDs ajenos, payload malformado, hash incorrecto y schemaVersion no soportada.

## 4. E2E de navegador y operación real

- [ ] Ejecutar E2E contra el deployment Preview real, no solo contra el servidor local de Playwright.
- [ ] Completar flujo vínculo → publicación de ronda → guardado inicial → revisión/sustitución → historial.
- [ ] Verificar offline y recuperación con recarga/cierre de pestaña.
- [ ] Ejecutar escenario de dos dispositivos concurrentes para rondas y actas.
- [ ] Confirmar que cronómetros y operación de sala siguen funcionando con API/Neon caídos.
- [ ] Comprobar que el contador visible por sala muestra sustituciones confirmadas y no cuenta guardados iniciales, cancelaciones o reintentos.

## 5. Short links y compatibilidad WhatsApp

- [x] Implementado: con backend disponible se crean y resuelven enlaces cortos de exactamente 8 caracteres; pendiente prueba real en Neon Preview.
- [x] Implementados ID aleatorio Crockford Base32 de 40 bits, retry de colisión, unicidad, idempotencia, rate limit, caducidad y revocación; pendiente estrés/integración en Neon Preview.
- [x] UI/API de revocación individual, múltiple y de todos los enlaces del torneo con confirmación y eventos de auditoría; pendiente E2E/Neon.
- [x] A2 autocontenido se genera localmente y se abre sin petición al servidor.
- [x] Codec A1/A2 y ACTA1/ACTA2 histórico preservado; WhatsApp usa solo el short link si se crea correctamente.
- [x] La resolución S8 depende del backend; los errores de creación online activan A2 como fallback y la UI distingue ambos formatos.

## 6. Revisión final antes de considerar la PR casi lista

- [ ] Contrastar código/UI con TABULATION_MANAGER_SYNC.md y TABULATION_MANAGER_DECISIONS.md.
- [ ] Revisar checks de GitHub Actions del HEAD final; los checks de commits anteriores no sirven como evidencia final.
- [ ] Resolver fallos relevantes de TypeScript, build, coverage y E2E; documentar excepciones.
- [ ] Verificar checks Vercel y distinguir bloqueo de cuota de fallo funcional/de compilación.
- [ ] Revisar migraciones append-only; nunca editar migraciones ya aplicadas.
- [ ] Revisar permisos, validación de inputs, aislamiento multi-tenant, rate limits, secretos y logs.
- [ ] Revisar idempotencia, transacciones, concurrencia, rollback y recuperación de timeouts para cada escritura oficial.
- [ ] Confirmar que no hay pérdida de datos locales ni borrados implícitos ante respuestas vacías, red caída o conflictos.
- [ ] Comprobar UX de estados pendiente, enviando, conflicto, error, oficial y reescritura.
- [ ] Confirmar que no se han ejecutado migraciones ni escrituras en Production sin autorización expresa.
- [ ] Actualizar documentación con resultados, fecha, commit probado, entorno y evidencia reproducible.
- [ ] Mantener la PR en Draft hasta satisfacer todos los criterios de salida; solicitar revisión final antes de pasarla a Ready.

## 7. Registro de ejecución

Completar en cada ejecución:
- Fecha/hora:
- Commit SHA:
- Deployment Preview URL:
- Neon branch/identificador no secreto:
- Migraciones aplicadas:
- Navegadores/dispositivos:
- Escenarios ejecutados:
- Resultado y enlaces a logs/checks:
- Incidencias abiertas:
- Responsable:

## 8. Estado conocido al crear este documento

- Vercel Preview está bloqueado por cuota de deployments (build-rate-limit); esto no equivale a un fallo de compilación.
- El último CI consultado para HEAD 80fa2330d1c652bcc3a162be6a74248665d91175 tenía verify en verde y E2E todavía en ejecución en el momento de la última comprobación.
- No se ha validado el flujo real multi-dispositivo contra Neon Preview ni la migración IndexedDB v1 → v2 en navegador.
- No se han ejecutado migraciones ni escrituras en Neon Production.
- Este checklist no declara F3 ni F4 terminadas: registra evidencia pendiente para el cierre.


## Nuevos controles de identidad/contexto F3-F4

- [ ] Aplicar y verificar migraciones 0014–0019 únicamente en entorno Preview.
- [ ] Publicar una ronda y comprobar que cada tabulationDebateId devuelve el assignmentId correcto.
- [ ] Reintentar la misma publicación y verificar que la respuesta idempotente conserva exactamente el mismo mapping.
- [ ] Confirmar rollback completo si falla la escritura de una relación de identidad o de metadatos.
- [ ] Verificar que la instantánea incluye todos los equipos activos, sin duplicados ni referencias ajenas.
- [ ] Cambiar swing, breakEligible, fallenFromRound o sideMode y comprobar que el contexto persistido es el que utiliza el cálculo server-side del acta.
- [x] Conectar la respuesta del servidor al modelo local y al outbox durable mediante ACK compartido, guardar managerRoundId/managerAssignmentId y conservar ACK si falla el guardado local. Pendiente: prueba E2E de pérdida de respuesta y recuperación por operationId.
- [x] Resolver contexto server-side, canonicalizar IDs y validar resultado con reglas/metadatos persistidos.
- [x] Implementar preview no mutante con versión oficial vigente, hash y revisiones.
- [x] Implementar primer guardado/sustitución transaccional con compare-and-swap de head y de revisión de reglas, historial inmutable, trigger de head, auditoría e idempotencia.
- [x] Añadir UI de comparación y confirmación explícita para papeletas individuales y actas conjuntas.
- [ ] Probar en Neon Preview rollback, concurrencia, contador de reescrituras y pérdida de respuesta con recuperación por operationId.

- [ ] Verificar que el torneo, ronda y debate locales del acta coinciden con la identidad persistida para el assignmentId.

## Actualización de implementación — iteración 2026-10-31

HEAD revisado: `cb5448b4e94fe2405da53133f7c36105b23d5ded`.

### Estado de los cinco puntos solicitados

1. **Persistencia de reglas — implementada en código.** El editor vive en Gestor → Configuración, usa las acciones versionadas de lectura/guardado y la migración de reglas. La validación de persistencia contra PostgreSQL/Neon real sigue pendiente; no se considera verificada por el build ni por los tests de validación.

2. **Clasificación en Gestor → Torneo — integrada.** Cuando existe una Tabulación local vinculada al mismo `remoteId`, el gestor lee esa copia por identidad canónica y utiliza `buildTeamStandings`, `buildGroupStandings` y `buildSpeakerStandings`. Conserva los cinco primeros y «Ver más», desempates, grupos, métrica de oradores y ocultación de la clasificación a ciegas hasta completar la fase. Se refresca al recibir cambios de almacenamiento entre pestañas. Si no existe una copia local vinculada, se mantiene el ranking de scorecards del Gestor como fallback. **Límite explícito:** esta proyección depende de que la copia local de Tabulación esté disponible en ese mismo navegador; no es todavía una proyección remota compartida entre dispositivos.

3. **Conversión de actas — implementada en código; validación real pendiente.** El flujo conserva fuentes `judges`, `joint` y `elimination`, hace preview no mutante, valida contexto autoritativo y guarda versiones con revisión optimista, idempotencia, auditoría e historial. La prueba contra PostgreSQL/Neon real de migraciones, concurrencia, rollback, timeout tras commit y los tres modos sigue pendiente.

4. **Reconciliación de entidades — implementada en código.** Tabulación consulta el Gestor autenticado, compara revisiones con base de tres vías, aplica automáticamente cambios compatibles y conserva para revisión los conflictos o cambios que afectan al histórico. La resolución explícita crea copia previa y solo avanza la base después de guardar localmente. La validación multi-dispositivo real sigue pendiente.

5. **Cola offline y conflictos — implementada parcialmente por tipo de operación.** IndexedDB conserva las publicaciones de rondas, leases, recuperación de operaciones interrumpidas y estados de conflicto/error; las actas oficiales mantienen una operación local persistida con el mismo `operationId` para recuperar timeouts y reconexiones. El worker no confirma tipos sin adaptador y los deja pausados; actualmente el flujo de outbox conectado es la publicación de rondas, no un dispatcher genérico para cualquier tipo futuro. La validación real de reconexión multi-dispositivo sigue pendiente.

### Evidencia de esta iteración

- GitHub Actions run [41240608593](https://github.com/luis-ma-m/cronometro-debate-academico/actions/runs/41240608593): `verify` y `e2e` completados con `success`. `verify` incluye cobertura, `typecheck:api` y build; E2E ejecuta Playwright.
- Vercel Preview del HEAD: [deployment](https://vercel.com/luismarmai-5333/cronometro-debate-academico/3J6RvXbSBhCpRvwVEMPaHnyTRxCH) — `READY`, commit `cb5448b`.
- El primer deployment de esta iteración falló por una variable TypeScript sin uso en el nuevo componente; se corrigió antes del deployment `READY`.
- Consumo de deployments de esta iteración: **2 de 4**.
- No se han aplicado migraciones ni ejecutado escrituras de integración en Neon Production. La validación de base de datos queda bloqueada hasta disponer de una conexión Preview aislada y verificable; un build Preview correcto no demuestra persistencia transaccional.

### Bloqueos que impiden cerrar la PR

- Aplicar y verificar migraciones 0010–0020 en una base Neon Preview aislada.
- Ejecutar pruebas reales de reglas, actas (los tres modos), idempotencia, concurrencia, rollback y recuperación tras timeout.
- Probar vínculo, reconciliación, publicación y recuperación offline con dos dispositivos/perfiles de navegador.
- Decidir si la clasificación de Torneo debe ser visible también en dispositivos que no tengan la copia local de Tabulación; para ello hace falta una proyección remota calculada desde datos fuente persistidos, no guardar un ranking derivado como nueva fuente de verdad.
- Mantener PR #79 en Draft hasta completar las pruebas anteriores.
