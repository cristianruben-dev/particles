import { defineConfig } from 'vite';

export default defineConfig({
  // Subruta del despliegue (GitHub Pages sirve el proyecto en /<repo>/). Absoluta, no
  // relativa: los workers resuelven las rutas respecto a su propio archivo, no a la página.
  base: process.env.BASE_PATH ?? '/',
  build: {
    // WebGPU + top-level await
    target: 'es2022',
    // three/webgpu ocupa ~900 kB por sí solo.
    chunkSizeWarningLimit: 1500,
  },
});
