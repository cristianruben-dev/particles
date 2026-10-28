# Plan de desarrollo

Cuatro fases. Cada una termina en algo que se puede abrir en el navegador y disfrutar. Cada fase tiene un **criterio de "hecho"** comprobable: no se pasa a la siguiente hasta cumplirlo.

Estado: **Fase 4 en curso**: perfiles de calidad, medidor de fps, interfaz nueva, ficha, aterrizaje, vuelo libre, warp y pantalla de carga hechos. Quedan el despliegue, el descenso entre nubes de los gigantes y el sonido (opcional), y comprobar con la ventana delante los 60 fps (el medidor del HUD ya lo permite) y que nada tiemble en escala real.

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
- Anillos concéntricos en el halo de bloom del Sol.
- Las nubes se ven algo "granuladas" de cerca; turbulencia con *curl noise* en compute.
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
- Los gigantes gaseosos, de cerca, siguen viéndose algo "granulados" (puntos claros sobre negro); el borde entre bandas se remueve con el flujo, a propósito.
- Tritón tiene un error de unos 6° en su órbita: el modelo de elementos medios no recoge bien la precesión de su plano.
- Saturno no tiene textura real (no hay un mapa global de Cassini sin anillos); su color es un perfil de bandas.

---

## Fase 3 — Hasta la superficie ✅ (pendiente de medir)

1. [x] `surface/CubeSphereQuadtree` sobre un cubo equiangular, con división por separación de partícula en pantalla, histéresis, frustum y horizonte por nodo (§7.1).
2. [x] `SurfaceChunk` generado en GPU: mapa de alturas real (B-spline) + ruido fractal sobre hash entero, con la misma función en la CPU para la colisión (§7.2). Todo relativo al centro del chunk (float64 en la CPU): sin escalones ni costuras a escala de centímetros.
3. [x] Pool de chunks y generación por lotes (hasta 32 por frame); reparto en ruido azul progresivo con densidad continua por partícula (§7.3).
4. [x] Profundidad: profundidad invertida y plano cercano dinámico hasta 10⁻⁹ unidades.
5. [x] Zoom sobre la altitud sobre el suelo real, cámara solidaria con el cuerpo a ras de suelo, mirada hacia el horizonte y "mirar alrededor" con el botón derecho (§9).
6. [x] Mapas de altura de 16 bits para la Luna (LOLA) y Marte (MOLA). Pendiente: más resolución en la Tierra (hoy 8 bits y 4k) y carga progresiva por teselas.
7. [ ] Gigantes gaseosos: descenso entre capas de nubes → **fase 4** (la cámara se queda sobre la cima de las nubes).
8. [x] Extra: horizonte con cielo y suelo en el fondo, y estrellas solo por encima del horizonte (§7.4).

**Hecho cuando:**
- [x] Se baja de forma continua desde la órbita hasta unos 10 m del suelo de la Tierra, la Luna y Marte (y Mercurio, Europa y Titán), sin cortes: descensos automáticos de 2000 km a 10 m, con el tiempo parado y en marcha, sin posiciones no finitas, con la cámara siempre a más de 11 m del suelo dibujado y el plano cercano delante. El relevo globo ↔ superficie se hace con un fundido de 0,35 s en los dos sentidos. Al subir, la superficie se libera (321 → 183 MB) y al volver a bajar se rehace.
- [~] Sin parpadeo: en reposo no hay huecos (0 hojas visibles sin chunk, de 1024×768 a 1920×1080). Al girar 180° de golpe a 10 m aparecen hasta 15 huecos durante 3 frames, y en una bajada muy rápida hasta 20 durante 9 frames.
- [~] Se reconocen accidentes reales: el pico central y la sombra de Tycho, los cañones de Valles Marineris y la masa nevada del Himalaya. La Tierra, con un mapa de 10 km por texel, no tiene picos individuales: por debajo es ruido procedural.
- [ ] 60 fps con unos 4–6M de partículas: pendiente de medir con la ventana delante. En el panel oculto del navegador se vieron 60–70 fps a 10 m del suelo con ~3M de partículas.

**Pendientes detectados en la fase 3:**
- Patrón de mosaico de la tesela de ruido azul en algunos ángulos y ligeros cambios de textura en los bordes de chunk (distintas octavas finas por nivel).
- A 150 km de la Luna el suelo se ve muy contrastado (albedo LRO, puntos claros sobre huecos oscuros).
- La perturbación con el ratón no actúa sobre los chunks.

---

