# Backend de Apps Script retirado

Este directorio se conserva únicamente como referencia histórica. La versión vigente de Debate Control no depende de Google Apps Script ni debe desplegarse desde este directorio. El backend operativo está en `api/index.ts`, se publica con Vercel y utiliza Neon PostgreSQL como fuente de verdad y Upstash Redis para sesiones y claves de control.

No sigas instrucciones históricas de configuración de Google Sheets para desplegar la versión actual. Consulta [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) y [docs/NEON_MIGRATION.md](../docs/NEON_MIGRATION.md).
