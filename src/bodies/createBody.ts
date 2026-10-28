/**
 * Fábrica: elige la clase de render según `BodyData.kind` y el preset visual.
 */
import type { BodyData } from '../astro/bodies';
import type { ScaleSystem } from '../scale/ScaleSystem';
import type { CelestialBody } from './CelestialBody';
import { GasGiant } from './GasGiant';
import { GAS_PRESETS, ROCKY_PRESETS } from './presets';
import { RockyPlanet } from './RockyPlanet';
import { Sun } from './Sun';

/** Devuelve null para cuerpos sin preset visual. */
export function createBody(data: BodyData, parent: CelestialBody | null, scale: ScaleSystem): CelestialBody | null {
  switch (data.kind) {
    case 'star':
      return new Sun(data);
    case 'rocky':
    case 'moon': {
      const preset = ROCKY_PRESETS[data.id];
      return preset ? new RockyPlanet(data, parent, preset) : null;
    }
    case 'gas': {
      const preset = GAS_PRESETS[data.id];
      return preset ? new GasGiant(data, parent, preset, scale) : null;
    }
  }
}
