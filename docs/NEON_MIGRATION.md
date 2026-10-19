# Migración a Neon PostgreSQL

Esta rama introduce la base de esquema y herramientas de Neon, pero todavía no cambia la API operativa. No borra ni modifica Google Sheets y no debe desplegarse como migración final hasta que se complete la sustitución de todos los repositorios.

## Arquitectura

- Neon PostgreSQL será la fuente de verdad futura.
- La API server-side usa `@neondatabase/serverless`; el navegador nunca recibe credenciales.
- Añade `DATABASE_URL` como variable privada/encrypted en Vercel.
- Upstash Redis se mantiene por ahora para sesiones, rate limit y claves de control de salas.
- No retirar todavía `GOOGLE_SERVICE_ACCOUNT_JSON`: la API actual sigue utilizándolo.

## Migraciones

El esquema está en `db/migrations/0001_initial_schema.sql`. El runner comprueba el checksum de cada versión y utiliza una transacción y advisory lock para evitar aplicar simultáneamente la misma migración. No hay importación desde Sheets ni sentencias de borrado.

Comandos:
```bash
npm run db:migrate
npm run db:status
npm run db:seed
```

Las migraciones de Production están bloqueadas por defecto cuando `VERCEL_ENV=production`. No configures `ALLOW_PRODUCTION_DB_MIGRATIONS=1` en las funciones runtime; solo debería habilitarse en una ejecución administrativa controlada.

## Esquema cubierto

El modelo separa instituciones, equipos, jueces, oradores, salas físicas, rondas, presets/fases, asignaciones y sus snapshots de fases, jueces asignados, categorías, actas y puntuaciones, auditoría e idempotencia. Las restricciones SQL previenen asignaciones duplicadas por sala/ronda, repetición de equipos dentro de una ronda y referencias inválidas. Las reglas de incompatibilidades y coherencia que cruzan varias tablas aún deben residir en servicios transaccionales de dominio.

## Pasos de configuración

La integración Neon existe en la cuenta Vercel, pero el conector disponible no pudo leer la configuración del proyecto por permisos. Verifica en el dashboard que Neon está conectado a `cronometro-debate-academico` y genera/selecciona una conexión pooled para la base prevista. Añade `DATABASE_URL` a Production, Preview y Development; idealmente, Preview debe apuntar a una base separada. Vuelve a desplegar para que Vercel inyecte la variable.

No ejecutes el seed de producción hasta que se confirme que la base y proyecto son los correctos. Aunque es idempotente y no borra, crea ronda 1 y preset LEDU cuando faltan.

## Siguiente bloque obligatorio

1. Implementar repositorios PostgreSQL para toda la API.
2. Llevar validaciones, transiciones del cronómetro y activación de rondas a transacciones SQL.
3. Añadir idempotencia efectiva a operaciones críticas y eventos de auditoría en la misma transacción.
4. Migrar categorías/actas y todas las operaciones de guardado.
5. Mantener el contrato del frontend y Redis para autenticación/control.
6. Probar regresión, tipos, build e integración con Neon de test; después validar concurrencia.
7. Solo entonces retirar código y variables de Sheets y efectuar el corte deliberado a PostgreSQL.
