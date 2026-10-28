# Plan de desarrollo

Cinco fases. Cada una termina en algo que se puede abrir en el navegador y disfrutar. Cada fase tiene un **criterio de "hecho"** comprobable: no se pasa a la siguiente hasta cumplirlo.

Estado: **Fase 4 en curso**: perfiles de calidad, medidor de fps, interfaz nueva, ficha, aterrizaje, vuelo libre, warp, pantalla de carga, eclipses y tránsitos con su calendario, cometas, la ISS y el sonido ambiente hechos, y corregidos los pendientes visuales y de precisión de las fases anteriores (punto 14). Publicado en GitHub Pages. Quedan el descenso entre nubes de los gigantes y comprobar con la ventana delante los 60 fps (el medidor del HUD ya lo permite) y que nada tiemble en escala real. La **fase 5** (galaxias y cúmulos, ARQUITECTURA §14) está en curso: capa cósmica, relevo y Vía Láctea vista desde fuera (tecla `G`).

---

## Fase 0 — Cimientos ✅

- [x] Visión y decisiones (`docs/VISION.md`)
- [x] Arquitectura (`docs/ARQUITECTURA.md`)
- [x] Estructura de carpetas y stubs con interfaces
- [x] Vite + TypeScript + Three.js WebGPU compilando

**Hecho cuando:** `npm run build` pasa y `npm run dev` muestra una esfera de partículas de prueba. ✅

---

## Fase 1 — Sol, Tierra y Luna (MVP)

Objetivo: demostrar el efecto visual central con tres cuerpos.

1. [x] `core/`: Engine con bucle, `SimClock` con velocidades (tiempo real → 1 semana/s), `FloatingOrigin` y `SystemLayout`.
2. [x] `scale/`: `ScaleSystem` comprimido jerárquico (§4.3): la misma función coloca planetas, lunas y cámara respecto a su padre o cuerpo enfocado, lineal cerca del cuerpo y logarítmica lejos. El modo real ya funciona en `ScaleSystem` (`setMode('real')`), pero falta el control en la UI (fase 2).
3. [x] `astro/`: Sol, Tierra y Luna; Kepler (JPL) para la Tierra; Luna con la fórmula del *Astronomical Almanac*; rotación de la Tierra por GMST y Luna en rotación síncrona.
4. [x] `particles/`: `ParticleField`, horneado en Web Workers con texturas, Fibonacci en orden estratificado, micro-esferas sombreadas y **LOD por densidad** (adelantado de la fase 2: sin él, el rendimiento se hundía con cuerpos pequeños en pantalla).
5. [x] `bodies/`:
   - [x] `Sun`: granulación en compute, oscurecimiento del limbo y corona.
   - [x] `RockyPlanet` (Tierra): albedo, relieve exagerado, día/noche, luces de ciudades y reflejo en el agua.
   - [x] `CloudLayer` y `Atmosphere`.
   - [x] `RockyPlanet` (Luna).
6. [x] `Starfield` con 9.096 estrellas reales (Yale BSC).
7. [x] `navigation/OrbitMode` con transición entre cuerpos y selección por clic, botones y teclas (verificado con eventos reales: clic sobre un cuerpo cambia el foco, clic en el vacío no, arrastre gira y rueda hace zoom).
8. [x] `postfx`: bloom + tone mapping ACES.
9. [x] `ui/`: HUD (cuerpo, altitud, fecha, controles de tiempo, fps) y panel de debug.

**Criterios de "hecho":**
- [x] Se reconocen los continentes de la Tierra desde la órbita y las nubes se mueven (deriva de la capa con el tiempo simulado).
- [x] El lado nocturno muestra luces de ciudades y el terminador es suave.
- [x] La Tierra está iluminada correctamente para la fecha. Verificado con números: punto subsolar en lon +1,5° y lat −0,2° el 20/03/2026 a las 12:00 UTC; lat +23,44° y −23,43° en los solsticios; a las 18:00 UTC el Sol queda en lon −88,5°. Las texturas no están en espejo: África queda al este del golfo de Guinea.
- [x] El Sol "hierve" y tiene bloom.
- [ ] **60 fps con unos 2M de partículas: sin verificar.** Se midió con la app sin ventana visible (GPU a baja frecuencia) y los tiempos de GPU no son fiables. Cómo comprobarlo: abrir `http://localhost:5175/?debug` con la ventana delante, enfocar la Tierra con el disco entero en pantalla (unos 2,4 radios, el peor caso: todas las partículas dibujadas) y leer los fps del HUD.

**Cambios de aspecto tras la primera revisión (petición del usuario):**
- Las partículas se veían como discos planos y el conjunto, borroso. Ahora son micro-esferas con luz propia **separadas entre sí** (estilo nube de partículas), a ~2,6 px de separación a cualquier distancia, y la densidad de píxeles es nativa.
- Interacción: al pasar el ratón, las partículas cercanas se desordenan y vuelven con un muelle (§6.4).

**Pendientes detectados en la fase 1 (para fases siguientes):**
- ~~Anillos concéntricos en el halo de bloom del Sol.~~ Corregido en la fase 4: eran escalones de 8 bits del degradado; tramado al final del pipeline.
- ~~Las nubes se ven algo "granuladas" de cerca; turbulencia con *curl noise* en compute.~~ Corregido en la fase 4.
- Respaldo WebGL2 sin probar.
- Errores de WebGPU de "textura de tamaño 0" si la página carga con la ventana oculta (inofensivos; desaparecen al mostrarse).

---

## Fase 2 — Sistema solar completo ✅ (pendiente de medir)

