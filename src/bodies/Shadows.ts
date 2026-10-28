/**
 * Sombras de eclipse sobre un cuerpo: la Luna sobre la Tierra, la Tierra sobre la Luna, las
 * lunas galileanas sobre Júpiter y Júpiter sobre ellas… Ver docs/ARQUITECTURA.md §5.3 y §8.
 *
 * Cada frame la CPU pasa, en radios del cuerpo y ejes de escena, dónde está cada ocultador
 * respecto a él (con las posiciones y radios reales en km: en la escala comprimida la Luna
 * queda ~7 veces más cerca, en proporción, y la sombra caería donde no es). En la GPU cada
 * partícula calcula qué parte del disco del Sol le tapa cada uno (`sunCoverage`, la misma
 * fórmula que en la CPU), una vez por vértice. Si ninguna sombra puede tocar el cuerpo, un
 * uniform se la salta.
 */
import * as THREE from 'three/webgpu';
import { Fn, If, abs, asin, atan, cross, float, length, min, smoothstep, uniform, varying, vec3 } from 'three/tsl';
import { BODIES, type BodyId, type BodyKind } from '../astro/bodies';
import { SUN_RADIUS_KM, occluderAtShadowTime, occluderRadiusKm, shadowGeometryOf, shadowReach, sunCoverage } from '../astro/eclipses';
import { eclToScene, type Vec3d } from '../astro/frames';
import { config } from '../config';
import type { Vec3Node } from '../particles/nodes';
import type { CelestialBody } from './CelestialBody';

/** Luz que la atmósfera de la Tierra refracta hacia su sombra (lineal): la Luna eclipsada se ve cobriza. */
export const shadowLook = {
  earthUmbra: new THREE.Color(0.26, 0.085, 0.03),
};

/** Cuerpos que proyectan sombra (los cometas y la estación, no). */
const CASTERS = new Set<BodyKind>(['rocky', 'gas', 'moon']);
const MAX_OCCLUDERS = 4;

/** Quién puede tapar el Sol a un cuerpo: su planeta y sus lunas (entre lunas, casi nunca). */
export function occludersOf(id: BodyId): BodyId[] {
  const data = BODIES[id];
  if (data.kind === 'star') return [];
  const out: BodyId[] = [];
  if (data.parent && data.parent !== 'sun') out.push(data.parent);
  for (const other of config.bodies) if (BODIES[other].parent === id && BODIES[other].kind === 'moon') out.push(other);
  return out.filter((o) => config.bodies.includes(o) && CASTERS.has(BODIES[o].kind)).slice(0, MAX_OCCLUDERS);
}

interface Slot {
  id: BodyId;
  radiusKm: number;
  /** Ocultador respecto al receptor (xyz, radios del receptor, ejes de escena) y su radio (w). */
  pos: THREE.UniformNode<'vec4', THREE.Vector4>;
  /** Luz que deja pasar dentro de la sombra (0 = ninguna; la Tierra, roja). */
  pass: THREE.UniformNode<'vec3', THREE.Vector3>;
  /** Esta sombra puede tocar el receptor este frame. */
  on: boolean;
}

export class EclipseShadow {
  private readonly active = uniform(0);
  /** Radio angular del Sol visto desde el cuerpo (rad) y dirección hacia él (ejes de escena). */
  private readonly sunAngle = uniform(0.0047);
  private readonly sunDir = uniform(new THREE.Vector3(1, 0, 0));
  private readonly slots: Slot[];
  private readonly radiusKm: number;

  private constructor(readonly receiver: BodyId, occluders: BodyId[]) {
    this.radiusKm = BODIES[receiver].radiusKm;
    this.slots = occluders.map((id) => ({
      id,
      radiusKm: occluderRadiusKm(id),
      pos: uniform(new THREE.Vector4(0, 1e6, 0, 1)),
      pass: uniform(new THREE.Vector3()),
      on: false,
    }));
  }

