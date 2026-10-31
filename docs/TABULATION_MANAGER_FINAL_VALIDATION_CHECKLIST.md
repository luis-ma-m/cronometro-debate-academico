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
- [ ] Validar migración IndexedDB v1 → v2 en navegador con datos de prueba; registros, índices, leases y operaciones pendientes deben sobrevivir.
- [ ] Confirmar que una respuesta remota vacía/errónea no se interpreta como borrado y no se pierden entidades históricas.
- [ ] Verificar que operaciones sin dispatcher no se marcan como confirmadas ni se descartan.

## 3. F4 — actas oficiales: pruebas PostgreSQL/Neon y Preview

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
- [ ] Forzar fallo durante auditoría/proyección/contador y comprobar rollback transaccional completo.
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

- [ ] Con backend disponible, crear y resolver enlaces cortos de exactamente 8 caracteres.
- [ ] Verificar aleatoriedad criptográfica, colisiones, unicidad, rate limit, expiración y revocación.
- [ ] Confirmar revocación individual, múltiple y global con confirmación y auditoría.
- [ ] Con backend caído, generar y abrir A2 local sin petición obligatoria al servidor.
- [ ] Confirmar compatibilidad A1/A2 históricos y que WhatsApp no añade A2 automáticamente cuando el short link se genera correctamente.
- [ ] Confirmar que short links no se presentan como resolubles offline y que los fallos se comunican de forma controlada.

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
