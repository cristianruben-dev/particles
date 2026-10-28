/**
 * Genera las partículas de las galaxias fuera del hilo principal. Ver docs/ARQUITECTURA.md §14.4.
 */
import { generateGalaxy, type GalaxySpec } from './galaxyModel';
import { generateMilkyWay, type GalaxyRequest, type GalaxyResult } from './milkyWayModel';

export type WorkerRequest = { kind: 'milkyway'; request: GalaxyRequest } | { kind: 'galaxy'; id: string; spec: GalaxySpec };
export type WorkerResult = { kind: 'milkyway'; result: GalaxyResult; ms: number } | { kind: 'galaxy'; id: string; result: GalaxyResult; ms: number };

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const t0 = performance.now();
  const msg = event.data;
  const result = msg.kind === 'milkyway' ? generateMilkyWay(msg.request) : generateGalaxy(msg.spec);
  const { stars, dust } = result;
  const reply: WorkerResult = msg.kind === 'milkyway' ? { kind: 'milkyway', result, ms: performance.now() - t0 } : { kind: 'galaxy', id: msg.id, result, ms: performance.now() - t0 };
  self.postMessage(reply, { transfer: [stars.posSize.buffer, stars.color.buffer, dust.posSize.buffer, dust.color.buffer] });
});
