# Despliegue de LEDU Control en Vercel

## Arquitectura vigente

No se utiliza Google Apps Script. El frontend y la API se despliegan desde el mismo repositorio en Vercel. Las funciones de servidor del directorio api/ acceden a Google Sheets API mediante una cuenta de servicio. Google Sheets sigue siendo la fuente de verdad del torneo.

Se utiliza Upstash Redis únicamente para elementos operativos que no pueden residir solo en la memoria efímera de una función: sesiones revocables, claves de control por sala y un bloqueo distribuido para serializar escrituras simultáneas. Los datos del torneo continúan en la hoja.

## 1. Preparar Google Sheets API

La hoja del torneo es:

https://docs.google.com/spreadsheets/d/1YxqCaKESdneb42Oqty2pssnmm_LyiS2hhBs4plcequI/edit

1. En Google Cloud Console, selecciona o crea un proyecto y habilita **Google Sheets API**.
2. Crea una cuenta de servicio y genera una clave JSON para esa cuenta.
3. Guarda el JSON descargado completo en una variable privada de Vercel llamada GOOGLE_SERVICE_ACCOUNT_JSON. No hace falta separar el correo y la clave en variables distintas.
4. Comparte la hoja anterior con el valor client_email que aparece dentro del JSON y dale permiso de editor. La hoja debe seguir siendo privada; no habilites el acceso público.
5. No subas el JSON a GitHub ni lo compartas por el chat. Solo debe estar guardado como variable privada en Vercel.

El esquema v2 utiliza las pestañas `Config`, `Rondas`, `Equipos`, `Jueces`, `Salas`, `Cronometros`, `Registro`, `SalasFisicas` y `Formatos`. `SalasFisicas` conserva la identidad y el slug permanente de cada sala; `Salas` registra las asignaciones por ronda; `Formatos` contiene presets versionados.

**Migración destructiva del esquema v2:** en la primera petición al backend en el entorno `Production`, si `Config` no contiene `schemaVersion=2`, la API crea las pestañas que falten, reinicializa el contenido de las pestañas de datos y crea una ronda inicial y el preset LEDU. Se perderán deliberadamente las rondas, equipos, jueces, salas, cronómetros, instituciones e historial anteriores. No conserva ni convierte los datos del esquema previo; esa decisión se tomó para evitar asignaciones ambiguas durante el cambio al modelo de salas permanentes.

La migración solo se ejecuta cuando `VERCEL_ENV=production`. Un despliegue `Preview` contra la misma hoja compartida recibe `SCHEMA_MIGRATION_PRODUCTION_ONLY` y no borra los datos existentes. Después de que Production haya completado la migración, los previews pueden leer el esquema v2. Si se va a reutilizar la hoja para otro torneo, exporta antes cualquier información que quieras conservar.

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
| GOOGLE_SERVICE_ACCOUNT_JSON | Contenido completo del JSON de la cuenta técnica de Google Sheets. |
| ADMIN_PASSWORD | La única contraseña privada que se introduce para entrar en el gestor. |
| UPSTASH_REDIS_REST_URL | REST URL de Redis; coordina las escrituras entre funciones de Vercel. |
| UPSTASH_REDIS_REST_TOKEN | Token privado de esa base Redis. |

Estas son las cuatro variables imprescindibles. El ID de la hoja ya está fijado en el proyecto, y el backend deriva la clave interna de autenticación de ADMIN_PASSWORD: no hace falta una variable SESSION_SECRET adicional.

En Vercel, elimina también VITE_APPS_SCRIPT_URL si sigue presente: pertenece a la versión antigua y ya no se utiliza. No pongas secretos en variables VITE_*, porque se incorporan al JavaScript público.

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

La API valida la sesión en el servidor, limita intentos fallidos de acceso, excluye notas internas de la respuesta pública, valida las asignaciones por ronda y sus formatos, compara las revisiones y serializa las escrituras mediante bloqueo distribuido. Las acciones de activación de ronda muestran un resumen de los debates pendientes, registran si se fuerza el cambio, reinician los cronómetros de las asignaciones entrantes y anuncian la nueva ronda en las pantallas públicas durante 20 segundos. Las URLs públicas usan el slug estable de la sala física, no el ID de una asignación específica. La escritura de las tablas afectadas y los eventos se agrupan en una petición batchUpdate de Google Sheets.

## Diagnóstico

- NOT_CONFIGURED: falta alguna de las cuatro variables privadas, o GOOGLE_SERVICE_ACCOUNT_JSON no contiene un JSON válido con client_email y private_key. El mensaje indica la configuración que falta sin mostrar sus valores.
- GOOGLE_AUTH_FAILED: comprueba que el JSON de cuenta de servicio es válido y que la clave no se ha revocado.
- SHEETS_PERMISSION_DENIED: comparte el documento con el correo client_email de la cuenta de servicio y dale permiso de editor.
- SCHEMA_MISMATCH: revisa las pestañas y los encabezados sin reordenarlos manualmente.
- SCHEMA_MIGRATION_PRODUCTION_ONLY: la hoja aún requiere la migración destructiva del esquema v2; no se permite ejecutarla desde Preview. Una vez confirmada la transición, deja que la primera petición en Production la complete.
- COORDINATION_UNAVAILABLE: verifica que Redis responde y que el REST URL y token están bien configurados.
- UNAUTHORIZED: vuelve a iniciar sesión o genera un enlace de control nuevo.
- REVISION_CONFLICT: actualiza los datos desde el servidor y vuelve a guardar o aplicar la transición.
- WRITE_BUSY: otra petición está guardando cambios. Espera brevemente y vuelve a intentarlo.

## Puesta en producción

No se considera finalizada la migración hasta que las variables privadas estén configuradas y el endpoint de salud, login, guardado, apertura de sala y transiciones se hayan probado desde un despliegue real. Las pruebas locales y de CI no sustituyen la autorización real de la cuenta de servicio ni la prueba de dos salas simultáneas.
