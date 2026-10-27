import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // WebGPU + top-level await
    target: 'es2022',
    // three/webgpu ocupa ~900 kB por sí solo.
    chunkSizeWarningLimit: 1500,
  },
});
