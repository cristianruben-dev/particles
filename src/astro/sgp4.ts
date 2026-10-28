/**
 * SGP4 de `satellite.js` sin su versión WebAssembly: el índice del paquete la reexporta y Vite
 * intenta empaquetar sus workers (con `await` de primer nivel, que no admite en ellos). Se
 * importan directamente los módulos de JavaScript, que no la tocan.
 */
export { twoline2satrec } from '../../node_modules/satellite.js/dist/io.js';
export { gstime, propagate } from '../../node_modules/satellite.js/dist/propagation.js';
export { eciToEcf } from '../../node_modules/satellite.js/dist/transforms.js';
export type { SatRec } from '../../node_modules/satellite.js/dist/propagation/SatRec.js';
