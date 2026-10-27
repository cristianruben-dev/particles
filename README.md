# Particles — Sistema Solar

Un sistema solar navegable donde todo está hecho de partículas: del Sol a los anillos de Saturno. Cuanto más te acercas, más partículas aparecen, hasta poder bajar a la superficie de un planeta.

Web · Three.js (WebGPU con respaldo WebGL2) · TypeScript · Vite.

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
| `node scripts/build-stars.mjs <catalog>` | Regenera `public/data/stars.bin` desde el Yale Bright Star Catalog |

**Controles:** arrastrar para girar, rueda para zoom, clic o teclas 1–3 para enfocar Sol, Tierra o Luna; `,` y `.` cambian la velocidad del tiempo, espacio pausa y `N` vuelve a la hora actual.

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
├── core/             Engine (bucle), Renderer, SimClock, FloatingOrigin
├── scale/            ScaleSystem: km → escena (comprimida / real)
├── astro/            Datos de cuerpos, unidades, órbitas keplerianas
├── particles/        ParticleField (GPU), horneado en worker, orden progresivo, LOD
├── bodies/           Sun, RockyPlanet, GasGiant, Atmosphere, CloudLayer, Rings, AsteroidBelt, Starfield
├── surface/          Quadtree cubo-esfera, chunks y pool para el aterrizaje
├── navigation/       CameraRig + modos Orbit / FreeFly / Travel
├── postfx/           Bloom y efectos
└── ui/               HUD y panel de debug
public/
├── textures/         Texturas por cuerpo (ver docs/ASSETS.md)
└── data/             Catálogos (estrellas)
scripts/              Conversión de datos (catálogo de estrellas)
```

Los `TODO(fase N)` del código indican en qué fase de [docs/PLAN.md](docs/PLAN.md) se implementa cada pieza.
