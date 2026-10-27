/**
 * Fábrica: elige la clase de render según `BodyData.kind` y el preset visual.
 */
import type { BodyData } from '../astro/bodies';
import type { CelestialBody } from './CelestialBody';
import { ROCKY_PRESETS } from './presets';
import { RockyPlanet } from './RockyPlanet';
import { Sun } from './Sun';

/** Devuelve null para cuerpos aún sin implementar en la fase actual. */
export function createBody(data: BodyData, parent: CelestialBody | null): CelestialBody | null {
  switch (data.kind) {
    case 'star':
      return new Sun(data);
    case 'rocky':
    case 'moon': {
      const preset = ROCKY_PRESETS[data.id];
      return preset ? new RockyPlanet(data, parent, preset) : null;
    }
    case 'gas':
      // TODO(fase 2): GasGiant.
      return null;
  }
}
