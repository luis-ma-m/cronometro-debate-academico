# Despliegue de LEDU Control

## Hoja de Google Sheets de este torneo

La aplicación está preparada para trabajar con esta hoja:

https://docs.google.com/spreadsheets/d/1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI/edit

El ID está configurado como valor por defecto en `apps-script/Code.gs`. No hace falta definir `SPREADSHEET_ID` en propiedades del script, salvo que quieras apuntar a otra hoja. La hoja debe permanecer privada; el Apps Script se ejecuta como la cuenta que despliega y esa cuenta debe tener acceso de edición.

## 1. Crear el proyecto de Apps Script vinculado a la hoja

1. Abre la hoja indicada arriba.
2. En Google Sheets, ve a **Extensiones → Apps Script**. Esto crea un proyecto vinculado a la hoja correcta.
3. En el editor, reemplaza el código de `Code.gs` con el contenido de [apps-script/Code.gs](../apps-script/Code.gs).
4. En **Configuración del proyecto**, activa la opción para mostrar el archivo de manifiesto `appsscript.json` y reemplaza su contenido con [apps-script/appsscript.json](../apps-script/appsscript.json).
5. Ve a **Configuración del proyecto → Propiedades del script** y crea:
   - `ADMIN_PASSWORD`: contraseña fuerte para el panel privado. No utilices el placeholder `contraseña`.
   - `SPREADSHEET_ID`: opcional; si está vacío, el script usa automáticamente la hoja de este torneo.
6. Guarda los archivos y vuelve a la hoja de cálculo. Recarga la página.
7. En el menú **LEDU Control**, elige **Preparar hoja del torneo**. En la primera ejecución, acepta la autorización de Google para acceder a la hoja.
8. Comprueba que aparecen las pestañas `Config`, `Rondas`, `Equipos`, `Jueces`, `Salas` y `Cronometros`. La inicialización crea una Ronda 1 y cuatro salas sin asignaciones. No crea equipos ni jueces ficticios. El proceso es seguro para volver a ejecutarlo: no borra los registros existentes.

## 2. Publicar el backend

1. En el editor de Apps Script, haz clic en **Implementar → Nueva implementación**.
2. Selecciona el tipo **Aplicación web**.
3. **Ejecutar como:** tú (la cuenta que administra la hoja).
4. **Quién tiene acceso:** cualquier usuario, incluso anónimo. Es necesario para que las páginas públicas de las salas consulten los datos sin iniciar sesión; el acceso de gestión se valida con `ADMIN_PASSWORD`.
5. Pulsa **Implementar**, completa cualquier paso de autorización y copia la URL que termina en `/exec`.
6. Abre `<URL>/exec?action=health`. Debe responder con `ok: true` e identificar el servicio como `LEDU Control API`. Si aparece `SPREADSHEET_ACCESS`, verifica que el proyecto de Apps Script está vinculado a la hoja correcta y que la cuenta desplegadora tiene acceso.

Si cambias el código más adelante, usa **Implementar → Gestionar implementaciones → Editar → Nueva versión → Implementar** para actualizar la implementación existente.

## 3. Conectar el frontend React

El Apps Script es el backend: no aloja el bundle de React. La interfaz se publica por separado en el alojamiento estático elegido.

Define la variable al construir el frontend:

```bash
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
npm run build
```

Copia el ID/URL real de tu implementación en lugar de `DEPLOYMENT_ID`, y publica el contenido de `dist/`. Configura fallback de rutas para que `/sala/a1` y `/gestion` sirvan `index.html`. No uses la URL del editor ni la URL `/dev`; debes utilizar la URL de producción `/exec`.

## 4. Verificación de extremo a extremo

- Inicia sesión en el panel con la contraseña configurada.
- Crea un equipo y un juez; guarda y comprueba que las filas aparecen en Google Sheets.
- Asigna los participantes a una sala y abre su enlace público.
- Inicia el cronómetro en el dispositivo de sala y comprueba que el estado se actualiza en el panel y en una segunda pantalla dentro del intervalo configurado.
- Verifica que el panel de gestión no tiene controles para iniciar o pausar cronómetros.
- Confirma que asignar un equipo o juez a dos salas de la misma ronda produce un error.

## Seguridad y limitaciones conocidas

- No compartas públicamente la hoja de cálculo.
- La contraseña viaja en el cuerpo de una petición HTTPS, nunca en la URL. La autenticación de administración se comprueba en Apps Script.
- El manifiesto define la web app como `USER_DEPLOYING` y `ANYONE_ANONYMOUS`: Apps Script ejecuta las operaciones con permisos del desplegador, pero acepta visitantes anónimos. Son configuraciones válidas para una API con cronómetros públicos; consulta la documentación oficial de [Web Apps](https://developers.google.com/apps-script/guides/web) y del [manifiesto de Web App](https://developers.google.com/apps-script/manifest/web-app-api-executable).
- En la versión actual, los controles solo se muestran en la interfaz de sala, pero el endpoint `updateRoomTimer` no está vinculado criptográficamente al dispositivo. Un cliente externo que conozca la URL del backend y el ID de sala podría invocarlo directamente. Para exigir exclusividad técnica, hace falta añadir un emparejamiento por sala antes de utilizarlo en competición.
- El acceso desde React debe probarse en navegador real, ya que Apps Script `ContentService` puede redirigir a otra URL al servir el contenido. Si las políticas CORS bloquean la respuesta, coloca un proxy de backend del mismo origen delante de Apps Script.
- El preset de intervenciones es una base editable y debe comprobarse con las bases oficiales de la edición del torneo antes de usarlo en competición.
