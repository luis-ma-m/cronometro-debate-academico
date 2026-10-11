# LEDU Control — organización de torneos de debate

Aplicación nueva para organizar torneos LEDU con dos espacios conectados: un panel privado de gestión y un cronómetro público e independiente para cada sala. Google Sheets sirve como fuente de datos a través de Google Apps Script.

## Funciones

- Gestión de rondas, salas, equipos y jueces.
- Varios jueces asignados a una misma sala.
- Asignación de equipos a favor y en contra.
- Vista global del estado de todas las salas.
- Rutas públicas del cronómetro con formato /sala/a1.
- Iniciar, pausar, reanudar, reiniciar y avanzar fases desde el dispositivo de la sala.
- Actualización automática cada 8 segundos, sin recargar la página.
- Cálculo del tiempo mediante marcas temporales para no depender de la frecuencia de los ticks del navegador.
- Validación contra equipos o jueces duplicados en una misma ronda.
- Modo de demostración local si no se ha configurado el backend.

## Requisitos

- Node.js 20 o superior.
- Google Sheets.
- Google Apps Script publicado como aplicación web.

## Ejecutar en local

    npm install
    npm run dev

Modo demo: la contraseña de muestra es contraseña. Esta contraseña solo se usa cuando no existe URL de backend; no es válida para producción.

## Build y pruebas

    npm test
    npm run build

## Conectar Google Sheets

Consulta [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) y [apps-script/README.md](apps-script/README.md). El backend ya apunta a la [hoja del torneo](https://docs.google.com/spreadsheets/d/1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI/edit); solo hay que autorizar y desplegar el Apps Script vinculado. La propiedad de script `ADMIN_PASSWORD` es obligatoria; `SPREADSHEET_ID` es opcional porque tiene un valor por defecto.

## Modelo de datos

La hoja tendrá pestañas Config, Rondas, Equipos, Jueces, Salas y Cronometros. Las relaciones utilizan IDs estables; las asignaciones se validan antes de guardar.

## Advertencias antes de usar en competición

- El preset de intervenciones y sus duraciones es editable; comprueba que coincide con las bases de la edición concreta del torneo LEDU antes de competir.
- El cronómetro solo expone sus controles en la interfaz de sala. La URL de sala es pública y no debe tratarse como un mecanismo de autorización para controlar el reloj desde cualquier cliente.
- Apps Script, permisos, redirecciones, CORS y límites de cuota se deben comprobar en un despliegue real.
- El almacenamiento de sesión de Apps Script usa CacheService. Para un torneo de alto impacto, evalúa persistencia de sesiones y un mecanismo de autorización por sala.
