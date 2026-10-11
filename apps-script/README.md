# Google Apps Script · LEDU Control

Este directorio contiene el backend que conecta la interfaz React con la hoja de cálculo del torneo.

## Hoja vinculada

ID predeterminado: 1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI

No compartas públicamente la hoja. El script se ejecuta como la cuenta desplegadora y esa cuenta necesita permiso de edición.

## Preparar y publicar

1. Abre la hoja y entra en Extensiones → Apps Script.
2. Reemplaza Code.gs por el archivo versionado en este directorio.
3. Activa la visualización de appsscript.json en la configuración del proyecto y actualiza su contenido.
4. Define ADMIN_PASSWORD en las propiedades del script con una contraseña fuerte. SPREADSHEET_ID es opcional.
5. Guarda y ejecuta setupSheets desde el editor, o recarga la hoja y selecciona LEDU Control → Preparar hoja del torneo. Autoriza a Google si te lo solicita.
6. Confirma las pestañas Config, Rondas, Equipos, Jueces, Salas, Cronometros y Registro.
7. Publica o actualiza la implementación web con acceso a cualquier usuario anónimo para habilitar la lectura pública de los cronómetros. Debe ejecutarse como la cuenta que administra la hoja.
8. Comprueba la URL /exec?action=health.

La actualización del repositorio no publica el código de Apps Script automáticamente. Después de cambiar Code.gs, ve a Implementar → Gestionar implementaciones → Editar → Nueva versión → Implementar.

## Contrato de seguridad

- La contraseña de gestión reside en Script Properties. El navegador solo recibe una sesión temporal cuya validez comprueba el servidor en cada operación protegida.
- Las páginas públicas solo reciben los datos operativos de la sala solicitada; no se devuelven notas de gestión ni datos privados de contacto.
- La gestión genera una clave de control por sala mediante getRoomControllerToken tras autenticar la sesión. La clave se almacena en Script Properties y el backend la exige en cada transición del cronómetro.
- La clave de control se transporta en el fragmento de URL, no en el query string. Compártela solo con el dispositivo que deba controlar la sala. Al regenerar el enlace, la clave previa deja de funcionar.
- Cada transición comprueba la revisión esperada dentro de LockService y anexa un evento a Registro. Los cambios obsoletos se rechazan para no sobrescribir un estado más reciente.
- Registro es append-only desde la aplicación. No guarda cada segundo, solo transiciones relevantes.
- El formato global y sus tiempos se persisten en Config.formatPhases. Cambiar el formato mientras haya cronómetros en curso o pausados se rechaza; tras cambiar la secuencia, los cronómetros afectados se reinician al primer turno.
- El preset LEDU es editable y debe verificarse contra las bases oficiales del torneo real.

## Diagnóstico

- NOT_CONFIGURED: configura ADMIN_PASSWORD.
- SPREADSHEET_ACCESS: comprueba el ID y el acceso de la cuenta desplegadora.
- NOT_INITIALIZED o SCHEMA_MISMATCH: abre la hoja, verifica las pestañas y ejecuta Preparar hoja del torneo sin alterar manualmente los encabezados.
- REVISION_CONFLICT: actualiza el estado y vuelve a aplicar la acción.
- UNAUTHORIZED al controlar una sala: abre la sala desde el panel. Si un enlace antiguo dejó de funcionar, genera uno nuevo.
- Si la interfaz muestra un error CORS o una respuesta que no es JSON, prueba el endpoint health y después el flujo POST desde el navegador que se usará en el torneo. Apps Script ContentService puede redirigir la respuesta.