0. [x] **Escala comprimida rehecha antes de añadir cuerpos** (§4.3): perfil de tres tramos (lineal, logarítmico dentro de cada sistema de lunas, potencia entre sistemas). Con el perfil anterior la Luna se salía del hueco hasta Venus y Calisto del de Saturno. El primer plano de la Tierra y la Luna no cambia.
1. [x] Los 8 planetas + Plutón y lunas principales (Luna, Ío, Europa, Ganímedes, Calisto, Titán, Tritón) y Caronte, con mapas reales de NASA/USGS (`docs/ASSETS.md`) y orientación IAU (polo y meridiano) para todos.
2. [x] `GasGiant` (Júpiter, Saturno, Urano, Neptuno) con bandas rígidas que fluyen, vórtices (Gran Mancha Roja y Gran Mancha Oscura) y achatamiento.
3. [x] `Rings` de Saturno con velocidad kepleriana, sombra del planeta sobre ellos y de ellos sobre el planeta; anillos finos de Urano.
4. [x] `AsteroidBelt` con huecos de Kirkwood, troyanos de Júpiter y cinturón de Kuiper ligero, propagados con Kepler en GPU.
5. [x] Líneas de órbita hechas de partículas, con estela detrás de cada cuerpo.
6. [x] Niveles de detalle: punto lejano, vista previa siempre en memoria y detalle completo bajo demanda con condensación al llegar; el completo se libera de la GPU al alejarse (§6.3). Pendiente: presupuesto global (hoy no hace falta).
7. [x] **Escala real** en la UI (botón y tecla `E`) con transición animada; etiquetas con el nombre de lo que mide menos de 30 px.
8. [x] Control del tiempo en la UI: pausa, de tiempo real a 1 año/s y campo de fecha.
9. [x] Viaje cinematográfico al elegir un cuerpo (en `OrbitMode.focusOn`, no en un modo aparte): sube sobre el plano a mitad de camino y llega por el lado de día.

**Hecho cuando:**
- [x] Se puede viajar a cualquier planeta desde la lista o con clic (botones, teclas 0–9, clic en el cuerpo o en su nombre).
- [x] El cambio de escala comprimida ↔ real es fluido y sin saltos: medido frame a frame desde Júpiter, el mayor salto de la cámara y de cada cuerpo (Ío, Calisto, Saturno, Tierra, Neptuno) es el 0,96 % de su recorrido total, lo que da la curva suave de 2,5 s.
- [ ] Ningún planeta "tiembla" a ninguna distancia: el origen flotante lo garantiza por diseño, pero falta mirarlo en escala real cerca de Neptuno y Plutón con la ventana delante. Las líneas de órbita (puntos en float32 relativos al Sol) se apagan cerca de cada cuerpo por si acaso.
- [x] Las posiciones coinciden con JPL Horizons (27/10/2026, vectores eclípticos J2000): planetas y Plutón < 0,08°; Luna 0,19°; galileanas ~0,1°; Caronte 0,15°; Titán < 0,4°; Tritón < 7° (luna, fuera del criterio). La orientación también (punto subsolar de 10 cuerpos, latitud ≤ 0,26° salvo Marte, 1,2°).
- [ ] 60 fps: pendiente de medir con la ventana delante, como en la fase 1. En el panel del navegador, sin estar delante, se vieron 60–100 fps en las vistas normales.

**Pendientes detectados en la fase 2:**
- ~~Los gigantes gaseosos, de cerca, siguen viéndose algo "granulados" (puntos claros sobre negro)~~ (corregido en la fase 4: bruma detrás de los puntos); el borde entre bandas se remueve con el flujo, a propósito.
- ~~Tritón tiene un error de unos 6° en su órbita~~: corregido en la fase 4 (< 0,1° de 1950 a 2100).
- Saturno no tiene textura real (no hay un mapa global de Cassini sin anillos); su color es un perfil de bandas, afinado en la fase 4 con el hexágono polar y tormentas.

---

## Fase 3 — Hasta la superficie ✅ (pendiente de medir)

1. [x] `surface/CubeSphereQuadtree` sobre un cubo equiangular, con división por separación de partícula en pantalla, histéresis, frustum y horizonte por nodo (§7.1).
2. [x] `SurfaceChunk` generado en GPU: mapa de alturas real (B-spline) + ruido fractal sobre hash entero, con la misma función en la CPU para la colisión (§7.2). Todo relativo al centro del chunk (float64 en la CPU): sin escalones ni costuras a escala de centímetros.
3. [x] Pool de chunks y generación por lotes (hasta 32 por frame); reparto en ruido azul progresivo con densidad continua por partícula (§7.3).
4. [x] Profundidad: profundidad invertida y plano cercano dinámico hasta 10⁻⁹ unidades.
5. [x] Zoom sobre la altitud sobre el suelo real, cámara solidaria con el cuerpo a ras de suelo, mirada hacia el horizonte y "mirar alrededor" con el botón derecho (§9).
6. [x] Mapas de altura de 16 bits para la Luna (LOLA) y Marte (MOLA); la Tierra, en la fase 4, con ETOPO 2022 (float16, 8k). Pendiente: carga progresiva por teselas.
7. [ ] Gigantes gaseosos: descenso entre capas de nubes → **fase 4** (la cámara se queda sobre la cima de las nubes).
8. [x] Extra: horizonte con cielo y suelo en el fondo, y estrellas solo por encima del horizonte (§7.4).

**Hecho cuando:**
- [x] Se baja de forma continua desde la órbita hasta unos 10 m del suelo de la Tierra, la Luna y Marte (y Mercurio, Europa y Titán), sin cortes: descensos automáticos de 2000 km a 10 m, con el tiempo parado y en marcha, sin posiciones no finitas, con la cámara siempre a más de 11 m del suelo dibujado y el plano cercano delante. El relevo globo ↔ superficie se hace con un fundido de 0,35 s en los dos sentidos. Al subir, la superficie se libera (321 → 183 MB) y al volver a bajar se rehace.
- [~] Sin parpadeo: en reposo no hay huecos (0 hojas visibles sin chunk, de 1024×768 a 1920×1080). Al girar 180° de golpe a 10 m aparecen hasta 15 huecos durante 3 frames, y en una bajada muy rápida hasta 20 durante 9 frames.
- [~] Se reconocen accidentes reales: el pico central y la sombra de Tycho, los cañones de Valles Marineris y la masa nevada del Himalaya. La Tierra, con un mapa de 10 km por texel, no tiene picos individuales: por debajo es ruido procedural.
- [ ] 60 fps con unos 4–6M de partículas: pendiente de medir con la ventana delante. En el panel oculto del navegador se vieron 60–70 fps a 10 m del suelo con ~3M de partículas.

