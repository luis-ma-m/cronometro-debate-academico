# LEDU Control — organización de torneos de debate

Aplicación web para coordinar un torneo de debate académico LEDU desde un panel privado y abrir un cronómetro por sala. **GitHub versiona el código, Vercel sirve la web y la API, Google Sheets conserva los datos del torneo y Upstash Redis coordina las operaciones concurrentes y las sesiones. No se utiliza Google Apps Script.**

## Funcionalidad

- Panel de organización con acceso por contraseña y sesión temporal.
- Resumen de salas con estados, ronda activa, incidencias y hora de última sincronización.
- Gestión de equipos y jueces: alta, edición de nombre e institución y activación/desactivación sin borrar el historial.
- Creación, renombrado y activación de rondas; creación y edición de salas y asignaciones de equipos y varios jueces.
- Validación de equipos y jueces duplicados en una misma ronda; validación de rondas, IDs y secuencias.
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
- **Persistencia:** Google Sheets API, autenticada desde el servidor mediante una cuenta de servicio.
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

Las pestañas de datos son Config, Rondas, Equipos, Jueces, Salas, Cronometros y Registro. La API puede crear Registro si no existe; no modifica silenciosamente encabezados incorrectos ni crea datos de torneo artificiales.

## Seguridad y límites

- Mantén la hoja privada y compártela como editora únicamente con el correo de la cuenta de servicio.
- Configura una contraseña fuerte en ADMIN_PASSWORD; el placeholder de demo no es adecuado para producción.
- Configura SESSION_SECRET y las variables privadas de Redis y Google en los entornos Vercel necesarios. No publiques claves en GitHub ni las pongas en variables VITE_*.
- Las operaciones de escritura se serializan mediante un bloqueo distribuido y se verifican con revisiones para evitar sobrescrituras obsoletas.
- Los enlaces de control son secretos por sala. Cualquier persona que obtenga el enlace completo puede controlar el cronómetro hasta que se regenere.
- El preset LEDU es una referencia editable; confirma el reglamento y las bases del torneo real.
- Antes de competir, prueba al menos dos salas simultáneas, recarga con el reloj activo, pausa, reanudación, reinicio, tiempo excedido, desconexión y recuperación en los dispositivos reales.
