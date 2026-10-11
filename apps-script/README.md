# Google Apps Script · LEDU Control

Este directorio contiene el backend que conecta la interfaz React con la hoja de cálculo del torneo.

## Hoja vinculada

El ID por defecto ya apunta a la hoja configurada para este proyecto:

`1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI`

No hace falta compartir públicamente la hoja. El script se ejecuta como la cuenta que lo despliega y esa cuenta debe tener acceso de edición a la hoja.

## Preparar el proyecto

1. Abre la hoja de cálculo de torneo en Google Sheets.
2. Ve a **Extensiones → Apps Script** para crear un proyecto vinculado a esa hoja.
3. Sustituye el contenido de `Code.gs` por el archivo de este directorio.
4. En Configuración del proyecto, activa la visualización del archivo de manifiesto `appsscript.json` y reemplaza su contenido con el manifiesto versionado aquí.
5. En **Configuración del proyecto → Propiedades del script**, añade `ADMIN_PASSWORD` con una contraseña fuerte. `SPREADSHEET_ID` es opcional porque el ID del torneo ya viene configurado.
6. Guarda los archivos y vuelve a la hoja. Recarga la hoja y ejecuta **LEDU Control → Preparar hoja del torneo**. La primera vez se solicitarán permisos; aprueba el acceso a la hoja.
7. Verifica que aparezcan las pestañas `Config`, `Rondas`, `Equipos`, `Jueces`, `Salas` y `Cronometros`. Se crea una Ronda 1 y cuatro salas vacías para que puedas empezar a asignar equipos y jueces. No se inventan participantes.
8. En Apps Script, selecciona **Implementar → Nueva implementación → Aplicación web**. Ejecutar como: **Yo**. Acceso: **Cualquier usuario**, incluidos anónimos, para que los cronómetros públicos puedan consultar los datos.
9. Publica y copia la URL terminada en `/exec`. Prueba `<URL>/exec?action=health`; debe responder con `ok: true` y el nombre de la hoja.

## Conectar el frontend

Al compilar el frontend React, define:

```bash
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

No uses la URL del editor ni la URL de prueba `/dev`; debe ser la URL de despliegue `/exec`. Al cambiar esta variable, vuelve a ejecutar el build y publica el frontend.

## Seguridad

- No compartas públicamente la hoja.
- No uses `contraseña` como credencial real; se reserva para la demo local.
- La web app debe ejecutarse como propietario/desplegador para poder leer y escribir en la hoja sin pedir permisos a cada participante.
- El acceso anónimo es necesario para lectura pública de salas. En la versión actual, el endpoint de acciones del cronómetro también acepta solicitudes anónimas; la limitación de controles a la pantalla de sala es de interfaz, no una vinculación criptográfica exclusiva a un dispositivo. No uses la web app en producción con esa limitación si necesitas impedir manipulación por clientes externos.