**Pendientes detectados en la fase 3** (corregidos los tres en la fase 4):
- ~~Patrón de mosaico de la tesela de ruido azul en algunos ángulos y ligeros cambios de textura en los bordes de chunk (distintas octavas finas por nivel).~~
- ~~A 150 km de la Luna el suelo se ve muy contrastado (albedo LRO, puntos claros sobre huecos oscuros).~~
- ~~La perturbación con el ratón no actúa sobre los chunks.~~

---

## Fase 4 — Pulido y experiencia (en curso)

1. [x] `FreeFlyMode` 6DOF con velocidad adaptativa, anclado al cuerpo más cercano, colisión con el relieve y nivelación del horizonte (§9).
1b. [ ] Gigantes gaseosos: descenso entre capas de nubes volumétricas (aplazado de la fase 3).
2. [x] Efecto *warp* en los viajes (§10).
3. [x] Ficha completa por cuerpo con datos de NASA y JPL, distancias en vivo y botón de aterrizar en un lugar conocido (§11).
4. [x] Sonido ambiente (§13): procedural con Web Audio, sin archivos. Zumbido grave cerca de los gigantes, rugido con chasquidos junto al Sol, viento a ras de suelo donde hay atmósfera, un soplo en los viajes y silencio en el vacío. Se silencia con `M`, el botón del altavoz o los ajustes (se recuerda).
5. [x] Rendimiento: perfiles de calidad (baja/media/alta/ultra), detección del equipo, ajuste automático y medidor de fps con gráfica (§12).
6. [x] Pantalla de carga con el sistema "formándose" desde el polvo (§11).
7. [x] Despliegue estático en GitHub Pages (`.github/workflows/pages.yml`): build con la subruta del repo en cada push a `master`; las rutas de `public/` llevan `import.meta.env.BASE_URL`.
8. [x] Extra: interfaz rediseñada entera (título, tiempo, navegador de cuerpos, herramientas, ajustes, ayuda, avisos y pista de bienvenida), con atajos nuevos (`T` aterrizar, `V` vuelo, `I` ficha, `U` ocultar, `?` ayuda).
9. [x] **Eclipses y tránsitos** (§5.3): sombras con la geometría real en km sobre globos, nubes, atmósferas, gigantes y superficie (la Luna sobre la Tierra, la Tierra sobre la Luna con su luz cobriza, las galileanas sobre Júpiter y Júpiter sobre ellas, Titán, Caronte, Tritón); en la totalidad, desde el suelo, se oscurece el cielo y salen las estrellas. Para que cuadren: la Luna pasa a ELP-2000/82 (Meeus 47), ΔT, el polo y el giro de la Tierra con la precesión, el baricentro Tierra-Luna y el tiempo de luz.
10. [x] **Calendario de eventos** (`C`): próximos o anteriores eclipses de Sol y de Luna, sombras en Júpiter y perihelios de los cometas, con «Ir» y, en los eclipses centrales, «Desde el suelo».
11. [x] **Cometas** (§5.2, §8): ocho (Halley, Encke, 67P, Hale-Bopp, NEOWISE, Tsuchinshan-ATLAS, 3I/ATLAS y Bok) con coma, cola de polvo curvada (síndinas) y cola de iones, que crecen al acercarse al Sol; sus órbitas y su grupo en el navegador.
12. [x] **ISS** (§5.1, §8): SGP4 con el TLE del día, modelo de partículas a escala con las alas siguiendo al Sol, actitud de vuelo y la sombra de la Tierra.
13. [x] La perturbación del ratón ya no infla los cuerpos lejanos (§6.4).
14. [x] **Pendientes acumulados**, visuales y de precisión:
    - Sol: el halo ya no tiene anillos (eran escalones de 8 bits: tramado al final del pipeline; el ancho medio de cada escalón en el halo bajó de 6,4 a 2,6 px) y tiene **protuberancias** (arcos magnéticos con plasma que fluye, en el vertex shader).
    - Nubes: turbulencia con *curl noise* en compute y, de cerca, vellones suaves en vez de bolas.
    - Gigantes: una **bruma** de partículas grandes y tenues detrás de los puntos tapa el negro entre ellos sin juntarlos. Saturno, con más bandas, el **hexágono** del polo norte y tormentas blancas; Neptuno, con la Gran Mancha Oscura teñida y sus nubes compañeras.
    - Superficie: cada chunk gira o refleja la tesela de ruido azul (sin mosaico); la última octava fina se funde con la densidad dibujada (sin cambio de textura entre niveles); el **ratón** mueve las partículas del suelo (solo los chunks bajo el cursor, en 32 huecos que se reutilizan); a 150 km de la Luna el suelo ya no es sal y pimienta (huecos con un tono que sube con la altitud).
    - Rocosos: desde el lado de noche se veían el Sol y la Luna a través del planeta (entre los puntos negros). Ahora los tapa una esfera que solo escribe profundidad.
    - **Tritón**: posición desde su orientación IAU con los términos periódicos (también los de Neptuno): de < 7° a < 0,1° frente a JPL Horizons entre 1950 y 2100.
    - **Cometas**: Halley, Encke y 67P con los elementos de cada aparición entre 1900 y 2100 (3, 61 y 28), generados desde Horizons; la órbita dibujada cambia con la aparición.
    - **Relieve de la Tierra**: ETOPO 2022 en float16, 8192×4096 (5 km por texel; antes 8 bits y 10 km), con la escala del globo: el relevo no salta (25 m de media).
    - Interfaz: con el navegador de cuerpos y la barra de herramientas en una fila hacen falta ~1.600 px; entre 1.240 y 1.640 la barra se salía por la derecha. El corte pasa a 1.640 px.

**Hecho cuando:** una persona que no conoce el proyecto lo abre, explora sin instrucciones y aterriza en Marte.
- [~] El camino existe sin instrucciones: la pista de bienvenida explica arrastrar, rueda y clic; Marte está en el navegador de abajo; el botón **Aterrizar** del título baja a Valles Marineris, de día (verificado: 5 km sobre el suelo, superficie completa, 0 huecos, cañón y cielo de polvo a la vista). Falta probarlo con alguien de verdad.

