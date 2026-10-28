# Particles — Sistema Solar

Un sistema solar navegable donde todo está hecho de partículas: del Sol a los anillos de Saturno. Cuanto más te acercas, más partículas aparecen, hasta poder bajar a la superficie de un planeta.

Web · Three.js (WebGPU con respaldo WebGL2) · TypeScript · Vite.

**Pruébalo:** https://cristianruben-dev.github.io/particles/ (mejor en Chrome, Edge o Safari recientes, con WebGPU).

## Arrancar

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite. Añade `?debug` para ver el panel de debug.

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente |
| `npm run build` | Comprobación de tipos + build de producción en `dist/` |
| `npm run typecheck` | Solo la comprobación de tipos |
| `npm run preview` | Sirve el build de producción |
| `BASE_PATH=/particles/ npm run build` | Build para una subruta (lo hace el flujo de GitHub Pages en cada push a `master`) |
| `node scripts/build-stars.mjs <catalog>` | Regenera `public/data/stars.bin` desde el Yale Bright Star Catalog |
| `python3 -I scripts/build-mars-height.py <img> <png>` | Convierte el MOLA de Marte en el mapa de altura del globo (8 bits) |
| `python3 -I scripts/build-height-u16.py mola\|lola …` | Convierte MOLA (Marte) o LOLA (Luna) en el mapa de altura de la superficie (16 bits) |

Añade `?quality=baja|media|alta|ultra` para fijar la calidad (por defecto se detecta y se ajusta sola; también desde los ajustes, arriba a la derecha).

**Controles** (también en la ayuda, tecla `?`):

| Acción | Cómo |
|---|---|
| Girar / acercarse | Arrastrar / rueda (hasta 10 m del suelo en los cuerpos rocosos) |
| Mirar alrededor a ras de suelo | Arrastrar con el botón derecho (o con Mayús) |
| Viajar a un cuerpo | Clic sobre él, en su nombre o en el navegador de abajo (las lunas aparecen al elegir su planeta) |
| Sol y planetas | Teclas `0`–`9` (0 Sol, 1 Mercurio… 9 Plutón) |
| Aterrizar / volver a la órbita | Botón del título o `T` (baja a un lugar conocido: Valles Marineris, Tycho…) |
| Ficha del cuerpo | Botón «Ficha» o `I` |
| Vuelo libre | `V`: `W A S D` moverse, `R F` subir y bajar, `Q E` girar, arrastrar o flechas para mirar, `Mayús` turbo, rueda para la velocidad; `Esc` vuelve a la órbita |
| Velocidad del tiempo | `,` y `.` o las marcas del reloj (de tiempo real a 1 año/s); espacio pausa; `N` vuelve a ahora; el calendario salta a cualquier fecha |
| Escala comprimida ↔ real | `E` o el selector de abajo a la derecha |
| Órbitas / nombres | `O` / `L` |
| Ocultar la interfaz | `U` (o `Esc` para volver) |

## Documentación

- [Visión](docs/VISION.md): qué es y qué decisiones están cerradas.
- [Arquitectura](docs/ARQUITECTURA.md): cómo está construido (precisión, escalas, partículas en GPU, LOD, superficie).
- [Plan](docs/PLAN.md): fases, entregables y criterios de "hecho".
- [Assets](docs/ASSETS.md): texturas, heightmaps y catálogos, con su licencia.

## Estructura

```
src/
├── main.ts           Entrada
├── config.ts         Presupuestos y flags
├── core/             Engine (bucle), Renderer, Quality (perfiles), SimClock, FloatingOrigin
├── scale/            ScaleSystem: km → escena (comprimida / real)
├── astro/            Datos de cuerpos, órbitas keplerianas, lunas, orientación IAU
├── particles/        ParticleField (GPU), horneado en worker, orden progresivo, LOD, perturbación
├── bodies/           Sun, RockyPlanet, GasGiant, Rings, Atmosphere, CloudLayer, AsteroidBelt,
│                     OrbitLines, Starfield y los niveles de detalle (DetailTier)
├── surface/          Terreno (CPU y GPU), quadtree cubo-esfera, chunks y pool para el aterrizaje
├── navigation/       CameraRig + OrbitMode (órbita, viaje y aterrizaje) y FreeFlyMode (vuelo libre)
├── postfx/           Bloom y warp
└── ui/               Interfaz (título, tiempo, navegador, herramientas, ajustes, ficha, ayuda),
                      etiquetas y panel de debug
public/
├── textures/         Texturas por cuerpo (ver docs/ASSETS.md)
└── data/             Catálogos (estrellas)
scripts/              Conversión de datos (estrellas, altura de Marte)
```

Los `TODO(fase N)` del código indican en qué fase de [docs/PLAN.md](docs/PLAN.md) se implementa cada pieza.
