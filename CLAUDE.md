# CLAUDE.md

Sistema solar navegable hecho de partículas (Three.js WebGPU + TSL, TypeScript, Vite).

- Antes de trabajar, lee `docs/PLAN.md` para saber en qué fase está el proyecto y `docs/ARQUITECTURA.md` para las reglas técnicas.
- Las posiciones "verdaderas" son float64 en km (`Vec3d`). Solo `ScaleSystem` convierte km → escena (float64) y solo `FloatingOrigin` resta la cámara y pasa a float32 (ver ARQUITECTURA §4).
- Nada de tiempo absoluto (ms/días desde J2000) en uniforms float32: reducir en float64 en la CPU.
- Ruido caro en partículas → pasada compute, no por vértice (cada sprite son 4 vértices).
- Verificación en navegador con `?debug`: `window.engine`; si el panel está oculto, `requestAnimationFrame` no corre y hay que avanzar frames a mano (`engine.frame()`), y los tiempos de GPU no son fiables.
- Imports: `three/webgpu` y `three/tsl`. `PostProcessing` está obsoleto: usar `RenderPipeline`.
- Docs y comentarios en español con tildes.
- Verificar con `npm run build` (tipos + build).
- Al añadir un asset en `public/`, registrar origen y licencia en `docs/ASSETS.md`. Para un mapa nuevo, comprobar con accidentes conocidos que la lon 0° y el este quedan bien (`mapLeftLon` si el borde izquierdo no está en −180°).
- Los buffers y pasadas compute de un cuerpo se crean a través de su `DetailTier` (`tier.buffer`, `tier.track`): así se liberan de la GPU al soltar el detalle completo (§6.3).
- Partículas que se colocan en la GPU a partir de km (anillos, asteroides, órbitas) pasan a escena con `ScaleSystem.distanceNode`, nunca con su propia fórmula.
- TSL: una expresión compartida se declara en el primer bloque donde se usa; si ese bloque es un `If`, fuera vale 0. Usar `.toVar()` antes de los `If`, o `select` y máscaras en vez de `If`.
- Superficie (§7.2): nada de coordenadas absolutas en float32 a escala de metros. Parte entera y fracción por separado, valores relativos al centro del chunk (float64 en la CPU) y nunca restar dos números casi iguales. Cualquier cambio en `surface/terrain.ts` va en la CPU y en la GPU a la vez.
- La cámara (órbita y vuelo libre) se guarda respecto a su cuerpo de referencia en km; de escena a km, solo `ScaleSystem.inverseLocalDistance` (§9).
- Interfaz (§11): componentes sin framework en `ui/`, cifras con `setText` (solo si cambian), acento `--body`. Para mirarla con el panel pequeño: `?quality=alta` (sin ajuste automático) y ampliar por zonas con `transform: scale(s) translate(-x, -y)` en `<html>`.
- Sombras de eclipse (§5.3): la geometría va con posiciones y radios reales en km, nunca en unidades de escena, y la misma fórmula en la CPU (`sunCoverage`) y en la GPU (`bodies/Shadows.ts`).
- Cometas: coma y colas se colocan respecto al núcleo con `distanceNode` del propio cometa (su `radiusKm` es el de referencia de la coma, §4.3).
- `satellite.js` se importa desde `astro/sgp4.ts`, no del paquete: su índice arrastra un WebAssembly que rompe el build.
- Capa cósmica (§14): sus posiciones son km verdaderos respecto al Sol y nunca se mezclan con las de la escena solar. A la GPU van en años luz con `ScaleSystem.cosmic`, restadas de la cámara en float64 en la CPU. La cámara cósmica sale de `OrbitMode.cameraKm`, no de la posición de escena (más allá del relevo se queda en el borde). Relevo y zoom, por la distancia verdadera al Sol (`core/Handoff.ts`), nunca por unidades de escena. Si el panel del navegador mide 0×0, darle tamaño con `resize_window` antes de avanzar frames.
- Galaxias (§14.5): se viaja con `OrbitMode.travelTo` (un `CosmicDestination`) desde la órbita del Sol, nunca con `focusOn`. Desde el cosmos, todo viaje a un cuerpo pasa por `Engine.leaveCosmos`. Sus datos van en `astro/galaxies.ts` y su forma en `cosmos/galaxyModel.ts` (en el worker).
- TSL: un `uniformArray` de vec3 leído en un compute dio NaN; para datos por hueco o por chunk en un compute, un buffer pequeño (`StorageInstancedBufferAttribute` + `needsUpdate`).
- El tone mapping va a mano (`renderOutput`) y después el tramado (`postfx/Pipeline.ts`): sin él, el halo del Sol sale en anillos de 8 bits.
- `src/astro/cometApparitions.ts` se genera con `node scripts/build-comet-apparitions.mjs` (JPL Horizons): no editarlo a mano.
- Sonido (§13): procedural en `audio/` (Web Audio), arranca en el primer gesto del usuario; cada voz con su ganancia a 0 cuando no suena (un LFO no puede sonar solo).
- Al terminar una fase, marcarla en `docs/PLAN.md`.