**Verificaciones de la fase 4:**
- Vuelo libre: de 14.000 km a 8 m sobre la Tierra manteniendo W (12 s, sin posiciones no finitas, plano cercano siempre delante); la colisión mantiene los 8 m con turbo contra el suelo; salir con Esc deja la órbita a 10 m en el marco del cuerpo. Anclado a la Luna, ida y vuelta a la escala real sin moverse (5.729 km del centro en todo momento).
- Aterrizaje en Marte con el reloj adelantado 10 h hasta la mañana de Valles Marineris.

- Superficie a 10 m tras el arreglo del horizonte (1024×768, calidad alta, panel del navegador visible): 0 huecos en reposo en la Tierra (367 chunks), la Luna (321) y Marte (415). Con un giro de 180° suavizado, hasta 100–136 huecos durante 3–5 frames; con el cálculo del horizonte de la fase 3 sale lo mismo en la Tierra (105 durante 4), así que la diferencia con las cifras de la fase 3 es del método (giro y ventana distintos), no una regresión.
- La interfaz no cuesta fps: 22,7 con paneles de cristal, 22,0 sin desenfoque y 22,0 sin interfaz (a 10 m, 2,8M partículas, en el panel emulado); el bucle de la CPU tarda 0,7 ms por frame.

- Eclipses de Sol de 2026–2028 contra el catálogo de la NASA: lugar del máximo a 3–23 km (57 km en el rasante de la Antártida del 17/02/2026) y hora a menos de un minuto. Luna frente a JPL Horizons: 1–5″. ISS frente a wheretheiss.at: misma longitud y latitud dentro de la diferencia geodésica (0,18°). Cometas en su perihelio frente a Horizons: < 2.000 km.
- Visto en el navegador: la sombra de la Luna sobre Egipto el 02/08/2027 (también tras añadir el tiempo de luz), la sombra de Ío sobre Júpiter el 28/10/2026 a las 16:00 justo donde la da la CPU, la Luna cobriza el 03/03/2026, la totalidad desde el suelo (cielo negro y estrellas), la ISS con la Tierra detrás y su órbita, NEOWISE con sus dos colas en julio de 2020, las órbitas de los cometas desde el sistema entero, su grupo en el navegador y el calendario. El ratón ya no deforma Júpiter a 28 px y sigue apartando partículas a 335 px. Las últimas comprobaciones se hicieron con el panel del navegador oculto, avanzando frames a mano: el tiempo de carga sin la ventana delante no se ha medido.

**Verificaciones de los pendientes acumulados** (con el panel del navegador oculto y frames avanzados a mano):
- Tritón frente a Horizons: 38 fechas de 1950 a 2100, error máximo 0,10°.
- Cometas frente a Horizons, en fechas lejos de los perihelios conocidos: Encke y 67P < 0,02° vistos desde el Sol salvo junto a sus encuentros con Júpiter (67P, 0,48° en 1959 y 0,35° en 2031); Halley < 0,6° a 20–35 UA y 0,002° en julio de 2061.
- Relieve: mapa nuevo y mapa del globo con la misma escala (1 = 6.396 m, ajustada con los dos y comprobada en el Himalaya); diferencia en tierra en la escala dibujada a ras de suelo: 25 m de media y 285 m RMS (picos más finos). Accidentes en su sitio (Everest, Mont Blanc, Kilimanjaro, Aconcagua, Denali, a < 0,25°). Aterrizaje en el Himalaya: superficie completa, 0 huecos.
- Ratón en el suelo a 50 m: 6.135 partículas desplazadas hasta 4,2 m con un radio de 14 m; en un barrido de 30 posiciones, todos los chunks bajo el cursor con hueco (con reutilización en 13 frames) y sin NaN.
- Lado de noche de la Tierra a 0,12 radios con el Sol detrás: sin la esfera de profundidad se ven el Sol y la Luna a través del planeta; con ella, negro.
- Superficie tras el empaquetado nuevo: normales con y sin la última octava hacia fuera en el 100 % (producto medio con la vertical 0,998); agua y luces nocturnas decodificadas como enteros (Lisboa: 52 % agua).
- Luna a 150 km: huecos de luminancia 54 → 92 con los puntos en 140–165.
- Sonido: el zumbido llega a 0,49 (de 0,5) a 0,4 radios de Júpiter; `M` lo baja, suspende el contexto y guarda la preferencia.

**Pendientes detectados en la fase 4:**
- **Rendimiento a ras de suelo, sin medir de verdad:** en el panel del navegador (emulando 1024×768 a 2×) salieron 22 fps a 10 m del suelo, y con calidad media o baja apenas sube (28–30, ¿tope del panel?). Hay que leerlo en el medidor con la ventana delante; si se confirma, el cuello está en los vértices (2,5M sprites × 4) y no en el relleno: el perfil bajo debería recortar partículas de la superficie, no solo resolución.
- El warp se ha visto solo en capturas pequeñas: falta mirarlo a pantalla completa (intensidad de las estelas).
- La interfaz en móvil está maquetada pero sin probar en un teléfono (táctil; el vuelo libre necesita teclado).
- Desde el suelo, en la escala comprimida, la Luna no tapa exactamente al Sol (paralaje deformada): la sombra es la real, el disco solo cuadra en escala real.
- Junto a la ISS los puntos de la Tierra se ven gruesos (es el globo, unos 20 km entre partículas): no hay superficie si el foco no es la Tierra.
- Cometas: la coma y las colas son un modelo artístico con la actividad de JPL; los cometas débiles (Encke) apenas tienen cola. ~~Lejos de las apariciones con elementos propios el perihelio se desvía días~~ (corregido: todas las apariciones de 1900 a 2100). Fuera de ese intervalo, dos cuerpos desde la más cercana.
- El sonido no se ha escuchado: está medido (niveles y estados), pero falta oírlo con altavoces y ajustar volúmenes y timbres de oído.
- La bruma de los gigantes deja aún algún hueco oscuro muy de cerca (a menos de 0,4 radios de Júpiter).
- Coste sin medir con la ventana delante: la bruma de los gigantes (dibujo translúcido encima del planeta), la turbulencia de las nubes (320k partículas por frame con la Tierra a más de 150 px) y los 32 huecos del ratón en el suelo (205k partículas mientras se mueven).
- El relieve de la Tierra son 17,5 MB que se descargan al enfocarla (también al arrancar, que empieza en la Tierra) y ocupa 64 MB en la GPU y 64 MB en la CPU (antes, 32 + 32).
- Sin mirar a ojo: el antes y el después del mosaico y de los bordes entre niveles de la superficie (el arreglo es por construcción), y la órbita de un cometa justo al cambiar de aparición.

