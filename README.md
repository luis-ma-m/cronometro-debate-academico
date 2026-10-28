# Debate Control — organización de torneos de debate

Aplicación web para coordinar torneos de debate académico LEDU desde un panel privado y abrir un cronómetro por sala. **GitHub versiona el código; Vercel sirve el frontend y la API; Neon PostgreSQL es la fuente de verdad operativa; Upstash Redis se reserva para sesiones y claves de control.** Google Sheets ya no forma parte de la ruta operativa y sus datos existentes no se importan ni se modifican.

## Funcionalidad

- Panel privado de organización con sesión temporal.
- Gestión de equipos, jueces, oradores e instituciones.
- Rondas clasificatorias y eliminatorias, con activación confirmada y control de debates pendientes.
- Salas físicas con asignaciones independientes por ronda.
- Formatos editables, fases y excepciones por sala.
- Validación de incompatibilidades por institución, equipo–juez y juez–juez; relaciones entre jueces simétricas.
- Actas por ronda, categorías de puntuación, faltas, puntuaciones de oradores y jueces vinculados al acta.
- Historial de equipos/oradores y eventos de auditoría.
- Cronómetros con inicio, pausa, reanudación, reinicio, avance, retroceso y finalización.
- URLs públicas de sala; solo una clave vigente de control permite modificar el cronómetro.
- Detección de revisiones obsoletas y reintentos idempotentes para evitar duplicar operaciones confirmadas.
- **Tabulación local** en `/tabulacion`, que funciona solo en el navegador, sin API: liguilla de grupos (LEDU) o sistema suizo (UC3M), emparejamientos sin revanchas, asignación de jueces sin conflictos, actas por juez, desempates reglamentarios, premios de oradores y eliminatorias. Intercambia participantes y rondas con el panel. Consulta [docs/TABULACION.md](docs/TABULACION.md).

El preset LEDU es una referencia editable. Comprueba el reglamento de la edición concreta antes del torneo.

## Arquitectura

- **Frontend:** React + TypeScript + Vite.
- **Backend:** funciones de servidor de Vercel en `api/`.
- **Persistencia:** Neon PostgreSQL mediante tablas relacionales para equipos, jueces, oradores, rondas, salas, asignaciones, fases, cronómetros, actas, puntuaciones y auditoría.
- **Coordinación:** Upstash Redis para sesiones revocables de ocho horas, contadores de intentos fallidos y claves privadas por sala. No existe un bloqueo global Redis para escrituras.
- **Concurrencia:** transacciones PostgreSQL, revisión optimista del torneo y compare-and-swap por cronómetro. El cambio de estado del cronómetro y su evento de auditoría se guardan en la misma transacción.
- **Seguridad:** las credenciales de backend solo se configuran en variables privadas de Vercel y nunca se envían al navegador.

## Desarrollo local

```bash
npm install
npm run dev
```

Si no se configura `VITE_API_URL`, el entorno local utiliza el modo de demostración en el navegador. La contraseña de muestra no es una credencial de producción.

## Pruebas y compilación

```bash
npm test
npm run typecheck:api
npm run build
```

Las pruebas de integración reales contra PostgreSQL solo se ejecutan si se proporcionan `NEON_TEST_DATABASE_URL` y `NEON_TEST_DATABASE_ISOLATED=1`, apuntando a una base o rama desechable aislada. No uses la base de producción para pruebas.

## Despliegue y migración

Consulta [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) y [docs/NEON_MIGRATION.md](docs/NEON_MIGRATION.md). La tabulación local no necesita configuración de servidor: está documentada en [docs/TABULACION.md](docs/TABULACION.md).

Variables privadas necesarias en Vercel:

- `NEON_DATABASE_URL` (se acepta `DATABASE_URL` como alternativa).
- `ADMIN_PASSWORD`.
- `UPSTASH_REDIS_REST_URL`.
- `UPSTASH_REDIS_REST_TOKEN`.

La API es del mismo origen: el frontend llama a `/api` y el estado de salud está en `/api?action=health`. No es necesario configurar Google Sheets ni publicar una aplicación web de Apps Script.

La migración de esquema y la inicialización son comandos administrativos explícitos (`npm run db:status`, `npm run db:migrate`, `npm run db:seed`). **No se importan datos de Google Sheets.** La base Neon debe estar seleccionada y verificada antes de ejecutar migraciones o seed. El runner verifica checksums y aplica migraciones versionadas dentro de una transacción; por defecto bloquea su ejecución desde Vercel Production.

No retires integraciones o secretos antiguos de Google hasta completar la validación funcional y acordar expresamente su retirada. No se ha de hacer un corte de producción hasta validar las pruebas de integración contra una base aislada y el comportamiento de la aplicación.

## Comprobaciones antes del torneo

- Probar dos o más salas simultáneas, recarga con el reloj activo y recuperación tras desconexión.
- Probar todas las transiciones del cronómetro desde dos clientes y confirmar el rechazo de revisiones obsoletas.
- Verificar activación normal y forzada de rondas, el periodo de anuncio de 20 segundos y la pausa de cronómetros salientes.
- Validar incompatibilidades, asignaciones duplicadas, actas, categorías históricas y puntuaciones inválidas.
- Confirmar auditoría y persistencia tras recargar.
