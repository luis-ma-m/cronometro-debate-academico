# Tabulación local de torneos de debate académico

La ruta `/tabulacion` es una herramienta de tabulación que funciona **solo en el navegador**: no inicia sesión, no llama a la API ni a Neon, y guarda los datos en el `localStorage` del propio navegador. Sirve para la fase clasificatoria (liguilla de grupos o sistema suizo), las actas (por juez o conjuntas), la clasificación, los premios de oradores y las eliminatorias.

Se abre desde el panel (enlace «Tabulación local» en la barra lateral) o directamente en `/tabulacion`. En producción Vercel ya reescribe cualquier ruta a `index.html`; `src/main.tsx` decide si monta el panel o la tabulación, que se carga como un fragmento aparte.

Para el V Torneo Nacional ADUMA hay un reglamento propio («Crear Torneo ADUMA»): ver [Torneo ADUMA](#torneo-aduma), [ADUMA-INTERPRETACIONES.md](ADUMA-INTERPRETACIONES.md) y la guía de operación [ADUMA-OPERACION.md](ADUMA-OPERACION.md).

## Flujo de uso

Arriba queda siempre a la vista el progreso del torneo: cada ronda, cuartos, semifinales y final, con las actas que faltan. La barra lateral avisa de un borrador sin confirmar y del número de actas pendientes, e Inicio muestra el siguiente paso con un botón que lleva a su pantalla.

1. **Inicio** — crear un torneo eligiendo el reglamento de partida, «Crear Torneo ADUMA», crear un torneo de ejemplo o un ensayo ADUMA (con simulación de resultados para probar), o recibir los participantes del panel. Aquí están también el nombre del operador, el **Diagnóstico** y las copias.
2. **Reglas** — formato, paneles, incompatibilidades, posturas, tipo de acta, oradores, penalizaciones y criterios de clasificación.
3. **Participantes** — equipos con sus integrantes (y la casilla «Equipo caído»), jueces (nivel 1–5, si pueden presidir, disponibilidad e incompatibilidades), incompatibilidades por nivel e instituciones, y salas. Admite pegar listas copiadas de una hoja de cálculo.
4. **Rondas** — «Nueva ronda» prepara un **borrador** con salas y jueces que se puede cambiar a mano; «Confirmar ronda» lo guarda, descarga un ZIP con la ronda y la muestra en pantalla. El borrador muestra sus errores y avisos, y la barra de «Confirmar ronda» queda fija abajo. También: sortear grupos y generar jornadas (liguilla), y eliminatorias y cuadro. En «Más acciones» están reabrir la última ronda, auditar el sorteo y enviar la ronda al panel.
5. **Actas** — por juez (LEDU, UC3M) o conjunta del jurado (ADUMA). El formulario sigue el papel en secciones numeradas, con el total de ítems en vivo y una barra fija con el estado del acta, «Guardar» y «Guardar y siguiente». El resultado se calcula en vivo; las incidencias bloquean el acta hasta corregirlas y los avisos se muestran sin bloquear. Con acta conjunta, las actas enviadas por los jueces desde el móvil se pegan en «Actas recibidas por WhatsApp» (ver [Actas por WhatsApp](#actas-por-whatsapp)).
6. **Clasificación** — por grupo o general, «tras la ronda N», resolución manual o por sorteo de empates, rankings de oradores, CSV, impresión y modo proyección (oculta las rondas a ciegas). En el suizo marca quién entra en las eliminatorias y dibuja la línea de corte (provisional mientras quedan rondas).
7. **Registro** — todo lo que ha cambiado, con fecha, operador y huella encadenada; búsqueda, verificación y exportación.

## Reglas modeladas

Los reglamentos de partida se basaron en las bases oficiales; cualquier valor se puede cambiar en Reglas.

| | LEDU 2024 (liguilla) | Torneo Nacional UC3M (suizo) |
|---|---|---|
| Fase clasificatoria | 4 grupos todos contra todos; pasan 2 por grupo (arts. 6 y 26) | 5 rondas; R1 por sorteo, después 1.º–2.º, 3.º–4.º… (arts. 25–26) |
| Posturas | Sorteo antes de cada debate (art. 14) | Fijadas por la organización en el suizo; sorteo desde cuartos (art. 13) |
| Jurado | Impar, al menos 3 con juez principal (art. 27) | Juez principal + vocales; en empate decide el principal (art. 38) |
| Acta | 0–100 enteros por juez; su voto va al equipo con más puntos; gana quien tenga más votos; nota = media, sin la más alta y la más baja si hay más de 3 jueces; eliminatorias solo votos (arts. 30–31) | Sobre 20 por juez; oradores de 1 a 5 por intervención (anexos) |
| Penalizaciones | 2 avisos = leve, 4 = 2 leves, desde el 5.º cada aviso es una leve; leve −7; 3 leves = grave; grave = derrota con todos los votos, el ganador recibe su media y el perdedor 25 (arts. 34–36) | 2 avisos = leve (−2); 2 leves = grave (−5); falta eliminatoria = derrota con 0 (arts. 31–34) |
| Desempates | Enfrentamiento directo → votos en él → puntos en él → media global → menos avisos y faltas → debate de desempate (art. 31.3) | Ítems totales → enfrentamiento directo → puntuación individual → avisos y faltas → moneda (art. 26) |
| Eliminatorias | Cuartos, semis y final | Cuartos 1v8, 2v7…; semis re-sembradas (art. 28) |

## Torneo ADUMA

Reglamento del V Torneo Nacional ADUMA (10.º aniversario). Las interpretaciones que debe validar el comité están en [ADUMA-INTERPRETACIONES.md](ADUMA-INTERPRETACIONES.md).

- **Formato:** 20 equipos, 4 rondas suizas **a ciegas** (art. 29): la clasificación no se proyecta hasta acabar la fase, y el orden de las salas y de los equipos en cada debate se baraja con la semilla para no revelar posiciones. La semilla de la R1 se puede escribir en el sorteo público.
- **Clasificación** (art. 30): victorias → ítems netos (ítems menos faltas) → enfrentamiento directo → menos faltas graves → menos faltas leves → orden fijado por el comité.
- **Acta conjunta** (art. 23): el jurado declara el ganador; los 11 ítems (0–5) de Fondo, Estructura y Forma solo desempatan. Modo rápido (ganador y totales, detalle pendiente), total escrito en el papel como comprobación, notas y una nota de 1 a 10 por integrante con las posiciones que hizo.
- **Penalizaciones** (arts. 36, 39, 40): el primer aviso no penaliza y cada aviso siguiente es una leve; con 2 o más leves, todas menos una pasan a graves. Leve −5, grave −10, descontadas de los ítems.
- **Jueces:** paneles de 3, o de 2 cuando faltan jueces (con acta conjunta son válidos). Incompatibilidad **objetiva** (misma institución, o anotada): solo como único juez de un debate que se quedaría sin juez, nunca como vocal. **Subjetiva:** se evita mientras haya alternativa.
- **Equipo caído** (desde la ronda indicada): pierde sus debates; su rival gana y recibe la media de ítems netos de la ronda (los demás debates disputados). Dos caídos: ambos pierden sin ítems. Los caídos se emparejan primero entre sí; sus debates no llevan sala ni jueces; no pueden clasificarse. Con un número impar de equipos se añade un equipo «Descanso» (caído desde la R1, invisible en la clasificación).
- **Fase final** (art. 31): cuartos 1–8, 3–6, 2–7, 4–5 con cuadro fijo; semis W(1–8)–W(3–6) y W(2–7)–W(4–5); final. Solo cuenta el ganador.
- **Oradores** (arts. 25, 43, 44): mejor orador, mejor introductor, mejor 1.er y 2.º refutador y mejor conclusor; los dos primeros del ranking general se marcan para la final de discursos.

## Algoritmos

- **Resultado de un debate** (`results.ts`, `acta.ts`, `penalties.ts`): con actas por juez, a la puntuación bruta de cada juez se le resta la deducción de faltas; el voto es para el que queda por encima, y un empate en un acta es un error. Gana la mayoría; si un panel par empata, decide el principal. Con acta conjunta gana el equipo declarado y los ítems netos son su puntuación. Una falta grave en modo LEDU o una descalificación dan la derrota. Un equipo *swing* nunca gana; un equipo caído pierde sin acta. La organización puede fijar el ganador con motivo.
- **Clasificación** (`standings.ts`): solo cuentan rondas clasificatorias con el acta completa. Primero las victorias y después los criterios configurados, de forma recursiva: cuando un criterio separa parte de un empate, los que siguen empatados se vuelven a comparar solo entre ellos. Los criterios de enfrentamiento directo solo se aplican si todos los empatados se han enfrentado. El rival de un caído recibe la media de la ronda; la de un ganador por falta grave, su propia media (LEDU). Si el empate persiste, la organización fija el orden o se sortea de forma reproducible.
- **Emparejamiento suizo** (`pairing.ts`): programación dinámica exacta sobre el orden de la clasificación, que minimiza en este orden revanchas, equipos de la misma institución (opcional), distancia al emparejamiento ideal 1.º–2.º, 3.º–4.º y, como desempate, que el mejor clasificado reciba al rival más débil (ejemplo del art. 27 UC3M). Los caídos van al final y se emparejan primero entre sí. La primera ronda usa un orden barajado con semilla.
- **Borrador de ronda** (`draft.ts`): la ronda se genera con salas y jueces, siempre con semilla, y se guarda como borrador. Cada cambio manual intercambia posiciones (un equipo o juez que ya estaba en otro debate pasa al hueco que deja), se valida en vivo (los errores bloquean la confirmación; los avisos requieren aceptarlos) y se puede deshacer. Una huella de los datos de partida avisa si algo cambia antes de confirmar. Confirmar es idempotente; la última ronda sin actas se puede reabrir. «Auditar el sorteo» («Más acciones») repite el emparejamiento con la semilla y lista las diferencias.
- **Grupos** (`groups.ts`): sorteo con semilla, tamaños equilibrados y equipos de una misma institución en grupos distintos siempre que se pueda; todos contra todos por el método del círculo.
- **Cuadro** (`bracket.ts`): orden de cabezas de serie configurable (ADUMA: 1–8, 3–6, 2–7, 4–5), siembra estándar (1v8, 4v5, 2v7, 3v6) o cruce de grupos; cuadro fijo o re-siembra. Los caídos no se clasifican; si dos caídos se enfrentan en una eliminatoria, el cuadro espera a la decisión manual.
- **Jueces** (`adjudication.ts`): algoritmo húngaro por capas (primero el principal, después los vocales) con costes por niveles (prohibido > asiento de principal vacío > objetiva como principal > vocal vacío > subjetiva > no puede presidir > ya vio al equipo > nivel). Un pase de intercambios final mueve a los jueces con conflicto a debates donde no lo tienen. Con `oddPanels` los paneles son impares (LEDU, UC3M); sin él bajan de uno en uno (25 jueces y 10 salas dan 5×3 + 5×2). Con la política `hard` nunca se sienta una incompatibilidad objetiva.

Todos los sorteos guardan su semilla, así que el resultado se puede reproducir.

## Persistencia, registro y exportación

- **Claves:** `ledu-tabulacion-index-v1`, `ledu-tabulacion-v1:<id>`, `ledu-tabulacion-backup-v1:<id>:<n>`, las páginas del registro `ledu-tabulacion-log-v1:<id>:<n>` (+ `:meta`), el operador `ledu-tabulacion-operador-v1` y, sin Web Locks, el permiso de escritura `ledu-tabulacion-writer-v1`. No se toca la clave del modo demo del panel.
- **Un solo escritor:** solo una pestaña del navegador escribe (Web Locks en HTTPS o localhost; si no, un permiso en `localStorage` que se renueva cada 2 s). Las demás quedan en solo lectura con «Tomar el control».
- **Guardado:** automático (~300 ms) con número de revisión; si otra pestaña guardó el mismo torneo, esta no sobrescribe y pregunta. `update` devuelve si se aplicó el cambio: en solo lectura o en conflicto no se aplica nada. También se guarda al cerrar la página.
- **Cuota:** si el navegador se llena, se borra **solo la copia automática más antigua** (y se anota en el registro) y se reintenta; si sigue sin caber, se avisa. Nunca se borran todas en silencio.
- **Registro** (`log.ts`, `changes.ts`): cada entrada se guarda en la misma escritura que el cambio que describe. Las acciones con nombre (generar, editar o confirmar ronda, actas, caídos, orden manual, importaciones, exportaciones, restauraciones, errores) llevan su propio mensaje; el resto de cambios se describe automáticamente y se agrupa hasta 10 s sin actividad. Después se sella con una cadena de huellas (cyrb53 sobre JSON canónico) en páginas de solo añadir, sin repetir entradas aunque falle algo a mitad. Restaurar o importar nunca rebobina el registro. Fallos de la página o del propio registro nunca impiden guardar.
- **ZIP de cada ronda** (`exports.ts`, `roundPdf.ts`, `roundZip.ts`): `publico/` con CSV, TXT y PDF (por sala en orden natural, sin resultados, con el número y la huella de la última entrada del registro) y `privado/` con la copia del torneo y el registro en JSON y CSV. Si el PDF falla, el ZIP sale con un `error-pdf.txt`.
- **Copias:** hasta 3 copias automáticas antes de confirmar o borrar rondas, importar o aplicar un reglamento. Exportar e importar `.json` (con el registro); se importan también el `copia-torneo.json` de cualquier ZIP y la «copia de emergencia» que ofrece una pantalla que falla. Importar en un navegador sin registro para ese torneo adopta el registro de la copia.
- **Límites:** los datos solo existen en ese navegador y perfil. Si se borran los datos del sitio, o Safari los elimina tras días sin uso, se pierden: hay que exportar copias. El cupo (~5 MB) se comparte con el panel; la tabulación avisa a partir de 3 MB. No hay sincronización entre dispositivos.

## Conexión con el panel

Cada lado solo lee un formato versionado del otro; ninguno lee el almacenamiento interno ajeno.

1. **Panel → tabulación:** en el panel, vista «Torneo» → «Enviar a tabulación». Se escribe `ledu-tabulacion-handoff-v1` con equipos, oradores, jueces, incompatibilidades y salas físicas, con sus mismos IDs. En la tabulación se crea un torneo con esos datos o se actualiza el actual. El panel manda en nombres, instituciones e incompatibilidades; la tabulación conserva niveles, quién preside, disponibilidad, *swing* y elegibilidad. Nunca se borra nada.
2. **Tabulación → panel:** en Rondas → «Más acciones» → «Enviar al panel de cronómetros» se escribe `ledu-tabulacion-outbox-v1`. En el panel (mismo navegador), «Rondas y salas» → elegir ronda → «Cargar desde tabulación». La carga es todo o nada:
   - reutiliza la asignación de cada sala física o la crea;
   - vacía, sin borrarlas, las salas de esa ronda que no se usan;
   - rechaza el envío si cambiaría una sala con el cronómetro iniciado o con acta;
   - valida con las mismas reglas que el guardado del panel.

   Los debates con un equipo caído no se envían. El panel no admite incompatibilidades: con la política ADUMA, los jueces que el panel rechazaría se quedan fuera del envío, con un aviso. Después hay que pulsar «Guardar cambios»: ese guardado sí usa la API.
3. El panel no guarda el orden de los jueces (la base los ordena por ID), así que el juez principal se mantiene en la tabulación y en sus impresiones. Si la postura aún no se había sorteado, llega como provisional y se corrige con «Intercambiar posturas» en la tarjeta de la sala.

Las actas de la tabulación no se vuelcan en «Puntuaciones» del panel: son dos registros independientes.

## Código y pruebas

- Motor sin React: `src/tabulation/{types,presets,random,penalties,acta,results,standings,groups,pairing,draft,bracket,adjudication,integrity,normalize,store,writerLock,log,changes,hash,exports,roundPdf,roundZip,emergency,whatsapp,csv,panelBridge,sample}.ts`.
- Interfaz: `TabulationApp.tsx` (con una protección de errores que envuelve toda la aplicación y otra por pantalla), `ErrorBoundary.tsx`, `progress.ts` y `TournamentProgress.tsx` (progreso del torneo), `useTabStore.ts` (`useSyncExternalStore`, un único almacén por página), `views/` y la página del juez `JudgeActaApp.tsx` (ruta `/acta`).
- Pruebas (`npm test`, `npm run test:coverage` con umbrales del 90 % en líneas, sentencias y funciones y del 80 % en ramas de `src/tabulation`):
  - vitest en entorno node (almacén en memoria) en `src/tabulation/*.test.ts`: ejemplo UC3M y emparejamiento contra fuerza bruta, 64 equipos sin revanchas, desempates, caídos, tabla de penalizaciones ADUMA, cuadro del art. 31, asignación con 5×3 + 5×2 y la instantánea de LEDU/UC3M, borrador y confirmación, registro (cortes a mitad, páginas dañadas, cuota, dos pestañas), ZIP y PDF;
  - propiedades con fast-check y semilla fija (`properties.test.ts`): torneos aleatorios de principio a fin, ediciones manuales arbitrarias y secuencias de guardado, recarga y restauración sin romper ninguna invariante (`PROPERTY_SEED` y `PROPERTY_RUNS` permiten búsquedas más largas);
  - Playwright (`npm run test:e2e`, carpeta `e2e/`):
    - el recorrido ADUMA completo descomprimiendo cada ZIP;
    - la recarga con un borrador, la segunda pestaña en solo lectura y datos dañados en el navegador;
    - un acta rellenada en un móvil y recibida por WhatsApp, incluido un código alterado;
    - una jornada sin conexión, la recuperación en otro portátil, el almacenamiento lleno y un aviso (no una página en blanco) si el código de la página no llega a descargarse;
    - un barrido de todas las pantallas: consola, nombres accesibles y desbordes.

    Un vigilante (`e2e/fixtures.ts`) hace fallar cualquier prueba que llame a la API o a otro servidor. Con `E2E_PREVIEW=1` se ejecutan contra la compilación de producción servida como estáticos, como hace la CI. Resultados de la auditoría: [AUDITORIA-ADUMA.md](AUDITORIA-ADUMA.md).

## Actas por WhatsApp

Con acta conjunta, el juez principal puede rellenar el acta en el móvil y mandarla a la mesa por WhatsApp. **No usa ningún servidor, ni la API ni Neon:** solo hace falta que la web esté publicada para que los móviles abran la página del acta (`/acta`, estática como la tabulación).

1. **Enlace.** En Rondas, cada ronda confirmada tiene el apartado «Actas por WhatsApp», con un botón por sala que abre WhatsApp con el enlace de su debate dirigido al móvil del juez principal (Participantes → Jueces → «Móvil»), y otro que copia todos los enlaces para el grupo de jueces. El enlace (`/acta#A2-…`) lleva dentro lo que la página no puede saber por sí misma: los nombres de los equipos, de sus integrantes y del jurado, la clave del debate y solo las reglas que difieran del reglamento ADUMA. Equipos, integrantes e ítems van por su posición, sin identificadores, y el texto solo usa letras y cifras. Así ocupa unos 350–400 caracteres y va en una línea propia, justo después de la primera, para que WhatsApp lo muestre entero y como enlace también en el móvil. Antes ocupaba unos 1.250 y la aplicación del móvil lo cortaba con «Leer más». Una suma de comprobación detecta los enlaces cortados.
2. **Acta en el móvil.** La página sigue la hoja de ítems:
   - postura e ítems, o solo los totales;
   - faltas, con el neto calculado;
   - total escrito, ganador, nota y posiciones de cada integrante, notas y firma.

   Valida con el mismo `acta.ts` que la mesa y guarda el borrador en el propio teléfono, así que se puede cerrar y volver.
3. **Envío.** «Enviar por WhatsApp» abre el chat de la mesa (Reglas → «Móvil de la mesa») con un resumen legible y un código `ACTA2-…-…` de unos 200–250 caracteres. Solo usa letras y cifras, que WhatsApp nunca convierte en cursivas, negritas ni tachados. Va firmado con la clave del debate: cyrb53 sobre el id y la semilla del torneo, que los jueces no ven, y sobre el orden de los equipos, sus integrantes y los ítems.
4. **Recepción.** En Actas → «Actas recibidas por WhatsApp» se pegan los mensajes: varios a la vez o el chat entero. Cada código se comprueba:
   - **Formato:** si está dañado o incompleto, se avisa y se pide reenviarlo.
   - **Debate:** debe ser de un debate de este torneo; si la ronda se volvió a sortear, el código no encaja con ninguno.
   - **Firma:** detecta un código alterado o de otro torneo. También rechaza un código rellenado antes de que cambiaran los equipos, los integrantes o la hoja de ítems de su debate, para que ninguna nota caiga en otra persona: en ese caso hay que reenviar el enlace.

   Después se muestra el resultado con sus incidencias y se acepta una a una (o todas las nuevas sin incidencias). Al aceptarla se conservan la decisión manual y las notas que ya hubiera; si sustituye un acta distinta, se pide confirmación. Todo queda en el registro: el envío del enlace y la recepción, con la firma del juez y la hora.
5. **Alternativa.** El papel firmado sigue siendo el acta oficial y la alternativa si no hay datos en el móvil. El «total escrito» permite cruzar ambos.

La mesa sigue leyendo los enlaces y códigos del primer formato (`A1`, `ACTA1`), así que los enviados antes del cambio siguen funcionando. Para acortar el enlace a 15–20 caracteres, sus datos tendrían que guardarse en un servidor y el móvil descargarlos de allí; eso dependería del back.

Código: `whatsapp.ts` (enlace, código, firma y lectura de mensajes) y `JudgeActaApp.tsx` (la página del móvil). En la dirección local (`localhost`) los móviles no pueden abrir el enlace: Reglas → «Dirección pública de la página del acta» permite apuntar a la web publicada.
