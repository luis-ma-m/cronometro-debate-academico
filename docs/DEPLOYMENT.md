# Despliegue de LEDU Control en Vercel

## Arquitectura operativa

La API de Vercel usa Neon PostgreSQL como fuente de verdad para el torneo. Google Sheets ya no forma parte de la ruta de lectura/escritura de la API. Las tablas relacionales contienen instituciones, equipos, jueces, oradores, rondas, salas físicas, asignaciones, snapshots de fases, cronómetros, categorías, actas, puntuaciones y auditoría.

Upstash Redis se reserva para sesiones revocables, límite de intentos de acceso y claves de control por sala. No se usa un bloqueo global Redis para coordinar las escrituras del torneo. Las escrituras de configuración usan la revisión del torneo; las transiciones del cronómetro comparan la revisión de la asignación dentro de la transacción PostgreSQL.

## 1. Variables privadas de Vercel

Configura las variables como Sensitive/Encrypted y solo en entornos que deban acceder al backend:

| Variable | Uso |
|---|---|
| `NEON_DATABASE_URL` | Conexión PostgreSQL generada por la integración Neon. Se acepta `DATABASE_URL` como alternativa. |
| `ADMIN_PASSWORD` | Contraseña privada del gestor. |
| `UPSTASH_REDIS_REST_URL` | Endpoint REST de Redis. |
| `UPSTASH_REDIS_REST_TOKEN` | Token privado de Redis. |

No pongas secretos en variables `VITE_*`. Production y Preview deben utilizar bases de datos separadas; no apuntes una Preview a la base de producción para probar cambios de esquema. Tras modificar variables, vuelve a desplegar para que las funciones reciban la configuración.

La integración Neon conectada se identificó como `gestor-de-debate-neon`; comprueba en el dashboard que el entorno seleccionado corresponde al proyecto y rama de base de datos correctos antes de ejecutar cualquier migración.

## 2. Inicializar la base de datos

La migración no importa datos de Google Sheets. La base de destino se prepara deliberadamente sin copiar el torneo anterior, conservando las reglas de negocio en el código.

Desde un entorno administrativo controlado, con `NEON_DATABASE_URL` apuntando a la base correcta:

```bash
npm ci
npm run db:status
npm run db:migrate
npm run db:status
npm run db:seed
```

El runner aplica los SQL versionados en orden, verifica SHA-256 y registra el historial en `schema_migrations` dentro de una transacción con advisory lock. No edites una migración ya aplicada: añade una nueva versión. El runner bloquea por defecto las migraciones desde el runtime Vercel Production.

El seed es idempotente y crea únicamente los valores predeterminados que falten: configuración del torneo, preset LEDU, sus fases y ronda inicial. No ejecutes los comandos hasta verificar el destino de la conexión. La API responde `DATABASE_NOT_INITIALIZED` si faltan los valores base.

## 3. Redis y seguridad de las salas

Configura `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`. Redis conserva:

- Sesiones del gestor con duración de ocho horas.
- Contadores de intentos fallidos con ventana de quince minutos.
- Claves privadas de control por sala física; rotarlas invalida las claves anteriores.

La página pública de una sala permite consultar el estado, pero solo una clave de control vigente puede iniciar, pausar, reanudar, reiniciar, avanzar, retroceder o finalizar el cronómetro. La conexión PostgreSQL nunca se entrega al navegador.

## 4. Comprobaciones tras desplegar

1. Abre `/api?action=health`. La respuesta debe identificar `Neon PostgreSQL` y verificar Redis.
2. Abre `/gestion`, inicia sesión y confirma que el torneo carga desde la base recién inicializada.
3. Crea/edita instituciones, equipos, jueces, oradores, formatos y asignaciones. Recarga y confirma que persisten.
4. Comprueba incompatibilidades de institución, equipo–juez y juez–juez, así como que un equipo o juez no puede asignarse a dos debates de la misma ronda.
5. Prueba todas las transiciones del cronómetro desde dos clientes. La revisión debe detectar acciones basadas en un estado antiguo; las solicitudes repetidas de la misma transición deben devolver la respuesta ya confirmada.
6. Activa una ronda con debates pendientes, prueba el rechazo normal y la confirmación explícita de activación forzada. Verifica reinicio de asignaciones entrantes, pausa de las salientes, incremento de `activationRevision` y anuncio de 20 segundos.
7. Registra actas en una ronda clasificatoria y verifica el rechazo en rondas eliminatorias, debates no finalizados, equipos/jueces incorrectos, categorías históricas y puntuaciones inválidas.
8. Comprueba los eventos de auditoría y la ausencia de escrituras por segundo.
9. Ejecuta pruebas de concurrencia con salas distintas y simultáneas; objetivo mínimo: 20 operaciones válidas en 5 segundos sin pérdida ni duplicación.
10. Confirma CI, typecheck de API, build y una prueba de integración contra una base Neon de test aislada antes de cualquier corte de producción.

## Contrato de API

El frontend conserva las acciones `login`, `logout`, `getTournament`, `getPublicRoom`, `getRoomControllerToken`, `saveTournament`, `saveScoreConfig`, `getRoundActivationPreview`, `activateRound` y `updateRoomTimer`. Las respuestas mantienen el envoltorio `{ ok, data }` o `{ ok: false, error }`.

Las escrituras de configuración comparan `expectedRevision`; los cronómetros comparan `expectedRevision`, `assignmentId` y `expectedActivationRevision`. Las actualizaciones de cronómetro y su evento de auditoría se confirman en la misma transacción. La clave idempotente de una transición se deriva de la sala, asignación, revisión esperada y acción, de modo que un reintento tras perder la respuesta no aplica una segunda transición.

## Rollback y límites

No se importa ni se borra el contenido de Google Sheets; permanece separado y deja de ser operativo. Para volver atrás no basta con cambiar una variable: el código anterior esperaba Sheets como fuente de verdad y no recibirá las nuevas escrituras. Cualquier rollback de aplicación debe ser deliberado y considerar que la base PostgreSQL ya contiene las operaciones nuevas. No retires la integración o los secretos de Google hasta que la validación funcional y de producción esté completa y se haya acordado explícitamente su retirada.
