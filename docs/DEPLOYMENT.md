# Despliegue de LEDU Control

## Desarrollo local
1. Usa Node.js 20 o superior.
2. Ejecuta npm install, npm test y npm run build.
3. Ejecuta npm run dev para abrir el modo demo. Los datos de demostración se guardan solo en el navegador; no representan sincronización entre dispositivos.

## Preparar Google Sheets
1. Crea una hoja de cálculo vacía en Drive.
2. Abre Extensiones → Apps Script y copia apps-script/Code.gs.
3. En Configuración del proyecto → Propiedades del script, define:
   - SPREADSHEET_ID: ID de la hoja.
   - ADMIN_PASSWORD: contraseña fuerte para el panel. No uses el placeholder contraseña.
4. Selecciona setupSheets_ en el editor y ejecútala una vez. Autoriza los permisos.
5. Revisa que existan Config, Rondas, Equipos, Jueces, Salas y Cronometros.

## Publicar Apps Script
1. Implementa como aplicación web.
2. Selecciona ejecutar como propietario del script y configura el acceso de acuerdo con la política de la cuenta.
3. Copia la URL terminada en /exec a una variable de entorno del build: VITE_APPS_SCRIPT_URL.
4. Construye la aplicación y súbela a un alojamiento estático que permita las rutas profundas /gestion y /sala/:id. Configura fallback a index.html.
5. Comprueba login, lectura y escritura, detección de conflictos, control de reloj y lectura desde una segunda pantalla.

## Notas de seguridad y compatibilidad
- La contraseña viaja en el cuerpo de la solicitud POST, no en la URL.
- El cliente usa POST con Content-Type text/plain para evitar preflight de JSON. ContentService de Apps Script, redirecciones, permisos y CORS deben probarse en navegadores reales. Si el navegador bloquea la respuesta, configura un proxy same-origin.
- El enlace de sala es público. Los controles de reloj se muestran solo en esa página, pero el endpoint de acciones no constituye un bloqueo criptográfico exclusivo por dispositivo. Si se necesita exclusividad estricta, añadir un registro de emparejamiento/control por sala.
- No pongas el ID de hoja ni credenciales en variables VITE aparte de la URL pública de la web app. Las credenciales privadas solo van en Script Properties.