---

## Fase 5 — Más allá del sistema solar (en curso)

Objetivo: alejarse sin cortes desde el sistema solar hasta ver la Vía Láctea entera con un «Estás aquí», el Grupo Local y los cúmulos de galaxias. A las otras galaxias se va a mirarlas (órbita a su alrededor), no a entrar en ellas. Diseño en ARQUITECTURA §14.

Antes de empezar: cerrar la medición de los 60 fps de la fase 4, porque la capa cósmica añade carga.

0. [x] **Capa cósmica** (§14.2): verdad en km float64 como el resto, `ScaleSystem.cosmic` (km → años luz, solo para la GPU), cámara cósmica = desplazamiento verdadero de la cámara respecto al Sol (`OrbitMode.cameraKm`), partículas proyectadas sobre una cáscara de 5·10⁹ como `Starfield`, con tamaño y brillo según la distancia real (entre 1,4 y 7 px, conservando la luz) y desvanecido cercano. Regla nueva en `CLAUDE.md`.
1. [x] **Marco galáctico** en `astro/frames.ts` (§14.3): galáctico ↔ ecuatorial J2000 con la matriz de Hipparcos, y de ahí a la eclíptica y la escena como las estrellas. El Sol en la galaxia, en `astro/galaxy.ts`.
2. [ ] **Vía Láctea desde dentro** (lo que §8 tenía pendiente para la fase 4): panorama del cielo sin las estrellas puntuales, muestreado por densidad, con las mismas máscaras que las estrellas (horizonte, día y totalidad).
3. [~] **Relevo sistema solar ↔ cosmos** (§14.4) por la distancia en km reales de la cámara al Sol, entre 1.000 y 10.000 UA: la escena solar se funde y queda el Sol como una estrella más. Zoom más allá de las 200 UA con el Sol enfocado. Hecho, salvo las estrellas: las de Yale (en el infinito) se apagan provisionalmente entre 0,15 y 1,5 años luz; falta pasarlas a 3D con distancias (HYG).
4. [~] **Vía Láctea desde fuera**: modelo procedural generado en un worker con parámetros publicados (disco, bulbo, barra, brazos ajustados a Reid et al. 2019 con el brazo de Orión, polvo y regiones HII), con «Sol · estás aquí» y «Centro galáctico». Falta: cúmulos globulares reales (Harris), Nubes de Magallanes, nombres de los brazos y el fundido con el panorama.
5. [~] **Grupo Local y galaxias conocidas**: tabla curada de 13 galaxias (`astro/galaxies.ts`) con su posición, distancia, tamaño, inclinación y ángulo de posición: Andrómeda con M32 y M110, Triángulo, las dos Nubes de Magallanes, M81 con M82, Centaurus A, Remolino, Molinete, Sombrero y M87. Cada una con una plantilla de partículas por tipo (espiral, elíptica, irregular, lenticular) y todas enfocables. Datos comprobados el 28/10/2026 contra SIMBAD y NED, con la fuente de cada uno en la ficha (§14.4). Falta el resto del Grupo Local (McConnachie 2012).
6. [ ] **Cúmulos y red cósmica**: 2MRS o Cosmicflows-4, un punto por galaxia e impostores para las que más miden en pantalla, con los «dedos de Dios» corregidos; nombres de Virgo, Coma, el Gran Atractor, el Vacío Local y Laniakea.
7. [~] **Navegación e interfaz** (§14.5): hechos la tecla `G` (zoom logarítmico hasta la galaxia entera y de vuelta), el «arriba» hacia el norte galáctico, el pivote de la órbita del Sol al centro galáctico sin saltos, la vuelta al sistema solar antes de cualquier viaje a un cuerpo, las distancias en años luz y sin vuelo libre fuera del sistema solar. Y la interfaz de las galaxias, como la de los planetas: «Galaxias» al final del navegador; en el cosmos, la fila pasa a las galaxias (con «Sistema solar» para volver) y encima van sus satélites, como las lunas. Viaje entre galaxias con warp, título y ficha de cada una, nombres pulsables en el cielo, reloj oculto y exposición que se adapta a la galaxia. Falta la barra de escala.

**Hecho cuando:**
- [ ] Se va de la superficie de la Tierra a fuera de la Vía Láctea y de vuelta sin saltos ni cortes (medido frame a frame, como el cambio de escala de la fase 2), en la escala comprimida y en la real.
- [ ] Desde el suelo, la banda pasa por donde debe: el centro galáctico entre Escorpio y Sagitario (AR 17h46m, Dec −29°), la Gran Nube de Magallanes en Dorado (AR 5h24m, Dec −69°45′), y el panorama no está en espejo.
- [ ] Desde fuera, el Sol está a 8,2 kpc del centro, en el brazo de Orión y ~21 pc sobre el plano, y la dirección al centro desde él coincide con la del panorama.
- [x] Andrómeda en AR 0h42m44s, Dec +41°16′, a ~2,5 millones de años luz, con su inclinación (77°) y su ángulo de posición (35° en SIMBAD/HyperLEDA; el valor clásico es 38°); M87 en el centro de Virgo, a ~54 millones. Verificado desde el Sol, en las 13: cada galaxia cae en su AR/Dec (error ~10⁻¹⁴°) y su eje mayor y su proporción de ejes salen los de la tabla (Andrómeda, 35,0° y 0,225 = cos 77°).
- [ ] 60 fps con la galaxia llenando la pantalla, medido con la ventana delante.

