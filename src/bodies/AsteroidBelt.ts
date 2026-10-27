/**
 * Cinturón de asteroides con órbitas propagadas en GPU. Ver docs/ARQUITECTURA.md §8.
 */
export class AsteroidBelt {
  constructor(readonly count = 50_000) {}

  // TODO(fase 2): elementos orbitales aleatorios con huecos de Kirkwood (3:1, 5:2, 7:3, 2:1).
  // TODO(fase 2): Kepler en compute para cada partícula.
}
