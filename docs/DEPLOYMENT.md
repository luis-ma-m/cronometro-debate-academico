# Despliegue de LEDU Control

## Hoja del torneo

La aplicación usa esta hoja de cálculo privada:

https://docs.google.com/spreadsheets/d/1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI/edit

El ID está configurado como predeterminado en apps-script/Code.gs. No publiques la hoja. La cuenta que despliega Apps Script debe tener acceso de edición.

## 1. Actualizar el backend de Apps Script

Los cambios en GitHub o Vercel no actualizan automáticamente el código del proyecto de Apps Script. Hay que publicar una nueva versión del backend cuando cambie apps-script/Code.gs.

1. Abre la hoja anterior y accede a Extensiones → Apps Script.
2. Sustituye el contenido de Code.gs por el archivo apps-script/Code.gs del repositorio, incluyendo las funciones de validación, registro de eventos y autorización por sala.
3. En Configuración del proyecto, habilita el manifiesto appsscript.json y comprueba que coincide con apps-script/appsscript.json.
4. En Propiedades del script, verifica que ADMIN_PASSWORD contiene una contraseña fuerte. SPREADSHEET_ID es opcional si se utiliza la hoja predeterminada.
5. Guarda y ejecuta la función setupSheets o vuelve a la hoja, recarga y selecciona LEDU Control → Preparar hoja del torneo. Autoriza el acceso cuando Google lo solicite.
6. Comprueba que existen las pestañas Config, Rondas, Equipos, Jueces, Salas, Cronometros y Registro. La función prepara los encabezados que falten; no borra registros existentes.
7. Selecciona Implementar → Gestionar implementaciones → Editar. Elige Nueva versión y pulsa Implementar. Mantén la URL de producción /exec si actualizas una implementación existente.
8. Verifica que la URL terminada en /exec?action=health devuelve ok: true y el nombre de la hoja.

Importante: los cambios del backend que añaden la pestaña Registro y la clave de control por sala requieren desplegar la nueva versión de Apps Script antes de probar los controles nuevos del frontend.

## 2. Configurar el acceso y la hoja

- El script debe ejecutarse como la cuenta que lo despliega y el acceso web debe permitir visitantes anónimos, porque los cronómetros públicos tienen que poder leer su estado.
- Las operaciones de gestión requieren una sesión temporal validada por Apps Script.
- Los enlaces de control se generan desde el panel después de guardar la asignación de la sala. La clave se guarda como propiedad del script y se pasa en el fragmento del enlace (después de #), no como parámetro de consulta.
- Si un enlace completo de control se expone, usa Regenerar enlace en la gestión. La regeneración invalida la clave anterior para esa sala.

## 3. Configurar Vercel

En el proyecto Vercel, añade la variable de entorno:

- Nombre: VITE_APPS_SCRIPT_URL
- Valor: la URL de la implementación de Apps Script que termina en /exec
- Entorno: Production. También puede añadirse a Preview y Development para probar esos despliegues.

Guarda la variable y ejecuta Redeploy para que Vite compile el bundle con el valor. Vite incorpora las variables VITE_ en el frontend compilado: esta URL es un endpoint público, no debe contener contraseñas ni claves privadas.

Vercel debe servir index.html para las rutas de la SPA como /gestion y /sala/a1. Tras desplegar, prueba la URL de producción y abre una ruta de sala directamente en una pestaña nueva.

## 4. Verificación funcional previa al torneo

1. Inicia sesión en gestión.
2. Crea un equipo y un juez, guarda y comprueba las filas en Google Sheets.
3. Asigna dos equipos y al menos un juez a una sala; guarda y abre el cronómetro desde esa tarjeta.
4. Comprueba que la página abierta desde el panel tiene controles, mientras que abrir manualmente /sala/a1 sin enlace de control solo permite consultar.
5. Inicia, pausa, reanuda, reinicia una intervención, vuelve a la anterior, avanza y finaliza. Comprueba la pestaña Registro.
6. Abre dos salas a la vez y comprueba que una acción en una sala no cambia la otra. Intenta una escritura obsoleta y verifica que el backend exige refrescar.
7. Recarga una sala con el reloj activo y compara el tiempo; pasa de cero y comprueba el exceso de tiempo y el aviso sonoro después de activarlo.
8. Desconecta y recupera la red; confirma que la interfaz avisa cuando no puede confirmar la última sincronización.
9. Intenta guardar equipos o jueces duplicados en una misma ronda y verifica que se bloquea el guardado.
10. Prueba el formato LEDU en el navegador y pantalla que se utilizarán el día del evento.

## Límites que deben mantenerse visibles

- El preset de 12 turnos y 41 minutos es una referencia procedente de la especificación del proyecto. Confirma el reglamento y las bases del torneo concreto antes de competir.
- La contraseña compartida ofrece seguridad básica, no gestión de identidad por usuario.
- El dispositivo controlador se autoriza mediante un enlace secreto por sala. Cualquier persona que obtenga el enlace de control completo puede usarlo hasta que se regenere; comparte solo la URL pública si el destinatario no debe controlar el reloj.
- Apps Script tiene cuotas y latencia. Simula el número de salas previsto en el torneo; el intervalo de consulta objetivo es de 10 segundos, no tiempo real garantizado.
- Apps Script ContentService puede redirigir su respuesta. Comprueba las solicitudes POST desde el navegador real desplegado porque CORS y las redirecciones dependen del entorno.