**Verificaciones de la fase 5** (panel del navegador emulando 1280×800, calidad alta; los fps de ahí no son fiables):
- Matriz galáctica (script aparte): ortonormal, el centro en AR 266,405°, Dec −28,936° y el polo norte en AR 192,860°, Dec +27,128°, como la IAU; plano galáctico a 60,2° de la eclíptica.
- Relevo, frame a frame con `G` desde la Tierra: la dirección al Sol de la capa cósmica y la de la escena solar coinciden de 1 a 10.000 UA (0,0000° en la escala comprimida y 0,0000015° en la real); la presencia del sistema solar baja de 1 a 0 entre 1.000 y 10.000 UA.
- Vuelta desde 120.000 años luz, sin posiciones no finitas: a la Tierra (zoom hasta 600 UA y viaje), al Halley de 2061 con «Ir» (el mayor encogimiento por frame, un 7 %) y al eclipse de Sol de 2027 «desde el suelo» (aterriza a 10 km).
- Vuelo libre empujado a 5·10¹³ km: se queda en 1.000 UA y al salir la órbita sigue en el Sol a esa distancia.
- Visto: la galaxia de cara con la barra, los brazos, el polvo y las regiones HII; de canto, el disco fino con el bulbo; a 15.000 años luz, sobrevolando los brazos; a 3 años luz del Sol, un campo de puntos con la banda de la galaxia; a 2.650 UA, el sistema solar encogiéndose y fundiéndose. 96 fps con la galaxia entera y 57 sobrevolándola, en el panel.

**Pendientes detectados en la fase 5:**
- Desde dentro (de 1,5 a unos miles de años luz del Sol) el cielo es el propio modelo como puntos, no el cielo real: lo arreglan el panorama (paso 2) y las estrellas con distancia (paso 3).
- De canto, el polvo se ve como elipses (los brazos casi de perfil) más que como una franja oscura continua.
- Los brazos son un modelo de cuatro espirales simétricas: fuera del lado del Sol (lo que no se ha medido) son una extrapolación.
- Datos de las galaxias comprobados (ver abajo), con estas reservas: la inclinación y el ángulo de posición del Molinete están mal determinados (está casi de frente), la franja de polvo de Centaurus A está alabeada (~120° y ~75° son aproximados), la Pequeña Nube no tiene un disco claro (su inclinación sale de la proporción de ejes) y la velocidad de M81 no se pone (SIMBAD da −47 ± 21 km/s, sin una medida precisa a mano). Su forma es una plantilla por tipo (al Remolino le falta su compañera NGC 5195).
- Donde dos galaxias se solapan en pantalla (Andrómeda y M32, M81 y M82), el polvo de la de detrás oscurece también las estrellas de la de delante.
- Desde dentro del sistema solar no se ven Andrómeda ni las Nubes de Magallanes en el cielo: llegarán con el panorama (paso 2).

**Verificaciones de las galaxias** (mismo panel):
- Datos, el 28/10/2026: posición, velocidad del Grupo Local (McConnachie 2012) y ángulo de posición (HyperLEDA) de SIMBAD; distancia, diámetro D25 (RC3), tipo y velocidad de NED a través de las fichas de Wikipedia, que citan el catálogo o el artículo; inclinaciones de estudios cinemáticos (Heyer 2004, Colombo 2014, de Blok 2008…). Corregido respecto a la primera versión: la posición de la Pequeña Nube (0,03°), la distancia del Triángulo (2,73 → 2,88 millones de años luz) y su inclinación (55 → 54°), la inclinación (30 → 35°) y el ángulo (160 → 170°) de la Gran Nube, el ángulo del Remolino (163 → 173°), los diámetros del Sombrero (50.000 → 94.900), Centaurus A (60.000 → 123.100), M87 (120.000 → 132.000), M81 (90.000 → 96.000), M82 (37.000 → 40.800) y M32 (6.500 → 8.000 años luz), las velocidades de M82 (203 → 269 km/s) y M110 (−241 → −246) y la del Remolino (460, de su corrimiento al rojo), el número de estrellas de la Gran Nube (30.000 → 20.000 millones) y de la Vía Láctea (diámetro 87.400 años luz, D25). Se quitan los números de estrellas sin fuente (M32, M110, M81, M82, Centaurus A, Remolino, Sombrero).
- Textos: el choque con Andrómeda ya no se da por hecho (≈ 50 % en 10.000 millones de años según Sawala et al. 2025 y ≈ 90 % según Wu, Zhang et al. 2026); M32 como resto de una espiral fusionada (D’Souza y Bell 2018); los chorros de Centaurus A, de más de un millón de años luz; SN 2011fe, la supernova más brillante de 2011; el Sombrero, con 1.200–2.000 cúmulos globulares; M87, con 12.000–15.000 y un chorro de ~4.900 años luz; la Corriente de Magallanes, de más de 140° (Nidever et al. 2010); y el año galáctico, «algo más de 200 millones de años».
- Recorrido frame a frame Vía Láctea → Andrómeda → M32 → M87 → Vía Láctea: sin posiciones no finitas, el mayor paso por frame en los viajes entre galaxias entre el 2 y el 7 % de la distancia, y título, tipo y satélites del navegador cambiando en cada paso; el acento, también (azul en el Triángulo, dorado en M87).
- Llegada (al Triángulo y de vuelta a la Vía Láctea): en el frame de llegada la cámara no gira ni se desplaza (0°, 0) y durante el viaje gira como mucho ~1° por frame. Tras volver a la Vía Láctea, la rueda baja sin saltos de posición hasta la órbita del Sol (355 UA, marco de la escena, título «Sol»): el mismo estado que deja `G`. Con golpes de rueda muy grandes (×6 cada uno, más que un ratón normal) el «arriba» gira hasta 14° por frame al cruzar los 300–5.000 años luz.
- Barra inferior: con «Galaxias» en la fila, a 1.645 px las herramientas se salían ~10 px por la derecha; el corte a una fila pasa a 1.700 px (a 1.705, 22 px de margen). En el móvil (375 px), las dos filas se desplazan en horizontal sin desbordar la página.
- Nombres de los cuerpos: con la profundidad invertida, la z proyectada no dice si algo está detrás de la cámara y a veces salía el nombre de un cuerpo de detrás (1 de cada 8–11 en 3 de 5 vistas probadas). Ahora se mira en el espacio de la cámara: 0 en las 5.
- Desde las galaxias: la Tierra con su tecla y aterrizando, «Ir» al Halley de 2061 desde el Sombrero, el eclipse de 2027 «desde el suelo» (aterriza a 10 km) y del suelo de la Tierra al Sombrero.
- Partículas: 2,3 millones en total en la capa cósmica (la Vía Láctea, 760.000), ~71 MB en la GPU, generadas en el worker en 1–3 s (la Vía Láctea, ~1 s).
- Visto: Andrómeda con su anillo y sus satélites, el Sombrero de canto con su franja de polvo, M87, la Gran Nube con su barra descentrada y el Molinete de cara, con la ficha abierta.