## Fase 4 — Pulido y experiencia (en curso)

1. [x] `FreeFlyMode` 6DOF con velocidad adaptativa, anclado al cuerpo más cercano, colisión con el relieve y nivelación del horizonte (§9).
1b. [ ] Gigantes gaseosos: descenso entre capas de nubes volumétricas (aplazado de la fase 3).
2. [x] Efecto *warp* en los viajes (§10).
3. [x] Ficha completa por cuerpo con datos de NASA y JPL, distancias en vivo y botón de aterrizar en un lugar conocido (§11).
4. [ ] Sonido ambiente (opcional; zumbido grave cerca de los gigantes, silencio en el vacío).
5. [x] Rendimiento: perfiles de calidad (baja/media/alta/ultra), detección del equipo, ajuste automático y medidor de fps con gráfica (§12).
6. [x] Pantalla de carga con el sistema "formándose" desde el polvo (§11).
7. [ ] Despliegue estático (Vercel, Netlify o GitHub Pages).
8. [x] Extra: interfaz rediseñada entera (título, tiempo, navegador de cuerpos, herramientas, ajustes, ayuda, avisos y pista de bienvenida), con atajos nuevos (`T` aterrizar, `V` vuelo, `I` ficha, `U` ocultar, `?` ayuda).

**Hecho cuando:** una persona que no conoce el proyecto lo abre, explora sin instrucciones y aterriza en Marte.
- [~] El camino existe sin instrucciones: la pista de bienvenida explica arrastrar, rueda y clic; Marte está en el navegador de abajo; el botón **Aterrizar** del título baja a Valles Marineris, de día (verificado: 5 km sobre el suelo, superficie completa, 0 huecos, cañón y cielo de polvo a la vista). Falta probarlo con alguien de verdad.

**Verificaciones de la fase 4:**
- Vuelo libre: de 14.000 km a 8 m sobre la Tierra manteniendo W (12 s, sin posiciones no finitas, plano cercano siempre delante); la colisión mantiene los 8 m con turbo contra el suelo; salir con Esc deja la órbita a 10 m en el marco del cuerpo. Anclado a la Luna, ida y vuelta a la escala real sin moverse (5.729 km del centro en todo momento).
- Aterrizaje en Marte con el reloj adelantado 10 h hasta la mañana de Valles Marineris.

- Superficie a 10 m tras el arreglo del horizonte (1024×768, calidad alta, panel del navegador visible): 0 huecos en reposo en la Tierra (367 chunks), la Luna (321) y Marte (415). Con un giro de 180° suavizado, hasta 100–136 huecos durante 3–5 frames; con el cálculo del horizonte de la fase 3 sale lo mismo en la Tierra (105 durante 4), así que la diferencia con las cifras de la fase 3 es del método (giro y ventana distintos), no una regresión.
- La interfaz no cuesta fps: 22,7 con paneles de cristal, 22,0 sin desenfoque y 22,0 sin interfaz (a 10 m, 2,8M partículas, en el panel emulado); el bucle de la CPU tarda 0,7 ms por frame.

**Pendientes detectados en la fase 4:**
- **Rendimiento a ras de suelo, sin medir de verdad:** en el panel del navegador (emulando 1024×768 a 2×) salieron 22 fps a 10 m del suelo, y con calidad media o baja apenas sube (28–30, ¿tope del panel?). Hay que leerlo en el medidor con la ventana delante; si se confirma, el cuello está en los vértices (2,5M sprites × 4) y no en el relleno: el perfil bajo debería recortar partículas de la superficie, no solo resolución.
- El warp se ha visto solo en capturas pequeñas: falta mirarlo a pantalla completa (intensidad de las estelas).
- La interfaz en móvil está maquetada pero sin probar en un teléfono (táctil; el vuelo libre necesita teclado).

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| WebGPU no disponible en el navegador del usuario | `WebGPURenderer` cae a WebGL2 solo; presupuesto de partículas reducido. |
| Heightmaps de 16k muy pesados (cientos de MB) | Teselar en *tiles* y cargar bajo demanda; ruido procedural por debajo de la resolución. |
| Parpadeo de chunks en el quadtree | Histéresis + fundido cruzado entre niveles. |
| Partículas que se ven "huecas" muy de cerca | La densidad del chunk crece con el zoom; tamaño de partícula mínimo en píxeles para que se solapen. |
| Cambios de API en Three.js (TSL evoluciona rápido) | Versión fijada en `package.json`; actualizar a propósito leyendo el changelog. |
