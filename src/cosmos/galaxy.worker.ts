/**
 * Genera las partículas de la Vía Láctea fuera del hilo principal. Ver docs/ARQUITECTURA.md §14.4.
 */
import { generateMilkyWay, type GalaxyRequest } from './milkyWayModel';

self.addEventListener('message', (event: MessageEvent<GalaxyRequest>) => {
  const result = generateMilkyWay(event.data);
  const { stars, dust } = result;
  self.postMessage(result, { transfer: [stars.posSize.buffer, stars.color.buffer, dust.posSize.buffer, dust.color.buffer] });
});
