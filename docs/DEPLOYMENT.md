# Despliegue de LEDU Control en Vercel

## Arquitectura vigente

No se utiliza Google Apps Script. El frontend y la API se despliegan desde el mismo repositorio en Vercel. Las funciones de servidor del directorio api/ acceden a Google Sheets API mediante una cuenta de servicio. Google Sheets sigue siendo la fuente de verdad del torneo.

Se utiliza Upstash Redis únicamente para elementos operativos que no pueden residir solo en la memoria efímera de una función: sesiones revocables, claves de control por sala y un bloqueo distribuido para serializar escrituras simultáneas. Los datos del torneo continúan en la hoja.

## 1. Preparar Google Sheets API

La hoja del torneo es:

https://docs.google.com/spreadsheets/d/1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI/edit

1. En Google Cloud Console, selecciona o crea un proyecto y habilita **Google Sheets API**.
2. Crea una cuenta de servicio y genera una clave JSON para esa cuenta.
3. Copia el valor de client_email a la variable privada GOOGLE_SERVICE_ACCOUNT_EMAIL de Vercel.
4. Comparte la hoja anterior con ese correo y dale permiso de editor. La hoja debe seguir siendo privada; no habilites el acceso público.
5. Conserva el contenido de private_key en un gestor seguro y úsalo solo para la variable privada GOOGLE_PRIVATE_KEY de Vercel. Puedes pegar el PEM con saltos de línea o con los saltos representados como \n. No lo guardes en GitHub ni lo compartas en el chat.

La API conserva el esquema existente: Config, Rondas, Equipos, Jueces, Salas, Cronometros y Registro. Si falta únicamente la pestaña Registro, la API la crea con los encabezados correctos. Si falta una pestaña principal o los encabezados no coinciden, la API se detiene sin sobrescribir datos existentes.

## 2. Preparar coordinación en Upstash Redis

Las funciones de Vercel son efímeras y pueden ejecutarse en paralelo. Un bloqueo en memoria no sirve para coordinar distintas instancias, por lo que Redis es necesario para mantener las garantías de concurrencia y revocación de sesiones.

1. Crea una base Redis de Upstash desde la integración/Marketplace de Vercel o desde Upstash.
2. Obtén el REST URL y el REST token de esa base.
3. Añádelos a Vercel como UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN. Solo las funciones del servidor deben poder leerlos.

Redis no reemplaza Google Sheets: el contenido del torneo, las asignaciones, el estado persistente de cada cronómetro y los eventos siguen guardándose en la hoja.

## 3. Variables de entorno de Vercel

En Project Settings → Environment Variables, configura estas variables como **Encrypted** o **Sensitive** cuando la opción esté disponible. Configúralas al menos para Production y Preview; añade Development si vas a probar el backend con despliegue local de Vercel.

| Variable | Valor |
|---|---|
| GOOGLE_SERVICE_ACCOUNT_EMAIL | Correo client_email de la cuenta de servicio. |
| GOOGLE_PRIVATE_KEY | Clave privada PEM de la cuenta de servicio. |
| GOOGLE_SHEETS_SPREADSHEET_ID | ID de la hoja indicada arriba; puede omitirse porque el proyecto tiene ese valor predeterminado. |
| ADMIN_PASSWORD | Contraseña fuerte y privada para el panel. No uses la contraseña de demo. |
| SESSION_SECRET | Secreto aleatorio de al menos 32 bytes para comparaciones de credenciales. |
| UPSTASH_REDIS_REST_URL | REST URL de la base Redis de Upstash. |
| UPSTASH_REDIS_REST_TOKEN | Token REST privado de esa base Redis. |

Puedes generar SESSION_SECRET localmente con:

    openssl rand -hex 32

No es necesario definir VITE_APPS_SCRIPT_URL. No coloques ninguna de las credenciales anteriores en variables VITE_*: esas variables se incorporan al JavaScript público.

Después de guardar las variables, vuelve a desplegar Vercel para asegurarte de que las funciones reciben la nueva configuración.

## 4. Verificar API y despliegue

1. Abre https://<tu-despliegue>.vercel.app/api?action=health. La respuesta correcta debe contener ok: true, status: "ok" y los nombres de las pestañas.
2. Si responde NOT_CONFIGURED, añade las variables privadas que indique el mensaje. Si informa de permisos de hoja, comprueba que compartiste la hoja con el correo de la cuenta de servicio.
3. Abre /gestion e inicia sesión con ADMIN_PASSWORD.
4. Crea o edita un equipo y un juez; guarda y confirma que los datos aparecen en Sheets.
5. Asigna dos equipos y los jueces a una sala; abre el cronómetro desde gestión.
6. Comprueba que la página pública de sala sin la clave de control solo permite consultar. Prueba iniciar, pausar, reanudar, reiniciar, avanzar, retroceder y finalizar desde un enlace de control.
7. Regenera el enlace y confirma que el enlace anterior deja de controlar la sala.
8. Abre dos salas a la vez, haz transiciones próximas en el tiempo y verifica revisiones, historial y que las acciones de una sala no afectan a otra.
9. Recarga con el reloj en curso, deja que pase de cero y prueba desconectar/reconectar.
10. Comprueba que Registro recibe una fila por transición relevante y no una fila por segundo.

## Contrato de API

Las peticiones de escritura usan POST a /api con JSON de la forma { "action": "nombreAccion", "payload": { ... } }. Se mantiene el contrato que usa el frontend: login, logout, getTournament, getPublicRoom, getRoomControllerToken, saveTournament y updateRoomTimer.

La API valida la sesión en el servidor, limita intentos fallidos de acceso, excluye notas internas de la respuesta pública, valida asignaciones y formato, compara las revisiones y serializa saveTournament y updateRoomTimer mediante bloqueo distribuido. La escritura de las tablas afectadas y el evento de cronómetro se agrupan en una petición batchUpdate de Google Sheets.

## Diagnóstico

- NOT_CONFIGURED: falta alguna variable privada de Vercel. El mensaje lista sus nombres, no sus valores.
- GOOGLE_AUTH_FAILED: comprueba que el JSON de cuenta de servicio corresponde al correo y a la clave configurados.
- SHEETS_PERMISSION_DENIED: comparte el documento con el correo client_email de la cuenta de servicio y dale permiso de editor.
- SCHEMA_MISMATCH: revisa las pestañas y los encabezados sin eliminarlos ni reordenarlos manualmente.
- COORDINATION_UNAVAILABLE: verifica que Redis responde y que el REST URL y token están bien configurados.
- UNAUTHORIZED: vuelve a iniciar sesión o genera un enlace de control nuevo.
- REVISION_CONFLICT: actualiza los datos desde el servidor y vuelve a guardar o aplicar la transición.
- WRITE_BUSY: otra petición está guardando cambios. Espera brevemente y vuelve a intentarlo.

## Puesta en producción

No se considera finalizada la migración hasta que las variables privadas estén configuradas y el endpoint de salud, login, guardado, apertura de sala y transiciones se hayan probado desde un despliegue real. Las pruebas locales y de CI no sustituyen la autorización real de la cuenta de servicio ni la prueba de dos salas simultáneas.
