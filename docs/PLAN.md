# Plan de desarrollo

Cuatro fases. Cada una termina en algo que se puede abrir en el navegador y disfrutar. Cada fase tiene un **criterio de "hecho"** comprobable: no se pasa a la siguiente hasta cumplirlo.

Estado: **Fase 1 implementada; pendiente de verificar los 60 fps** (criterio de "hecho"). Después: Fase 2.

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
- Las nubes se ven algo "granuladas" de cerca; turbulencia con *curl noise* en compute (fase 2).
- Respaldo WebGL2 sin probar.
- Errores de WebGPU de "textura de tamaño 0" si la página carga con la ventana oculta (inofensivos; desaparecen al mostrarse).

---

## Fase 2 — Sistema solar completo

1. Los 8 planetas + Plutón y lunas principales (Luna, Ío, Europa, Ganímedes, Calisto, Titán, Tritón).
2. `GasGiant` (Júpiter, Saturno, Urano, Neptuno) con bandas animadas y vórtices.
3. `Rings` de Saturno con velocidad kepleriana y sombra; anillos tenues de Urano.
4. `AsteroidBelt` con huecos de Kirkwood; cinturón de Kuiper ligero.
5. Líneas de órbita (también hechas de partículas).
6. `LodManager` con niveles discretos, presupuesto global y transición de "condensación" (el LOD continuo por densidad ya existe).
7. **Escala real** en la UI + transición animada entre escalas (`ScaleSystem` ya la soporta).
8. Control del tiempo en la UI (pausa, ×1, ×1000, 1 día/s, 1 año/s, fecha concreta).
9. `TravelMode`: clic → viaje cinematográfico.

**Hecho cuando:**
- Se puede viajar a cualquier planeta desde la lista o con clic.
- El cambio de escala comprimida ↔ real es fluido y sin saltos.
- Ningún planeta "tiembla" a ninguna distancia (origen flotante verificado).
- Las posiciones coinciden con las efemérides de JPL Horizons para una fecha de prueba (error < 1°).

---

## Fase 3 — Hasta la superficie

1. `surface/CubeSphereQuadtree` con subdivisión por error en pantalla e histéresis.
2. `SurfaceChunk` generado en GPU: heightmap real + ruido fractal procedural.
3. Pool de chunks y cola de generación con prioridad.
4. Profundidad: `reversedDepthBuffer` y `near`/`far` dinámicos.
5. Zoom de `OrbitMode` proporcional a la altitud; colisión con el suelo.
6. Heightmaps de alta resolución con carga progresiva (Tierra, Luna, Marte, Mercurio).
7. Gigantes gaseosos: descenso entre capas de nubes.

**Hecho cuando:**
- Se baja de forma continua desde la órbita hasta unos 10 m del suelo de la Tierra, la Luna y Marte, sin cortes ni parpadeo.
- Se reconocen accidentes reales (Himalaya, Valles Marineris, cráter Tycho).
- 60 fps con unos 4–6M de partículas en total.

---

## Fase 4 — Pulido y experiencia

1. `FreeFlyMode` 6DOF con velocidad adaptativa.
2. Efecto *warp* en viajes.
3. Panel de información completo por cuerpo.
4. Sonido ambiente (opcional; zumbido grave cerca de los gigantes, silencio en el vacío).
5. Rendimiento: perfiles de calidad (baja/media/alta/ultra) y detección del backend.
6. Pantalla de carga con el sistema "formándose" desde el polvo.
7. Despliegue estático (Vercel, Netlify o GitHub Pages).

**Hecho cuando:** una persona que no conoce el proyecto lo abre, explora sin instrucciones y aterriza en Marte.

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| WebGPU no disponible en el navegador del usuario | `WebGPURenderer` cae a WebGL2 solo; presupuesto de partículas reducido. |
| Heightmaps de 16k muy pesados (cientos de MB) | Teselar en *tiles* y cargar bajo demanda; ruido procedural por debajo de la resolución. |
| Parpadeo de chunks en el quadtree | Histéresis + fundido cruzado entre niveles. |
| Partículas que se ven "huecas" muy de cerca | La densidad del chunk crece con el zoom; tamaño de partícula mínimo en píxeles para que se solapen. |
| Cambios de API en Three.js (TSL evoluciona rápido) | Versión fijada en `package.json`; actualizar a propósito leyendo el changelog. |
