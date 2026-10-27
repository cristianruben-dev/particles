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
- Al añadir un asset en `public/`, registrar origen y licencia en `docs/ASSETS.md`.
- Al terminar una fase, marcarla en `docs/PLAN.md`.
