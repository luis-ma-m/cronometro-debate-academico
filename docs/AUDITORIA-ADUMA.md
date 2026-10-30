# Auditoría de la tabulación ADUMA — 29 de octubre de 2026

Alcance: la tabulación local (`/tabulacion`) y la página del acta para los jueces (`/acta`), en su funcionamiento, su interfaz y sus pruebas, con una pregunta central: **¿funciona sin el back (API de Vercel y base de datos Neon)?**

## Veredicto

**Sí: la tabulación y las actas por WhatsApp funcionan sin back.** Está demostrado por análisis del código y por pruebas automáticas en Chrome. Las pruebas se ejecutan contra la compilación de producción servida como simples archivos estáticos, con un vigilante que hace fallar la prueba ante cualquier petición a la API o a otro servidor: no se ha producido ninguna.

Ninguna auditoría puede garantizar el 100 %. Lo que no cubren las pruebas automáticas (móviles reales, el portátil del torneo, WhatsApp de verdad) está en [Riesgos que quedan](#riesgos-que-quedan) y se cubre con el ensayo general.

## 1. Independencia del back

| Comprobación | Resultado |
|---|---|
| Llamadas de red en el código de la tabulación y del acta (`fetch`, XHR, WebSocket, EventSource, `sendBeacon`, service worker) | Ninguna. |
| Módulos compartidos con el panel (`timer`, `scoring`, `rankings`, `incompatibilities`, `domain`) | Funciones puras, sin efectos al cargarse. |
| `App.tsx` (panel), que se carga siempre | Al importarse solo declara constantes. La API (`src/api.ts`) solo se llama desde el panel cuando se muestra, nunca en `/tabulacion` ni en `/acta`. |
| Recursos externos en `index.html` y en la hoja de estilos (fuentes, CDN, analítica) | Ninguno. |
| Pruebas E2E contra la compilación de producción servida como estáticos (`vite preview`, sin funciones de API), con el vigilante de red | 9 de 9, repetidas dos veces: 18 de 18 y **0 peticiones** a la API o a otros servidores. |
| Jornada sin conexión: crear, borrador, confirmar con ZIP, aceptar un acta por WhatsApp, siguiente ronda, clasificación y verificación del registro | Funciona con la red cortada. |

**Qué sí necesita red:**
- **Abrir la web por primera vez** en el portátil. No hay service worker: con la página abierta se trabaja sin red, pero no hay que recargarla sin conexión.
- **El móvil del juez**, para abrir el enlace y para enviar el acta por WhatsApp.
- **WhatsApp** en sí.

**Fuera del alcance:**
- **El panel de cronómetros** sí usa el back. Sus pruebas contra Neon (`tests/neon.integration.test.ts`) son las únicas que se omiten sin base de datos.
- **Publicación:** la web debe estar publicada para que los móviles abran `/acta`. Vercel ya redirige cualquier ruta a `index.html`. La publican Luis o una cuenta propia gratuita.

## 2. Requisitos y pruebas que los cubren

| Requisito | Dónde se comprueba |
|---|---|
| «Crear Torneo ADUMA», 20 equipos | `presets.test.ts`; E2E de datos dañados y de almacenamiento lleno |
| Suizo: victorias → ítems → enfrentamiento directo → faltas | `standings-aduma.test.ts`, `pairing*.test.ts` |
| Incompatibilidades objetivas (último recurso) y subjetivas | `adjudication-aduma.test.ts`; la propiedad «una objetiva nunca comparte panel» en `properties.test.ts` |
| Cambios manuales sin que nada se rompa; la mesa decide | `draft.test.ts`; propiedad de ediciones arbitrarias, válidas o no |
| «Nueva ronda» editable → «Confirmar ronda», con cada cambio registrado | `draft.test.ts`, `store-log.test.ts`, E2E ADUMA |
| Registro completo y persistente, con huellas | `log.test.ts`, `store-log.test.ts`, propiedad de registro; E2E (verificación) |
| ZIP con CSV, TXT y PDF al confirmar, y la ronda en pantalla | `exports.test.ts`; E2E ADUMA (descomprime y revisa cada ZIP) |
| Equipo caído (media de la ronda; dos caídos sin ítems) | `results-aduma.test.ts`, `standings-aduma.test.ts`, `bracket-aduma.test.ts`; E2E ADUMA |
| Notas en la hoja de ítems | E2E de WhatsApp; `whatsapp.test.ts` |
| Cuartos 1–8, 3–6, 2–7, 4–5; semis y final | `bracket-aduma.test.ts`; E2E ADUMA hasta el campeón |
| Premios de oradores | `standings-aduma.test.ts`, `sample-aduma.test.ts` |
| Actas por WhatsApp sin servidor | `whatsapp.test.ts`, `robustness.test.ts`; E2E de WhatsApp y sin conexión |
| A prueba de fallos | E2E de resiliencia (sin red, otro portátil, almacenamiento lleno), segunda pestaña, recarga y datos dañados; `robustness.test.ts` |

## 3. Fallos encontrados y corregidos durante la auditoría

1. **Página del acta.** Si estaba abierta y se abría otro enlace en la misma pestaña, seguía mostrando el debate anterior: el juez podía rellenar la sala equivocada. Ahora sigue al enlace, y cada debate conserva su propio borrador. Cubierto por la prueba E2E de UX.
2. **Guardado tras un fallo.** Después de un error de almacenamiento, «guardar ahora» no reintentaba. Ahora reintenta y el aviso tiene un botón «Reintentar el guardado». Cubierto por test unitario y E2E.
3. **Proyección a ciegas.** Mostraba a la vez «Rondas a ciegas» y un mensaje de que no había rondas. Corregido.
4. **Tabla del borrador en portátiles de 1280–1366 px.**
   - El jurado quedaba cortado y había que desplazarse.
   - Los equipos se recortaban de forma ambigua: «Complutense A» y «Complutense B» se veían iguales.

   Ahora cabe sin desplazamiento y no se recorta ningún equipo (medido a 1280, 1366 y 1920 px). Los nombres largos de jueces muestran el texto completo al pasar el ratón.
5. **Reglas.** Algunos campos crecían de altura según la ayuda del campo vecino. Corregido.

Después de la auditoría, al revisar la nueva interfaz, se corrigieron dos casos de página en blanco:
- **Fallo de la aplicación entera.** Si fallaba la estructura de la tabulación, y no solo una pantalla, la página se quedaba en blanco. Ahora una protección envuelve toda la aplicación y ofrece la copia de emergencia. Se comprobó provocando un fallo a propósito.
- **Código sin descargar.** Si se perdía la conexión justo al cargar la página, esta se quedaba en blanco. Ahora dice que no se ha podido cargar y ofrece «Recargar». Cubierto por una prueba E2E.

En la revisión del pull request se encontraron y corrigieron otros dos:
- **Tabla de oradores del acta.** Entre unos 1.600 y 1.700 px de ancho, las tablas de los dos equipos se solapaban. Ahora solo se ponen lado a lado cuando caben; el barrido E2E lo comprueba a seis anchos, de 1.280 a 2.560 px.
- **Enlaces de WhatsApp demasiado largos.** Ocupaban unos 1.250 caracteres y la aplicación del móvil los plegaba con «Leer más» sin dejar pulsarlos. Ahora ocupan unos 350–400 y van en una línea propia; el código de vuelta baja de unos 700 a unos 170. Falta comprobarlo en un móvil real.

Antes de la auditoría, las pruebas ya habían destapado y corregido estos fallos:
- el ZIP fallaba con el reloj del ordenador mal puesto;
- un juez podía quedar como principal de dos debates;
- en el móvil, el botón de envío fijo tapaba el formulario;
- los medios puntos generaban once avisos iguales.

## 4. Interfaz

- **Barrido automático** de todas las pantallas (Inicio, Reglas, cada pestaña de Participantes, borrador, pantalla de ronda, enlaces de WhatsApp, Actas, bandeja de WhatsApp, Clasificación, proyección a ciegas, Registro, Diagnóstico), con la página del acta en un móvil de 360 px y con un enlace roto:
  - sin errores ni avisos en la consola, en el modo de desarrollo de React, que es el más estricto;
  - todos los controles con nombre accesible;
  - ninguna pantalla con desplazamiento horizontal.
- **Revisión visual** a 1280, 1366, 1440 y 1920 px, y en móvil a 360 y 390 px.
- **Pendiente de criterio humano:** que los textos y el orden de los pasos resulten claros a la mesa y a los jueces. Se comprueba en el ensayo.

## 5. Pruebas

| Tipo | Cantidad |
|---|---|
| Tests unitarios (vitest) | 341 en 39 archivos, 33 de ellos de la tabulación; 7 omitidos, de Neon |
| Pruebas de propiedades (fast-check) | 3 propiedades con 60 casos por ejecución y semilla fija. En la auditoría, 4.500 casos más con otras semillas, sin contraejemplos |
| E2E en Chrome (Playwright) | 10 pruebas en 4 archivos, en desarrollo y contra la compilación de producción; repetidas sin fallos intermitentes |
| Cobertura de `src/tabulation` | 96,6 % de líneas, 87,4 % de ramas y 95,6 % de funciones. La CI exige 90 % / 80 % |
| Tipos | Typecheck de la aplicación y de la API sin errores |

- **CI:** un trabajo con cobertura, typecheck de la API y compilación, y otro con las E2E contra la compilación estática (`E2E_PREVIEW=1`).
- **Para el commit:** incluir `package-lock.json`, porque la CI usa `npm ci`.
- **Ramas sin cubrir:** las que quedan son sobre todo protecciones ante fallos de las APIs del navegador (`try/catch` del almacenamiento, de Web Locks y del portapapeles).

## Riesgos que quedan

| Riesgo | Cómo cubrirlo |
|---|---|
| Móviles reales (iPhone y Android, navegador interno de WhatsApp) y el envío real por WhatsApp | Ensayo general con móviles de verdad: abrir un enlace, rellenar, enviar y aceptar en la mesa. |
| El portátil y el Chrome del torneo: versión, extensiones, políticas que borran datos, modo incógnito | Ensayo en ese mismo equipo y con la misma dirección; no usar incógnito. |
| Que el navegador borre los datos del sitio | ZIP de cada ronda guardado en dos sitios y copia exportada tras las actas. |
| Fallo del portátil o de la luz | Portátil de reserva: importar la última copia (probado en E2E). |
| Interpretaciones del reglamento | Validación del comité de [ADUMA-INTERPRETACIONES.md](ADUMA-INTERPRETACIONES.md). |
| Publicación de la web para los móviles | Que Luis despliegue la rama, o publicarla en una cuenta propia gratuita y escribir la dirección en Reglas. |

Guía del día y respuesta a cada incidencia: [ADUMA-OPERACION.md](ADUMA-OPERACION.md).