---

## Fase 6 — Constelaciones (en curso)

Objetivo: ver las 88 constelaciones de la IAU sobre el cielo real, desde la órbita y desde el suelo, saber qué es cada una y en cuál está cada planeta esta noche. Diseño en ARQUITECTURA §15.

Hecho en la rama `constelaciones` y fusionado con las galaxias de la fase 5 (un solo conflicto, en `Hud`).

0. [x] **Datos** (`scripts/build-constellations.mjs` → `public/data/constellations.json`, se carga como `stars.bin`): figuras de la IAU (d3-celestial: 89 trazos, la Serpiente partida en dos), límites oficiales (Delporte 1930, VI/49 en J2000), nombres en español con su posición y rango, nombres propios de las ~100 estrellas más brillantes y la tabla de Roman (1987). Por constelación, calculados en el script: área, estrella más brillante y número de estrellas a simple vista (Yale).
1. [x] **Precesión** IAU 1976 (J2000 ↔ B1875) en `astro/frames.ts` y `constellationAt(dirección)` con la tabla de Roman en `astro/constellations.ts`, junto con lo escrito a mano: qué representa cada una y si es del zodiaco.
2. [x] **Figuras** (`bodies/Constellations.ts`): líneas de puntos sobre la esfera celeste, como `Starfield`, con un hueco junto a cada estrella y por debajo del umbral del bloom. Se trazan desde las estrellas al activarlas y se apagan con las mismas máscaras que las estrellas: horizonte, día, totalidad y relevo hacia el cosmos.
3. [x] **Límites**: puntos más tenues y espaciados, con los bordes de la IAU (paralelos y meridianos de B1875, curvos en J2000).
4. [x] **Nombres** (`ui/ConstellationLabels.ts`): en español y en versalitas, los grandes primero y sin solaparse, ocultos bajo el horizonte; pulsables. Opcional: nombres de las estrellas brillantes (Sirio, Betelgeuse, Vega…).
5. [x] **Resaltado**: con el ratón sobre el cielo, la constelación que hay debajo se ilumina (figura, límite y nombre); con un clic se selecciona y abre su ficha.
6. [x] **Ficha de la constelación**: nombre, nombre latino y genitivo, abreviatura, qué representa, área y puesto por tamaño, estrella más brillante, estrellas a simple vista, desde qué latitudes se ve entera, el mejor mes para verla (cuando culmina a medianoche) y si es del zodiaco.
7. [x] **Encuadrar una constelación** al elegirla (clic en el cielo, en su nombre o en el menú): la figura queda centrada en el hueco que deja el panel, con zoom hasta que lo llena (de 20° a 80°). En órbita la cámara se queda y gira la mirada al cielo con el norte celeste arriba; a ras de suelo gira el rumbo si está sobre el horizonte y, si no, lo avisa. Se suelta al mover la cámara o cerrar la ficha. La elegida se vuelve a trazar, sus estrellas llevan halo y nombre (o letra de Bayer) y el resto del cielo se atenúa. Para eso, desde el suelo la mirada sube ahora hasta ~68° sobre el horizonte (antes se quedaba justo por debajo).
8. [x] **Menú de constelaciones** («Constelaciones» al final del navegador de cuerpos): fichas para encender cada capa, buscador, filtros (todas, zodiaco, norte, sur y, a ras de suelo, las que están sobre el horizonte) y las 88 en tarjetas con el dibujo de su figura; la ficha, con la figura grande y los nombres de sus estrellas, y anterior y siguiente.
9. [x] **¿En qué constelación está?**: en la ficha de cada cuerpo, «Desde la Tierra: en Leo», con la dirección en km verdaderos desde la Tierra (no en escena: la escala comprimida tuerce las direcciones). El Sol, en la constelación del zodiaco del día.
10. [x] **Eclíptica y ecuador celeste** como líneas de puntos opcionales (el camino del Sol y los planetas por el zodiaco).
11. [x] **Interfaz**: botón en las herramientas (abre el panel), `K` figuras y `B` límites (también en los ajustes), todo guardado en `localStorage`, la ayuda y un clic en el cielo vacío abre la ficha. Las figuras salen encendidas la primera vez.

**Hecho cuando:**
- [x] Cada vértice de las figuras cae a ≤ 0,05° de una estrella de Yale (sin espejos ni saltos en ±180°): el más lejano, a 0,0025° (Centauro).
- [x] `constellationAt` acierta con Betelgeuse (Orión), la Polar (Osa Menor), Sirio (Can Mayor), Antares (Escorpio), el centro galáctico (Sagitario) y la Gran Nube de Magallanes (Dorado), y las 89 posiciones de nombre caen dentro de su límite.
- [x] Las áreas de los límites coinciden con las de la IAU: Hidra 1.302,85 grados² (1.302,84), Cruz 68,45 (68,45), Osa Mayor 1.279,65 (1.279,66); en total, 41.252,96.
- [x] La constelación de cada cuerpo coincide con la de JPL Horizons (cantidad 29, desde el geocentro): los diez del 28/10/2026 (el Sol y Venus en Virgo, la Luna y Urano en Tauro, Mercurio en Libra, Marte en Cáncer, Júpiter en Leo, Saturno en la Ballena, Neptuno en Piscis y Plutón en Capricornio) y el Sol, Marte, Júpiter y Saturno el 28/07/2061.
- [~] Visto en el navegador: Orión desde el suelo, nada bajo el horizonte, las figuras apagadas de día y desaparecidas lejos del Sol. Falta la Cruz del Sur desde el hemisferio sur y mirarlo todo con la ventana delante.

