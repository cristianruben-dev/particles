/**
 * Planetas rocosos y lunas: albedo + relieve real + iluminación por partícula, y la
 * superficie para bajar hasta el suelo. Ver docs/ARQUITECTURA.md §6.2, §7 y §8.
 */
import * as THREE from 'three/webgpu';
import { float, max, mix, pow, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BodyData } from '../astro/bodies';
import type { Vec3d } from '../astro/frames';
import { config } from '../config';
import { bakeSphere, type BakeTexture } from '../particles/bake';
import { Disturbance, disturbanceLook, type LocalRay } from '../particles/Disturbance';
import { ball, ballDepth, ballSprite, frontFacing, hardDisc, pixelAngle, viewDirection, worldNormal, type Vec3Node } from '../particles/nodes';
import { detailFraction } from '../particles/LodManager';
import { ParticleField } from '../particles/ParticleField';
import { Surface } from '../surface/Surface';
import { TerrainData } from '../surface/TerrainData';
import { lastFaceOctave, terrainHeightCpu, type TerrainParams } from '../surface/terrain';
import { Atmosphere } from './Atmosphere';
import { BaseBody } from './BaseBody';
import type { CelestialBody, FrameContext } from './CelestialBody';
import { CloudLayer } from './CloudLayer';
import { DetailTier, type TierKind } from './DetailTier';
import type { RockyPreset } from './presets';

/** Parámetros artísticos compartidos (ajustables desde el panel de debug). */
export const rockyLook = {
  ambient: uniform(0.012),
  nightLights: uniform(2.6),
  specular: uniform(0.6),
  /** 0 = discos planos con la luz del planeta, 1 = cada partícula es una bola iluminada. */
  ballShading: uniform(0.9),
  /** Ganancia de brillo de cada punto: con aire entre partículas el planeta cubre menos y se oscurece. */
  dotGain: uniform(1.7),
};

/** Partículas de la vista previa de una capa con `count` partículas en el detalle completo. */
export function previewCount(count: number, mainCount: number): number {
  const main = Math.min(config.lod.previewCount, Math.ceil(mainCount / 4));
  return Math.max(2000, Math.ceil((count * main) / mainCount));
}

/** Fracción de detalle del globo con la que entra (y, por debajo de la otra, sale) la superficie. */
const SURFACE_ENTER = 0.8;
const SURFACE_EXIT = 0.55;

export class RockyPlanet extends BaseBody {
  /** Exageración del relieve vista desde la órbita (ajustable en vivo desde el panel). */
  readonly reliefScale: { value: number };
  /** Relieve que usa el globo este frame: se modera al bajar hacia el de la superficie. */
  private readonly relief = uniform(0);

  /** Superficie (§7): datos del terreno mientras el cuerpo está enfocado, y los chunks. */
  private terrain: TerrainData | null = null;
  private terrainLoading = false;
  private surface: Surface | null = null;
  private globe: ParticleField | null = null;
  private readonly terrainParams: TerrainParams | null;
  /** Atenuación de nubes y atmósfera cuando la cámara baja por debajo de ellas. */
  private readonly cloudFade = uniform(1);
  private readonly airFade = uniform(1);
  private readonly terrainLight = uniform(0);
  private readonly planetCenter = uniform(new THREE.Vector3());
  private readonly view = new THREE.Vector3();

  constructor(data: BodyData, parent: CelestialBody | null, private readonly preset: RockyPreset) {
    super(data, parent);
    this.reliefScale = { value: preset.reliefScale };
    this.relief.value = preset.reliefScale;
    this.terrainParams = preset.surface
      ? {
          relief: preset.surface.relief,
          reference: preset.surface.reference ?? preset.heightReference,
          waterBelow: preset.surface.waterBelow ?? preset.waterBelow ?? -1,
          roughness: preset.surface.roughness,
          radiusKm: data.radiusKm,
        }
      : null;
    this.object3d.add(occluder(preset));
    this.start();
  }

  get landable(): boolean {
    return this.terrainParams !== null;
  }

  get particleCount(): number {
    return super.particleCount + (this.surface?.complete ? this.surface.particleCount : 0);
  }

  /** Altura del suelo que se dibuja (km), para que la cámara no lo atraviese. */
  groundHeightKm(dir: Vec3d): number {
    if (!this.terrainParams || !this.terrain) return 0;
    const local = this.view.set(dir.x, dir.y, dir.z).applyQuaternion(this.spinQuaternion.clone().invert());
    const radii = this.surface
      ? this.surface.heightAt(local)
      : terrainHeightCpu(local.x, local.y, local.z, this.terrain.height, this.terrainParams, lastFaceOctave(0, 80));
    return radii * this.data.radiusKm;
  }

