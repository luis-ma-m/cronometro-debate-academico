# Tabulación local de torneos de debate académico

La ruta `/tabulacion` es una herramienta de tabulación que funciona **solo en el navegador**: no inicia sesión, no llama a la API ni a Neon, y guarda los datos en el `localStorage` del propio navegador. Sirve para la fase clasificatoria (liguilla de grupos o sistema suizo), las actas por juez, la clasificación, los premios de oradores y las eliminatorias.

Se abre desde el panel (enlace «Tabulación local» en la barra lateral) o directamente en `/tabulacion`. En producción Vercel ya reescribe cualquier ruta a `index.html`; `src/main.tsx` decide si monta el panel o la tabulación, que se carga como un fragmento aparte.

## Flujo de uso

1. **Inicio** — crear un torneo eligiendo el reglamento de partida, crear un torneo de ejemplo (16 equipos, 12 jueces y 8 salas, con simulación de resultados para probar) o recibir los participantes del panel.
2. **Reglas** — ajustar formato, paneles, posturas, escala de puntuación, oradores, penalizaciones y criterios de clasificación.
3. **Participantes** — equipos con oradores, jueces (nivel 1–5, si pueden presidir, disponibilidad por ronda e incompatibilidades) y salas. Admite pegar listas copiadas de una hoja de cálculo.
4. **Rondas** — sortear grupos y generar las jornadas, o generar cada ronda suiza; asignar jueces y salas; sortear posturas; enviar la ronda al panel; imprimir. Aquí también se generan las eliminatorias y se ve el cuadro.
5. **Actas** — transcribir el acta de cada juez. El resultado se calcula en vivo y las incidencias (empate en un acta, notas fuera de escala…) bloquean el acta hasta corregirlas.
6. **Clasificación** — por grupo o general, «tras la ronda N», resolución manual o por sorteo de empates, rankings de oradores, CSV, impresión y modo proyección.

## Reglas modeladas

Los dos reglamentos de partida se basaron en las bases oficiales; cualquier valor se puede cambiar en Reglas.

| | LEDU 2024 (liguilla) | Torneo Nacional UC3M (suizo) |
|---|---|---|
| Fase clasificatoria | 4 grupos todos contra todos; pasan 2 por grupo (arts. 6 y 26) | 5 rondas; R1 por sorteo, después 1.º–2.º, 3.º–4.º… (arts. 25–26) |
| Posturas | Sorteo antes de cada debate (art. 14) | Fijadas por la organización en el suizo; sorteo desde cuartos (art. 13) |
| Jurado | Impar, al menos 3 con juez principal (art. 27) | Juez principal + vocales; en empate decide el principal (art. 38) |
| Acta | 0–100 enteros por juez; su voto va al equipo con más puntos; gana quien tenga más votos; nota = media, sin la más alta y la más baja si hay más de 3 jueces; eliminatorias solo votos (arts. 30–31) | Sobre 20 por juez; oradores de 1 a 5 por intervención (anexos) |
| Penalizaciones | 2 avisos = leve, 4 = 2 leves, desde el 5.º cada aviso es una leve; leve −7; 3 leves = grave; grave = derrota con todos los votos, el ganador recibe su media y el perdedor 25 (arts. 34–36) | 2 avisos = leve (−2); 2 leves = grave (−5); falta eliminatoria = derrota con 0 (arts. 31–34) |
| Desempates | Enfrentamiento directo → votos en él → puntos en él → media global → menos avisos y faltas → debate de desempate (art. 31.3) | Ítems totales → enfrentamiento directo → puntuación individual → avisos y faltas → moneda (art. 26) |
| Eliminatorias | Cuartos, semis y final | Cuartos 1v8, 2v7…; semis re-sembradas (art. 28) |

## Algoritmos