**Verificaciones de la fase 6** (panel del navegador oculto, 1024×768, calidad alta, frames avanzados a mano):
- Datos: 150 trazos, 257 bordes y 100 estrellas con nombre (124 KB). 1.152 tramos de borde siguen paralelos de B1875 y se densifican; el casquete de la Osa Menor venía con puntos interpolados en J2000 hasta 0,45° por debajo de los +88° de B1875 y se devuelven al paralelo. La eclíptica cruza 13 constelaciones (Ofiuco, de λ 247,6° a 266,2°).
- Partículas: 41.124 en las figuras (sin resaltar se dibuja una de cada dos), 14.420 en los límites, 1.600 en las guías y 767 halos para las estrellas de las figuras; solo se dibujan las capas encendidas.
- Encuadre (1024×768, la ficha abierta a la derecha): el centro de la figura cae en el centro del hueco libre a 0–2 px en la Cruz del Sur (zoom a 20°), la Osa Mayor (80°) y Orión (66°) desde la órbita, y Orión y Tauro desde Madrid. Junto a los polos (Dragón, Osa Menor, Dorado, Mesa y Octante, encadenados) a 0–1 px salvo el Dragón (12, con el campo de visión en su tope de 80°): la primera versión, que pedía el norte arriba en la propia mirada, no convergía junto al polo (el Octante, a 400 px) y el «arriba» daba un salto de 82° en un frame en el Dragón; ahora, cuaternión finito en todos los frames y sin saltos. Desde Madrid con el reloj a 10 min/s, Orión sigue encuadrada (a 3 px) durante 75 minutos simulados. Tarjetas del menú: al pasar el ratón se ilumina en el cielo y con un clic se encuadra (Escorpio, a 0 px) con su ficha. En el móvil (375 px), con la ficha abajo, Orión centrada en el hueco de encima. Al arrastrar se suelta y el campo de visión vuelve a 50°. Con el norte arriba, Orión tiene su orientación real (Betelgeuse al este de Bellatrix, Rigel al suroeste). Desde Madrid el 15/12/2026 a medianoche, Orión a 55,5° de altura (culmina a 54,6°) y la cámara apuntando a su centro con un error de 0,00002°; las líneas acaban en el horizonte. A mediodía, el brillo baja a 0,05 y los nombres se ocultan.
- Ficha de Orión: 594,1 grados² (26.ª de 88), Rigel (β Ori, 0,12), 128 estrellas a simple vista, entera entre 67° S y 79° N, mejor en diciembre. Ficha de Marte: «Visto desde la Tierra: en Cáncer». En la de una galaxia, la suya: las 13 donde deben (Andrómeda con M32 y M110, Triángulo, Dorado, Tucán, Osa Mayor para M81, M82 y M101, Centauro, Perros de Caza, Virgo para el Sombrero y M87).
- Ratón (simulado): sobre Orión resalta Orión; sobre la Tierra, nada.
- Con `G` hasta 120.000 años luz: a 5 años luz ya no se dibuja nada (ni nombres) y de vuelta a 600 UA reaparece todo.
- Barra inferior: con «Galaxias» y «Constelaciones» en el navegador (el botón de las herramientas se quita), el corte a una fila pasa de 1.700 a 1.800 px (a 1.745 se salía 25 px; a 1.805, 22 px de margen y 16 entre el navegador y las herramientas). En el móvil (375 px) la fila de herramientas se desplaza en horizontal sin desbordar la página.

**Pendientes detectados en la fase 6:**
- Arrastrar con el ratón de verdad para soltar el encuadre (probado subiendo el contador de interacciones).
- De día, encuadrar una constelación hace zoom a un cielo azul sin estrellas: podría avisarlo.
- Mirar las figuras a pantalla completa con la ventana delante: brillo de las líneas (0,32 sin resaltar) y separación de los puntos, y si los nombres de las constelaciones de rango 3 sobran.
- El ratón y el clic sobre el cielo solo se han probado llamando a las funciones; falta con el ratón de verdad (y que el clic en el vacío no moleste a quien hace clic para nada).

**Fuera de esta fase:** ilustraciones mitológicas (licencias y alinearlas con las estrellas), constelaciones que se deforman al alejarse (necesitan las estrellas en 3D con HYG, fase 5 paso 3), otras culturas del cielo (china, nórdica…) y sonido propio.

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| WebGPU no disponible en el navegador del usuario | `WebGPURenderer` cae a WebGL2 solo; presupuesto de partículas reducido. |
| Heightmaps de 16k muy pesados (cientos de MB) | Teselar en *tiles* y cargar bajo demanda; ruido procedural por debajo de la resolución. |
| Parpadeo de chunks en el quadtree | Histéresis + fundido cruzado entre niveles. |
| Partículas que se ven "huecas" muy de cerca | La densidad del chunk crece con el zoom; tamaño de partícula mínimo en píxeles para que se solapen. |
| Cambios de API en Three.js (TSL evoluciona rápido) | Versión fijada en `package.json`; actualizar a propósito leyendo el changelog. |
| La Vía Láctea desde dentro se ve granulada con partículas (fase 5) | Sprites suaves que se solapan (es un brillo, no un sólido); si no basta, el brillo difuso como textura en el fondo y las partículas encima. |
| Sobredibujo aditivo con una galaxia a pantalla completa (fase 5) | Sprites pequeños, LOD por densidad y un tope de impostores de galaxias. |
| Licencias de catálogos y panoramas (fase 5) | Comprobarlas antes de usarlos y registrarlas en `docs/ASSETS.md`. |
