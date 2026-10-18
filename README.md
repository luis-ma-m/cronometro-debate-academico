# Debate Control — organización de torneos de debate

Aplicación web para coordinar un torneo de debate académico LEDU desde un panel privado y abrir un cronómetro por sala. **GitHub versiona el código, Vercel sirve la web y la API, Google Sheets conserva los datos del torneo y Upstash Redis coordina las operaciones concurrentes y las sesiones. No se utiliza Google Apps Script.**

## Funcionalidad

- Panel de organización con acceso por contraseña y sesión temporal.
- Resumen de salas con estados, ronda activa, incidencias y hora de última sincronización.
- Gestión de equipos y jueces: alta, edición de nombre e institución y activación/desactivación sin borrar el historial.
- Rondas clasificatorias y eliminatorias; las clasificatorias admiten puntuaciones después de finalizar cada debate, mientras que las eliminatorias no ofrecen actas.
- Registro de actas por ronda: categorías de puntuación editables, sumatorio automático por equipo, faltas leves y graves, hasta ocho puntuaciones individuales de orador y jueces vinculados al acta.
- Historial por equipo y orador, con pendientes de puntuación visibles únicamente para debates finalizados de la ronda activa.
- Rondas dinámicas con activación confirmada: si hay debates sin finalizar, el panel enumera sala, equipos, fase, estado y tiempo restante antes de permitir forzar el cambio.
- Salas físicas con URL pública permanente; cada ronda guarda una asignación independiente de equipos, jueces y estado de cronómetro.
- Presets de formato editables desde Configuración, seleccionables como formato predeterminado de ronda y con excepción por sala.
- Aviso visual de 20 segundos en las pantallas públicas tras activar una ronda, con los equipos y jueces recién asignados.
- Validación de equipos y jueces duplicados en una misma ronda; incompatibilidades por institución, equipo–juez y juez–juez, con relaciones entre jueces simétricas.
- Editor del formato del debate: nombre de la intervención, tipo, postura, interviniente, duración, avisos, exceso de tiempo, orden, alta y baja de intervenciones.
- Preset LEDU general editable con 12 intervenciones y duración teórica de 41 minutos. Comprueba siempre el reglamento de la edición concreta antes del torneo.
- Cronómetro local basado en marcas temporales para evitar deriva acumulada.
- Inicio, pausa, reanudación, reinicio de la intervención actual, anterior, siguiente y finalización del debate.
- Tiempo excedido visible, avisos visuales y sonido opcional activado por el usuario.
- Enlaces de control por sala generados desde gestión y regenerables; un enlace público sin clave solo permite consultar.
- Registro de transiciones del cronómetro en la pestaña Registro, sin escribir cada segundo.
- Sincronización automática cada 10 segundos, feedback de conexión y detección de conflictos de revisión.

## Arquitectura

- **Frontend:** React + TypeScript + Vite.
- **Backend:** funciones de servidor de Vercel en el directorio api/.
- **Persistencia:** Google Sheets API, autenticada desde el servidor mediante una cuenta de servicio. Las categorías de puntuación, actas e IDs de tipo de ronda se conservan como JSON en `Config` para no exigir una migración destructiva ni cambiar encabezados.
- **Coordinación compartida:** Upstash Redis para sesiones revocables, claves de control por sala y bloqueo distribuido de las escrituras.
- **Seguridad:** los secretos solo viven en variables privadas de Vercel y nunca se envían al bundle del navegador.

## Desarrollo local

    npm install
    npm run dev

Si no se configura VITE_API_URL, el entorno local utiliza el modo de demostración en el navegador. La contraseña de muestra es "contraseña" y no es una credencial de producción.

## Pruebas y compilación

    npm test
    npm run build
    npx esbuild api/index.ts --bundle --platform=node --format=esm --outfile=/tmp/ledu-api-check.mjs

## Despliegue

Consulta docs/DEPLOYMENT.md. La API es del mismo origen: el frontend llama a /api y el estado de salud está en /api?action=health. No es necesario definir VITE_APPS_SCRIPT_URL ni publicar una aplicación web de Apps Script.

La hoja configurada para el proyecto es:

https://docs.google.com/spreadsheets/d/1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI/edit

El esquema v3 usa Config, Rondas, Equipos, Jueces, Salas, SalasFisicas, Formatos, Cronometros y Registro. Equipos y Jueces guardan `incompatibleJudgeIds` como JSON. En el primer acceso a Production sin `schemaVersion=3`, la API reinicializa los datos y crea la ronda inicial y el preset LEDU. Esta migración v3 es destructiva una sola vez; Preview sigue bloqueado para no borrar la hoja compartida. **Esta migración es destructiva y no conserva el torneo anterior.** Los previews no pueden ejecutarla para evitar que un despliegue de prueba borre la hoja de producción compartida. Consulta docs/DEPLOYMENT.md antes del despliegue.


## Incompatibilidades (esquema v3)

En las pestañas Equipos y Jueces se pueden buscar y configurar incompatibilidades por IDs estables. Las institucionales siguen siendo obligatorias; las relaciones entre jueces se mantienen recíprocas. Gestión, validación de guardado y API de inicio del cronómetro utilizan las mismas reglas para institución, equipo–juez y juez–juez. Las incompatibilidades que afecten a asignaciones ya existentes se muestran para revisión, sin retirar asignaciones automáticamente.

**Migración destructiva:** el primer acceso a Production sin `schemaVersion=3` reinicializa las pestañas de la hoja, incluyendo equipos, jueces, asignaciones, cronómetros e historial, y crea una ronda y el preset LEDU. Preview no puede ejecutar la migración. Exporta previamente los datos necesarios y acepta explícitamente la pérdida antes del despliegue.

## Seguridad y límites

- Mantén la hoja privada y compártela como editora únicamente con el correo de la cuenta de servicio.
- Configura una contraseña fuerte en ADMIN_PASSWORD; el placeholder de demo no es adecuado para producción.
- Configura únicamente ADMIN_PASSWORD, GOOGLE_SERVICE_ACCOUNT_JSON, UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN como variables privadas de Vercel. No publiques claves en GitHub ni las pongas en variables VITE_*.
- Las operaciones de escritura se serializan mediante un bloqueo distribuido y se verifican con revisiones para evitar sobrescrituras obsoletas.
- Los enlaces de control son secretos por sala. Cualquier persona que obtenga el enlace completo puede controlar el cronómetro hasta que se regenere.
- El preset LEDU es una referencia editable; confirma el reglamento y las bases del torneo real.
- Antes de competir, prueba al menos dos salas simultáneas, recarga con el reloj activo, pausa, reanudación, reinicio, tiempo excedido, desconexión y recuperación en los dispositivos reales.