- **Resultado de un debate** (`results.ts`): a la puntuación bruta de cada juez se le resta la deducción de faltas del equipo; el voto es para el que queda por encima, y un empate en un acta es un error. Gana la mayoría; si un panel par empata, decide el voto del juez principal. Una falta grave en modo LEDU o una descalificación dan la derrota con todos los votos. Un equipo *swing* nunca gana. La organización puede fijar el ganador con motivo.
- **Clasificación** (`standings.ts`): solo cuentan rondas clasificatorias con el acta completa. Primero van las victorias y después los criterios configurados. Cuando un criterio separa parte de un empate, los equipos que siguen empatados se vuelven a comparar desde el primer criterio, solo entre ellos, de modo que el enfrentamiento directo se recalcula en el subgrupo. Los criterios de enfrentamiento directo solo se aplican si todos los empatados se han enfrentado entre sí. Si el empate persiste, queda compartido hasta que la organización fija el orden, o se resuelve con un sorteo reproducible.
- **Emparejamiento suizo** (`pairing.ts`): programación dinámica exacta sobre el orden de la clasificación, que minimiza en este orden revanchas, equipos de la misma institución (opcional), distancia respecto al emparejamiento ideal 1.º–2.º, 3.º–4.º y, como desempate, que el mejor clasificado reciba al rival más débil. Así reproduce el ejemplo del art. 27 UC3M: si 15.º y 16.º ya se enfrentaron, salen 13.º–16.º y 14.º–15.º. La primera ronda aplica lo mismo a un orden barajado con semilla. Exige un número par de equipos activos; un equipo *swing* completa el número.
- **Grupos** (`groups.ts`): sorteo con semilla, tamaños equilibrados y equipos de una misma institución en grupos distintos siempre que se pueda; todos contra todos por el método del círculo, con descanso en grupos impares.
- **Cuadro** (`bracket.ts`): siembra estándar (1v8, 4v5, 2v7, 3v6) o, con dos clasificados por grupo, el cruce 1.ºA–2.ºB, 1.ºC–2.ºD | 1.ºB–2.ºA, 1.ºD–2.ºC, que deja a los compañeros de grupo en mitades opuestas. Las rondas siguientes mantienen el cuadro o re-siembran (mejor contra peor).
- **Jueces** (`adjudication.ts`): algoritmo húngaro por capas (primero el juez principal, después los vocales). Nunca sienta a un juez de la misma institución o incompatible: deja el asiento vacío y avisa. Evita repetir jueces con los mismos equipos y coloca a los jueces de más nivel en los debates más importantes. Los paneles quedan siempre impares: si faltan jueces, los debates menos importantes pasan a un juez. Por defecto respeta las asignaciones manuales y solo rellena asientos vacíos.

Todos los sorteos guardan su semilla, así que el resultado se puede reproducir.

## Persistencia

- Claves `ledu-tabulacion-index-v1`, `ledu-tabulacion-v1:<id>` y `ledu-tabulacion-backup-v1:<id>:<n>`. No se toca la clave del modo demo del panel.
- Guardado automático (~300 ms) con número de revisión. Si otra pestaña guarda el mismo torneo, esta no sobrescribe: muestra un aviso para cargar la otra versión o mantener la propia. También se guarda al cerrar la página (`pagehide`).
- Hasta 3 copias automáticas antes de generar o borrar rondas, importar o aplicar un reglamento.
- Exportar e importar `.json` (los torneos de otra versión se rechazan; si hay referencias rotas se avisa sin borrar resultados). CSV de la clasificación con `;` y BOM.
- **Límites:** los datos solo existen en ese navegador y perfil. Si se borran los datos del sitio, o Safari los elimina tras días sin uso, se pierden: hay que exportar copias. El cupo (~5 MB) se comparte con el panel; la tabulación avisa a partir de 3 MB. No hay sincronización entre dispositivos: el traspaso se hace con la copia `.json`.

## Conexión con el panel

Cada lado solo lee un formato versionado del otro; ninguno lee el almacenamiento interno ajeno.

1. **Panel → tabulación:** en el panel, vista «Torneo» → «Enviar a tabulación». Se escribe `ledu-tabulacion-handoff-v1` con equipos, oradores, jueces, incompatibilidades y salas físicas, con sus mismos IDs. En la tabulación se crea un torneo con esos datos o se actualiza el actual. El panel manda en nombres, instituciones e incompatibilidades; la tabulación conserva niveles, quién preside, disponibilidad, *swing* y elegibilidad. Nunca se borra nada.
2. **Tabulación → panel:** en Rondas → «Enviar al panel» se escribe `ledu-tabulacion-outbox-v1`. En el panel (mismo navegador), «Rondas y salas» → elegir ronda → «Cargar desde tabulación». La carga es todo o nada:
   - reutiliza la asignación de cada sala física o la crea;
   - vacía, sin borrarlas, las salas de esa ronda que no se usan;
   - rechaza el envío si cambiaría una sala con el cronómetro iniciado o con acta;
   - valida con las mismas reglas que el guardado del panel.

   Después hay que pulsar «Guardar cambios»: ese guardado sí usa la API.
3. El panel no guarda el orden de los jueces (la base los ordena por ID), así que el juez principal se mantiene en la tabulación y en sus impresiones. Si la postura aún no se había sorteado, llega como provisional y se corrige con «Intercambiar posturas» en la tarjeta de la sala.

Las actas de la tabulación no se vuelcan en «Puntuaciones» del panel: son dos registros independientes.

## Código y pruebas

- Motor sin React: `src/tabulation/{types,presets,random,results,standings,groups,pairing,bracket,adjudication,normalize,store,csv,panelBridge,sample}.ts`.
- Interfaz: `TabulationApp.tsx`, `useTabStore.ts` (`useSyncExternalStore`, un único almacén por página) y `views/`.
- Pruebas con vitest en entorno node (almacén en memoria) en `src/tabulation/*.test.ts`. Entre otras:
  - el ejemplo UC3M y una comparación por fuerza bruta del emparejamiento;
  - 64 equipos en 5 rondas sin revanchas;
  - desempates recursivos y faltas LEDU;
  - cuadros fijos y re-sembrados;
  - asignación de jueces contra fuerza bruta;
  - conflictos entre pestañas y cuota del almacenamiento;
  - el puente con el panel, validado también con `validateTournamentInput` de la API.
