# LEDU Control — organización de torneos de debate

Aplicación web para coordinar un torneo de debate académico LEDU desde un panel privado y abrir un cronómetro por sala. Google Sheets es la fuente persistente de datos; Google Apps Script sirve la API; Vercel aloja el frontend React.

## Funcionalidad

- Panel de organización con acceso por contraseña y sesión temporal.
- Resumen de salas con estados, ronda activa, incidencias y hora de última sincronización.
- Gestión de equipos y jueces: alta, edición de nombre e institución y activación/desactivación sin borrar el historial.
- Creación, renombrado y activación de rondas; creación y edición de salas y asignaciones de equipos y varios jueces.
- Validación de equipos y jueces duplicados en una misma ronda; validación de rondas, IDs y secuencias.
- Editor del formato del debate: nombre de la intervención, tipo, postura, interviniente, duración, umbrales de aviso, visualización de tiempo excedido, orden, alta y baja de intervenciones.
- Preset inicial LEDU general editable con 12 intervenciones y duración teórica de 41 minutos. Verifica siempre las bases oficiales de la edición concreta antes del torneo.
- Cronómetro local basado en marcas temporales; no acumula deriva por depender de ticks de intervalos.
- Inicio, pausa, reanudación, reinicio de la intervención actual, anterior, siguiente y finalización del debate.
- Tiempo excedido visible, avisos visuales y sonido opcional activado por el usuario.
- Enlaces de control por sala generados desde el panel y regenerables; un enlace público sin clave solo permite consultar.
- Registro append-only de transiciones del cronómetro en la pestaña Registro.
- Sincronización automática cada 10 segundos, feedback de conexión y recuperación de conflictos de revisión.
- Modo de demostración local si no existe VITE_APPS_SCRIPT_URL.

## Requisitos

- Node.js 20 o superior.
- Un documento privado de Google Sheets.
- Google Apps Script publicado como aplicación web.
- Un proyecto Vercel conectado al repositorio.

## Desarrollo local

    npm install
    npm run dev

En modo demo, la contraseña de muestra es "contraseña". Solo sirve para desarrollo sin backend y no es una credencial de producción.

## Build y pruebas

    npm test
    npm run build

## Backend de Google Sheets

Consulta docs/DEPLOYMENT.md y apps-script/README.md. El backend está preparado para la hoja de cálculo configurada para este proyecto. La propiedad de script ADMIN_PASSWORD es obligatoria; SPREADSHEET_ID es opcional si se usa el ID por defecto.

Pestañas usadas: Config, Rondas, Equipos, Jueces, Salas, Cronometros y Registro. Config.formatPhases contiene el formato global del debate.

## Despliegue

Vercel debe definir VITE_APPS_SCRIPT_URL en Production y volver a compilar después de cambiarla. La actualización del frontend no despliega automáticamente el código fuente de Apps Script: al cambiar apps-script/Code.gs, actualiza el proyecto de Apps Script y publica una nueva versión de la implementación web.

## Seguridad y límites conocidos

- La hoja de cálculo no debe ser pública y las credenciales no se envían al navegador.
- La contraseña compartida es protección básica; usa una contraseña fuerte y privada en ADMIN_PASSWORD.
- La clave de control del enlace no se envía en la navegación normal al servidor, pero cualquiera que obtenga ese enlace completo podrá controlar la sala hasta que se regenere. No compartas un enlace de control cuando solo quieras mostrar el cronómetro.
- Los cambios de formato se bloquean mientras existan relojes en curso o pausados. Los relojes afectados se reinician a la primera intervención cuando la nueva secuencia se aplica.
- El preset LEDU es una referencia inicial basada en la especificación del proyecto; confirma el reglamento aplicable al evento.
- La prueba final debe incluir al menos dos salas simultáneas, recarga durante el reloj, control desde otro enlace sin clave, pérdida de red y ensayo en los dispositivos reales del torneo.
