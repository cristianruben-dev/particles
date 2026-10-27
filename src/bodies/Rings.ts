/**
 * Anillos planetarios con velocidad kepleriana. Ver docs/ARQUITECTURA.md §8.
 */
export interface RingsOptions {
  innerRadiusKm: number;
  outerRadiusKm: number;
  /** Textura 1D de densidad/opacidad radial. */
  profileUrl: string;
}

export class Rings {
  constructor(readonly options: RingsOptions) {}

  // TODO(fase 2): disco de partículas con densidad del perfil y ω ∝ r^-3/2 en compute.
  // TODO(fase 2): sombra del planeta sobre los anillos.
}