  protected async buildTier(kind: TierKind): Promise<DetailTier> {
    const p = this.preset;
    const tier = new DetailTier(kind);
    const count = kind === 'full' ? p.count : previewCount(p.count, p.count);
    const layerCount = (n: number) => (kind === 'full' ? n : previewCount(n, p.count));

    const textures: Record<string, BakeTexture> = {};
    const leftLon = p.mapLeftLon;
    if (p.textures.albedo) textures.albedo = { url: p.textures.albedo, channels: 3, srgb: true, leftLon };
    if (p.textures.height) textures.height = { url: p.textures.height, channels: 1, srgb: false, leftLon };
    if (p.textures.night) textures.night = { url: p.textures.night, channels: 1, srgb: true };

    const baked = await bakeSphere({
      count,
      seed: hashString(this.data.id),
      distribution: { kind: 'progressive' },
      textures,
      noise: p.noise,
    });

    // Empaquetado en vec4: color = (albedo.rgb, agua), surf = (altura, luces, 0, 0).
    const { albedo, height, night, noise } = baked.samples;
    const tint = new THREE.Color(p.tint ?? 0xffffff).multiplyScalar(p.gain ?? 1);
    const noiseColors = p.noise?.colors.map((c) => new THREE.Color(c));
    // Zonas sin datos de los mosaicos (negro puro): color medio del cuerpo.
    const fill = new THREE.Color(this.data.color).multiplyScalar(0.8);
    const color = new Float32Array(count * 4);
    const surf = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      let r = tint.r, g = tint.g, b = tint.b;
      if (albedo && albedo[i * 3] + albedo[i * 3 + 1] + albedo[i * 3 + 2] < 0.0015) {
        r = fill.r; g = fill.g; b = fill.b;
      } else if (albedo) {
        r *= albedo[i * 3]; g *= albedo[i * 3 + 1]; b *= albedo[i * 3 + 2];
      } else if (noiseColors && noise) {
        // Contraste: el fBm se concentra cerca de 0,5.
        const t = Math.min(1, Math.max(0, (noise[i] - 0.5) * 2.2 + 0.5));
        const [c0, c1] = noiseColors;
        r *= c0.r + (c1.r - c0.r) * t; g *= c0.g + (c1.g - c0.g) * t; b *= c0.b + (c1.b - c0.b) * t;
      }
      const h = height ? height[i] : p.heightReference;
      color[i * 4] = r;
      color[i * 4 + 1] = g;
      color[i * 4 + 2] = b;
      color[i * 4 + 3] = p.waterBelow !== undefined && h < p.waterBelow ? 1 : 0;
      surf[i * 4] = h;
      surf[i * 4 + 1] = night ? night[i] : 0;
    }

    const globe = this.createGlobe(tier, baked.directions, color, surf);
    tier.addField(globe, true);
    tier.total = count;
    if (kind === 'full') this.globe = globe;

    const light = this.shadow ? (q: Vec3Node) => this.shadow!.lightNode(q) : undefined;
    if (p.atmosphere) {
      const atmosphere = new Atmosphere(
        tier, p.atmosphere, layerCount(p.atmosphere.count), this.sunDirection, this.objectScale, 1, this.airFade, light,
      );
      tier.addField(atmosphere.field, false);
    }