  /** null si nada puede eclipsar al cuerpo. */
  static for(id: BodyId): EclipseShadow | null {
    const occluders = occludersOf(id);
    return occluders.length ? new EclipseShadow(id, occluders) : null;
  }

  /** Con las posiciones del frame ya calculadas (`layoutSystem`). */
  update(self: CelestialBody, lookup: (id: BodyId) => CelestialBody | undefined, timeMs: number): void {
    const p = self.positionKm, R = this.radiusKm;
    const d = Math.hypot(p.x, p.y, p.z);
    this.sunAngle.value = Math.asin(Math.min(1, SUN_RADIUS_KM / d));
    const s = eclToScene(p);
    this.sunDir.value.set(-s.x / d, -s.y / d, -s.z / d);
    let any = false;
    for (const slot of this.slots) {
      slot.on = false;
      if (!lookup(slot.id)) continue;
      // Donde estaba el ocultador cuando pasó por él la luz que llega ahora (tiempo de luz).
      const o = occluderAtShadowTime(slot.id, p, timeMs);
      const g = shadowGeometryOf(o, p, slot.radiusKm);
      slot.on = shadowReach(g, R) < 1;
      any ||= slot.on;
      const rel = eclToScene({ x: o.x - p.x, y: o.y - p.y, z: o.z - p.z });
      slot.pos.value.set(rel.x / R, rel.y / R, rel.z / R, slot.radiusKm / R);
      // La luz refractada llena la sombra de la Tierra lejos de ella (la Luna), no en órbita baja.
      const far = slot.id === 'earth' ? THREE.MathUtils.smoothstep(g.behind / BODIES.earth.radiusKm, 10, 40) : 0;
      slot.pass.value.set(shadowLook.earthUmbra.r * far, shadowLook.earthUmbra.g * far, shadowLook.earthUmbra.b * far);
    }
    this.active.value = any ? 1 : 0;
  }

  /** ¿Cae alguna sombra sobre el cuerpo este frame? */
  get eclipsing(): boolean {
    return this.active.value > 0;
  }

  /**
   * Luz del Sol (rgb, 0–1) que llega a un punto, en radios del cuerpo y ejes de mundo
   * respecto a su centro (basta la dirección de la partícula). Se evalúa por vértice.
   */
  lightNode(point: Vec3Node): Vec3Node {
    return varying(this.light(point)) as Vec3Node;
  }

  private readonly light = Fn(([point]: [Vec3Node]) => {
    const p = vec3(point).toVar();
    const light = vec3(1).toVar();
    If(this.active.greaterThan(0.5), () => {
      const s = this.sunAngle;
      for (const slot of this.slots) {
        const to = slot.pos.xyz.sub(p);
        const d = length(to);
        const a = asin(min(slot.pos.w.div(d), 1));
        // Ángulo entre los centros con atan2(|u × s|, u · s): acos pierde precisión cerca de 0.
        const theta = atan(length(cross(to, this.sunDir)).div(d), to.dot(this.sunDir).div(d));
        const cover = float(1).sub(smoothstep(abs(s.sub(a)), s.add(a), theta)).mul(min(a.mul(a).div(s.mul(s)), 1));
        light.mulAssign(vec3(1).sub(vec3(1).sub(slot.pass).mul(cover)));
      }
    });
    return light;
  });

  /** Luz del Sol (luminancia, 0–1) en un punto (radios del cuerpo, ejes de escena), en la CPU. */
  lightAt(point: Vec3d): number {
    if (!this.eclipsing) return 1;
    let light = 1;
    const sun = { x: this.sunDir.value.x, y: this.sunDir.value.y, z: this.sunDir.value.z };
    for (const slot of this.slots) {
      if (!slot.on) continue;
      const v = slot.pos.value;
      const cover = sunCoverage(point, { x: v.x, y: v.y, z: v.z }, v.w, sun, this.sunAngle.value);
      const pass = (slot.pass.value.x + slot.pass.value.y + slot.pass.value.z) / 3;
      light *= 1 - (1 - pass) * cover;
    }
    return light;
  }
}
