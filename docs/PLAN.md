# Plan de desarrollo

Cinco fases. Cada una termina en algo que se puede abrir en el navegador y disfrutar. Cada fase tiene un **criterio de "hecho"** comprobable: no se pasa a la siguiente hasta cumplirlo.

Estado: **Fase 4 en curso**: perfiles de calidad, medidor de fps, interfaz nueva, ficha, aterrizaje, vuelo libre, warp, pantalla de carga, eclipses y tránsitos con su calendario, cometas, la ISS y el sonido ambiente hechos, y corregidos los pendientes visuales y de precisión de las fases anteriores (punto 14). Publicado en GitHub Pages. Quedan el descenso entre nubes de los gigantes y comprobar con la ventana delante los 60 fps (el medidor del HUD ya lo permite) y que nada tiemble en escala real. La **fase 5** (galaxias y cúmulos, ARQUITECTURA §14) está diseñada y sin empezar.

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

## Fase 5 — Más allá del sistema solar (propuesta)

Objetivo: alejarse sin cortes desde el sistema solar hasta ver la Vía Láctea entera con un «Estás aquí», el Grupo Local y los cúmulos de galaxias. A las otras galaxias se va a mirarlas (órbita a su alrededor), no a entrar en ellas. Diseño en ARQUITECTURA §14.

Antes de empezar: cerrar la medición de los 60 fps de la fase 4, porque la capa cósmica añade carga.

0. [ ] **Capa cósmica** (§14.2): verdad en km float64 como el resto, `ScaleSystem.cosmic` (km → años luz, solo para la GPU), cámara cósmica = posición del Sol en la galaxia + desplazamiento verdadero de la cámara, partículas proyectadas sobre la cáscara de 10⁹ como `Starfield` con tamaño y brillo según la distancia real, y desvanecido cercano. Regla nueva en `CLAUDE.md`: las posiciones cósmicas nunca se mezclan con las de la escena solar.
1. [ ] **Marco galáctico** en `astro/frames.ts` (§14.3): galáctico ↔ ecuatorial J2000, y de ahí a la eclíptica y la escena como las estrellas.
2. [ ] **Vía Láctea desde dentro** (lo que §8 tenía pendiente para la fase 4): panorama del cielo sin las estrellas puntuales, muestreado por densidad, con las mismas máscaras que las estrellas (horizonte, día y totalidad).
3. [ ] **Relevo sistema solar ↔ cosmos** (§14.4) por la distancia en km reales de la cámara al Sol, entre ~500 y 2.000 UA: la escena solar se funde y queda el Sol como una estrella más. Las estrellas de Yale (en el infinito) se apagan o pasan a 3D con distancias (HYG, opcional). Zoom más allá de las 200 UA de hoy.
4. [ ] **Vía Láctea desde fuera**: modelo procedural horneado en worker con parámetros publicados (disco, bulbo, barra, brazos de Reid et al. 2019 con el brazo de Orión, polvo y regiones HII), cúmulos globulares reales (Harris), Nubes de Magallanes, «Estás aquí» y nombres de los brazos; fundido con el panorama.
5. [ ] **Grupo Local**: Andrómeda, Triángulo y las enanas (McConnachie 2012) con plantillas de partículas por tipo, orientadas con su inclinación y su ángulo de posición. Andrómeda, enfocable.
6. [ ] **Cúmulos y red cósmica**: 2MRS o Cosmicflows-4, un punto por galaxia e impostores para las que más miden en pantalla, con los «dedos de Dios» corregidos; nombres de Virgo, Coma, el Gran Atractor, el Vacío Local y Laniakea.
7. [ ] **Navegación e interfaz** (§14.5): escalones con viaje logarítmico y warp, el «arriba» de la cámara hacia el norte galáctico, pivote de la órbita del Sol al centro galáctico sin saltos, barra de escala (UA → años luz → millones de años luz), sin barra de tiempo ni vuelo libre en los niveles cósmicos, y fichas de las galaxias.

**Hecho cuando:**
- [ ] Se va de la superficie de la Tierra a fuera de la Vía Láctea y de vuelta sin saltos ni cortes (medido frame a frame, como el cambio de escala de la fase 2), en la escala comprimida y en la real.
- [ ] Desde el suelo, la banda pasa por donde debe: el centro galáctico entre Escorpio y Sagitario (AR 17h46m, Dec −29°), la Gran Nube de Magallanes en Dorado (AR 5h24m, Dec −69°45′), y el panorama no está en espejo.
- [ ] Desde fuera, el Sol está a 8,2 kpc del centro, en el brazo de Orión y ~21 pc sobre el plano, y la dirección al centro desde él coincide con la del panorama.
- [ ] Andrómeda en AR 0h42m44s, Dec +41°16′, a ~2,5 millones de años luz, con su inclinación (77°) y su ángulo de posición (38°); M87 en el centro de Virgo, a ~54 millones.
- [ ] 60 fps con la galaxia llenando la pantalla, medido con la ventana delante.

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