    if (p.clouds) {
      const clouds = await CloudLayer.create(
        tier, p.clouds, layerCount(p.clouds.count), this.sunDirection, this.objectScale, this.cloudFade, light,
      );
      tier.roots.push({ object: clouds.group, spin: true });
      tier.fields.push({ field: clouds.field, scale: 1 });
      tier.updates.push((ctx) => {
        // La turbulencia solo se calcula si las nubes se ven y el planeta no es pequeño en pantalla.
        clouds.update(ctx, tier.visible && this.cloudFade.value > 0.001 && this.radiusPx > 150 && this.inView(ctx, 1.1));
        clouds.disturbance?.update(ctx.renderer, this.localPointerRay(ctx, clouds.field.object), ctx.dt, ctx.nowSeconds, clouds.field.object.count);
      });
    }
    return tier;
  }

  private createGlobe(tier: DetailTier, directions: Float32Array, color: Float32Array, surf: Float32Array): ParticleField {
    const p = this.preset;
    const count = directions.length / 4;
    const dirBuffer = tier.buffer(directions);
    const surfBuffer = tier.buffer(surf);
    const dirAttr = dirBuffer.toAttribute();
    const colorAttr = tier.buffer(color).toAttribute();
    const surfAttr = surfBuffer.toAttribute();

    // Posición de reposo: la misma expresión en el material (atributos) y en la pasada
    // compute de la perturbación (elementos del buffer).
    const restOf = (d: Node<'vec4'>, sf: Node<'vec4'>) =>
      d.xyz.mul(float(1).add(sf.x.sub(p.heightReference).mul(this.relief)));

    const dir = dirAttr.xyz;
    let center = this.condense(restOf(dirAttr, surfAttr), dirAttr.w, tier.appear);

    // Perturbación con el ratón: solo en el detalle completo (32 B más por partícula).
    const field = new ParticleField(count, 'solid', 0.72);
    if (tier.kind === 'full') {
      const disturbance = new Disturbance(count, (i) => restOf(dirBuffer.element(i), surfBuffer.element(i)));
      tier.track(disturbance.resources.buffers, disturbance.resources.computes);
      center = center.add(disturbance.offsetNode());
      tier.updates.push((ctx) =>
        disturbance.update(ctx.renderer, this.localPointerRay(ctx, field.object), ctx.dt, ctx.nowSeconds, field.object.count),
      );
    }

    // Puntos más pequeños que la separación: aire entre partículas.
    const material = field.material;
    const { scale, visibility } = ballSprite({
      center,
      size: field.size,
      minPixels: 1.2,
      objectScale: this.objectScale,
      cull: frontFacing(dir, center, 0.25),
    });
    material.positionNode = center;
    material.scaleNode = scale;
    material.opacityNode = hardDisc();

    // Cada partícula es una micro-esfera: normal por píxel y profundidad real.
    const b = ball();
    material.depthNode = ballDepth(b, scale.mul(this.objectScale).mul(0.5));

    // Luz: sombra a escala de planeta (día/noche) × Lambert de cada bola.
    const n = worldNormal(dir);
    const ndl = n.dot(this.sunDirection);
    const planetLit = ndl.add(0.08).div(1.08).clamp(0, 1);
    const daylight = smoothstep(-0.06, 0.12, ndl);
    const ballLit = max(b.normal.dot(this.sunDirection), 0).mul(daylight);
    const ballAmount = visibility.mul(rockyLook.ballShading);
    const lit = mix(planetLit, ballLit, ballAmount);
    // Oclusión en el borde de cada bola: separa las partículas y da volumen.
    const occlusion = mix(float(1), float(0.5).add(b.facing.mul(0.5)), ballAmount);
    const bead = mix(float(1), b.facing, ballAmount);
    const albedo = colorAttr.xyz;
    let rgb = albedo.mul(lit.add(rockyLook.ambient)).mul(occlusion).mul(rockyLook.dotGain);
    // Eclipse (§5.3): la sombra de la Luna sobre la Tierra, la de la Tierra sobre la Luna…
    const sun = this.shadow?.lightNode(n);
    if (sun) rgb = rgb.mul(sun);

    if (p.textures.night) {
      // Luces de ciudades solo en el lado nocturno, cálidas y en HDR para que hagan bloom.
      const nightSide = float(1).sub(smoothstep(-0.12, 0.06, ndl));
      const lights = smoothstep(0.03, 0.5, surfAttr.y).mul(nightSide).mul(rockyLook.nightLights);
      rgb = rgb.add(vec3(1.0, 0.68, 0.38).mul(lights).mul(bead));
    }

    if (p.waterBelow !== undefined) {
      // Reflejo del Sol en el agua (Blinn-Phong con la normal del planeta: un brillo continuo).
      const v = viewDirection(center);
      const h = this.sunDirection.add(v).normalize();
      let spec = pow(max(n.dot(h), 0), 160).mul(colorAttr.w).mul(planetLit).mul(rockyLook.specular);
      if (sun) spec = spec.mul(sun.x);
      rgb = rgb.add(vec3(1.0, 0.95, 0.85).mul(spec).mul(bead));
    }

    material.colorNode = vec4(rgb, 1);
    return field;
  }

  update(ctx: FrameContext): void {
    super.update(ctx);
    const p = this.preset;
    // Altitud de la cámara en radios (sobre el radio medio).
    const altitude = this.object3d.position.length() / this.sceneRadius - 1;
    const smooth = THREE.MathUtils.smoothstep;

    // El relieve del globo, muy exagerado para verlo desde la órbita, se modera al bajar
    // hasta el de la superficie: así no hay salto cuando aparecen los chunks.
    const ground = p.surface?.relief ?? this.reliefScale.value;
    this.relief.value = ground + (this.reliefScale.value - ground) * smooth(altitude, 0.1, 0.3);
    if (p.clouds) this.cloudFade.value = smooth(altitude, p.clouds.altitude * 0.6, p.clouds.altitude * 1.6);
    if (p.atmosphere) this.airFade.value = smooth(altitude, p.atmosphere.thickness * 0.3, p.atmosphere.thickness * 1.2);
    this.terrainLight.value = 1 - smooth(altitude, 0.01, 0.08);
    this.planetCenter.value.copy(this.object3d.position);
    this.updateSky(altitude);

    this.updateSurface(ctx);
  }

  /** Carga el terreno al enfocar, y activa o retira la superficie según el detalle del globo. */
  private updateSurface(ctx: FrameContext): void {
    const p = this.preset;
    if (!this.terrainParams) return;
    if (this.isFocused && !this.terrain && !this.terrainLoading) {
      this.terrainLoading = true;
      TerrainData.load({
        albedo: p.textures.albedo,
        height: p.surface?.height ?? p.textures.height,
        heightSize: p.surface?.heightSize,
        night: p.textures.night,
        leftLon: p.mapLeftLon,
      }).then((t) => {
        this.terrainLoading = false;
        if (this.isFocused) this.terrain = t;
        else t.dispose();
      });
    }

    const full = this.fullTier;
    const fraction = full ? detailFraction(full.total, this.radiusPx) : 0;
    if (!this.surface && this.terrain && this.isFocused && full && full.appear.value >= 1 && fraction >= SURFACE_ENTER) {
      this.surface = new Surface(this.terrain, this.terrainParams, {
        tint: new THREE.Color(p.tint ?? 0xffffff).multiplyScalar(p.gain ?? 1),
        sunDirection: this.sunDirection,
        objectScale: this.objectScale,
        planetCenter: this.planetCenter,
        terrainLight: this.terrainLight,
        water: p.waterBelow !== undefined,
        light: this.shadow ? (q) => this.shadow!.lightNode(q) : undefined,
      });
      this.spin.add(this.surface.group);
    } else if (this.surface && (!this.isFocused || !full || fraction < SURFACE_EXIT)) {
      // Al subir: el globo vuelve y los chunks se desvanecen antes de soltarse.
      if (!full) {
        this.surface.dispose(ctx.renderer);
        this.surface = null;
      } else {
        this.surface.leave();
      }
    }
    if (this.surface?.faded) {
      this.surface.dispose(ctx.renderer);
      this.surface = null;
    }
    if (!this.isFocused && this.terrain && !this.surface) {
      this.terrain.dispose();
      this.terrain = null;
    }

    if (this.surface) {
      this.object3d.updateMatrixWorld(true);
      const cameraLocal = this.spin.worldToLocal(new THREE.Vector3());
      const sphere = new THREE.Sphere();
      this.surface.update(ctx.renderer, {
        cameraLocal,
        dt: ctx.dt,
        now: ctx.nowSeconds,
        pointer: this.surfacePointerRay(ctx, cameraLocal),
        inFrustum: (center, radius) => {
          sphere.center.copy(center);
          this.spin.localToWorld(sphere.center);
          sphere.radius = radius * this.sceneRadius * 1.05;
          return ctx.frustum.intersectsSphere(sphere);
        },
      });
    }
    // Con la superficie ya fundida del todo, el globo sobra (sus puntos son de decenas de km).
    if (this.globe) this.globe.object.visible = !this.surface?.opaque;
  }

  /**
   * Rayo del cursor para la superficie, en el espacio del grupo que gira (radios): el radio de
   * influencia se mide donde el rayo toca el suelo (el del globo usa la esfera del cuerpo, y a
   * ras de suelo la cámara está dentro de ella).
   */
  private surfacePointerRay(ctx: FrameContext, cameraLocal: THREE.Vector3): (LocalRay & { hit: THREE.Vector3 }) | null {
    const surface = this.surface;
    if (!ctx.pointer || disturbanceLook.strength.value <= 0 || !surface) return null;
    const direction = ctx.pointer.clone().transformDirection(this.spin.matrixWorld.clone().invert());
    // Marcha por el rayo con pasos de media altitud sobre el terreno (la misma función que se
    // dibuja) y bisección al cruzarlo: de canto, el suelo de debajo de la cámara no sirve.
    const hit = new THREE.Vector3();
    const above = (t: number) => {
      hit.copy(direction).multiplyScalar(t).add(cameraLocal);
      return hit.length() - 1 - surface.heightAt(hit.clone().normalize());
    };
    let t0 = 0, f0 = above(0);
    if (f0 <= 0) return null;
    let t1 = 0;
    for (let k = 0; ; k++) {
      if (k === 200 || t0 > 0.2) return null;
      t1 = t0 + Math.max(f0 * 0.5, 1e-9);
      const f1 = above(t1);
      if (f1 <= 0) break;
      t0 = t1;
      f0 = f1;
    }
    for (let k = 0; k < 30; k++) {
      const tm = (t0 + t1) / 2;
      if (above(tm) > 0) t0 = tm;
      else t1 = tm;
    }
    above(t1);
    return { origin: cameraLocal.clone(), direction, radius: disturbanceLook.radiusPx * pixelAngle.value * t1, gain: 1, hit };
  }

  /**
   * Fondo a ras de suelo (§7.4): cielo con el color de la atmósfera de día y, bajo el
   * horizonte, un tono oscuro del suelo que hay debajo (se ve entre las partículas).
   */
  private updateSky(altitude: number): void {
    const sky = this.sky;
    sky.amount = 0;
    if (!this.isFocused || !this.landable) return;
    const smooth = THREE.MathUtils.smoothstep;
    // Desde que la superficie sustituye al globo: entre sus puntos se ve suelo, no espacio.
    sky.amount = 1 - smooth(altitude, 0.12, 0.3);
    if (sky.amount <= 0) return;
    const up = sky.up.copy(this.object3d.position).negate().normalize();
    const d = Math.max(1, altitude + 1);
    sky.dip = -Math.sqrt(1 - 1 / (d * d));
    const sunHeight = up.dot(this.sunDirection.value);
    // En la totalidad de un eclipse el cielo se oscurece y salen las estrellas.
    const eclipse = this.shadow ? this.shadow.lightAt({ x: up.x, y: up.y, z: up.z }) : 1;
    const day = smooth(sunHeight, -0.15, 0.25) * eclipse;

    // Suelo: el albedo bajo la cámara, oscurecido. A ras de suelo, oscuro (cada punto se ve
    // suelto); más arriba cada punto es mucho terreno y el hueco, el suelo que se ve detrás: con
    // el mismo tono oscuro, a 150 km de la Luna salían puntos claros sobre negro.
    const ground = this.groundColor(up);
    const fill = 0.3 + 0.4 * smooth(altitude, 0.002, 0.05);
    sky.ground.copy(ground).multiplyScalar(0.05 + fill * day);
    const air = this.preset.atmosphere;
    if (air) {
      const thick = 1 - smooth(altitude, air.thickness * 0.15, air.thickness * 1.2);
      sky.color.set(air.twilightColor).lerp(new THREE.Color(air.dayColor), smooth(sunHeight, 0, 0.35))
        .multiplyScalar(0.55 * day * thick * Math.min(1, air.strength));
    } else {
      sky.color.setRGB(0, 0, 0);
    }
  }

  /** Albedo (lineal, con tinte) del terreno bajo una dirección de mundo. */
  private groundColor(upWorld: THREE.Vector3): THREE.Color {
    const out = new THREE.Color(this.data.color);
    const tex = this.terrain?.albedo;
    if (!tex) return out;
    const local = this.view.copy(upWorld).applyQuaternion(this.spinQuaternion.clone().invert());
    const lon = Math.atan2(-local.z, local.x), lat = Math.atan2(local.y, Math.hypot(local.x, local.z));
    const { width, height, data } = tex.image as { width: number; height: number; data: Uint8Array };
    const u = 0.5 + lon / (2 * Math.PI) + (-180 - (this.preset.mapLeftLon ?? -180)) / 360;
    const x = ((Math.floor(u * width) % width) + width) % width;
    const y = Math.min(height - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * height)));
    const i = (y * width + x) * 4;
    out.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, THREE.SRGBColorSpace);
    return out.multiply(new THREE.Color(this.preset.tint ?? 0xffffff)).multiplyScalar(this.preset.gain ?? 1);
  }

}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Esfera que solo escribe profundidad, por debajo del suelo más hondo: entre las partículas hay
 * aire y, desde el lado de noche (puntos negros), se veía a través del planeta lo que hay
 * detrás, como el Sol. Así el fondo de los huecos es el del espacio, no lo que tapa el cuerpo.
 */
function occluder(p: RockyPreset): THREE.Mesh {
  const globe = p.reliefScale * (0 - p.heightReference);
  const ground = p.surface ? p.surface.relief * (0 - (p.surface.reference ?? p.heightReference)) : 0;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1 + Math.min(0, globe, ground) - 0.01, 48, 24),
    new THREE.MeshBasicNodeMaterial({ colorWrite: false }),
  );
  return mesh;
}
