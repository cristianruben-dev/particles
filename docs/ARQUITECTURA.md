# Arquitectura

Documento técnico de cómo está construido el proyecto. Cada módulo de `src/` apunta a la sección de aquí que lo describe.

## 1. Stack

| Pieza | Elección | Motivo |
|---|---|---|
| Bundler | Vite 8 | Arranque instantáneo, HMR, soporte de shaders/assets. |
| Lenguaje | TypeScript 7 (strict) | Tipos para unidades, cuerpos y configuración. |
| Motor 3D | Three.js r186 — `three/webgpu` | `WebGPURenderer` con respaldo automático a WebGL2. |
| Shaders | TSL (`three/tsl`) | Shaders y *compute* escritos en TypeScript; compila a WGSL o GLSL según el backend. |
| Debug | lil-gui | Panel para ajustar parámetros en vivo. |

Imports reales que usamos:

```ts
import * as THREE from 'three/webgpu';          // WebGPURenderer, PointsNodeMaterial, RenderPipeline…
import { Fn, instancedArray, instanceIndex, uniform, texture, … } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
```

> Nota: desde r183 `PostProcessing` se llama `RenderPipeline`. Usamos el nombre nuevo.

## 2. Estructura de módulos

```
src/
├── main.ts              Punto de entrada: crea el Engine y arranca
├── config.ts            Presupuestos de partículas, flags globales
├── core/                Renderer, bucle, tiempo simulado, origen flotante
├── scale/               Conversión km reales → unidades de escena (comprimida/real)
├── astro/               Datos de cuerpos, unidades, órbitas keplerianas, lunas, orientación IAU
├── particles/           Partículas en GPU, horneado en worker, orden progresivo, LOD, perturbación
├── bodies/              Cada tipo de cuerpo celeste (Sol, rocoso, gaseoso, anillos…), niveles de detalle, órbitas
├── surface/             Quadtree de cubo-esfera y chunks para el aterrizaje
├── navigation/          Cámara y modos: vuelo libre, órbita, viaje
├── cosmos/              Capa cósmica: Vía Láctea y, después, galaxias y cúmulos (§14)
├── postfx/              Bloom, tone mapping, efecto warp, tramado
├── audio/               Sonido ambiente procedural (Web Audio)
└── ui/                  HUD, panel de información, panel de debug
scripts/
├── build-stars.mjs              Catálogo Yale BSC → public/data/stars.bin
├── build-constellations.mjs     d3-celestial + Roman 1987 → public/data/constellations.json (§15)
├── build-mars-height.py         MOLA MEGDR → public/textures/mars/height_3k.png
├── build-height-u16.py          LOLA / MOLA → mapas de 16 bits de la superficie
├── build-earth-height.py        ETOPO 2022 → public/textures/earth/height_8k.f16z
└── build-comet-apparitions.mjs  JPL Horizons → src/astro/cometApparitions.ts
```

Regla de dependencias (de abajo arriba): `astro`, `scale` → `core` → `particles` → `bodies`, `surface` → `navigation`, `postfx`, `ui` → `main`. Nada de abajo importa de arriba.

## 3. Bucle principal (`core/Engine.ts`)

Cada frame:

1. `SimClock.tick(dtReal)` → avanza el tiempo simulado (tiempo real, 1 min/s, 10 min/s… 1 semana/s).
2. `layoutSystem` (`core/SystemLayout.ts`): posición verdadera de cada cuerpo (km, float64, vía `astro/ephemeris`) y su posición en **espacio de escena** (float64, vía `ScaleSystem`).
3. `CameraRig` + modo de navegación: posición de la cámara en espacio de escena (`origin.cameraScene`) y hacia dónde mira.
4. Cada cuerpo (`BaseBody.update`): `FloatingOrigin` lo coloca en `(posEscena − posCámara)` → float32 cerca de 0; orientación IAU (polo + giro); dirección al Sol; niveles de detalle y LOD por densidad (§6.3).
5. Órbitas (`OrbitLines`) y cinturones (`AsteroidBelt`), colocados en su padre con el origen flotante.
6. Pasadas *compute* en GPU solo para lo que cambia cada frame y es caro o tiene estado: granulación del Sol, perturbación del ratón, flujo de los gigantes, giro de los anillos y Kepler de los asteroides. Lo que es función directa del tiempo y barato se calcula en el vertex shader.
7. Render + `RenderPipeline` (bloom, tone mapping; warp en fase 4).
8. HUD y etiquetas.

## 4. Precisión numérica y escalas

### 4.1 El problema

El sistema solar mide unos 9.000 millones de km y queremos ver detalles de metros. float32 (lo que usa la GPU) tiene unos 7 dígitos significativos: a 1 UA del origen, el error ronda los 10 km. Sin tratamiento, la Tierra "tiembla" al acercarse.

### 4.2 La solución: verdad en float64 + render relativo a la cámara

- **Toda posición "verdadera" vive en CPU como `number` (float64) en kilómetros**, en marco heliocéntrico eclíptico J2000 (`Vec3d`, `astro/frames.ts`).
- **Espacio de escena en float64**: `layoutSystem` convierte esas posiciones con `ScaleSystem` (§4.3) a ejes de Three.js (y arriba), todavía en float64 (`body.sceneD`). La cámara también vive ahí (`origin.cameraScene`), la escribe el modo de navegación.
- **Origen flotante** (`core/FloatingOrigin.ts`): la cámara de Three.js está siempre en `(0,0,0)`. Cada frame, cada objeto se coloca en `(sceneD − cameraScene)`, restado en float64 y solo después convertido a float32. Lo que está cerca de la cámara siempre tiene máxima precisión. **Solo `ScaleSystem` convierte km a escena y solo `FloatingOrigin` pasa de escena a float32.**
- **Partículas en espacio local**: las partículas de un planeta se guardan relativas al centro del planeta (en radios), nunca en coordenadas heliocéntricas. Solo el `Object3D` del planeta se mueve con el origen flotante.
- **Chunks de superficie** guardan posiciones relativas al centro del chunk (ver §7), así un chunk de 100 m tiene precisión de milímetros.
- **Profundidad**: `WebGPURenderer({ reversedDepthBuffer: true })` cuando está disponible (mejor precisión que el logarítmico y sin coste en el fragment shader); `logarithmicDepthBuffer: true` como respaldo. El plano cercano es el 5 % de la distancia al suelo (hasta 10⁻⁹ unidades: a 10 m de la Tierra comprimida son ~10⁻⁵) y el lejano está en 10¹⁰: con profundidad invertida en float cabe todo.
- **Chunks de superficie**: cada uno es un objeto en su centro (posición en float64) y sus partículas guardan el desplazamiento respecto a él. Three.js compone las matrices en float64 en la CPU y solo sube a la GPU la matriz modelo-vista, con una traslación pequeña (el chunk está cerca de la cámara).

### 4.3 Sistema de escalas (`scale/ScaleSystem.ts`)

Una **única** clase de conversión que todo el código usa. Nadie convierte km a unidades de escena por su cuenta.

```ts
class ScaleSystem {
  radius(km): number;                               // radio de un cuerpo
  localDistance(parentRadiusKm, distanceKm): number; // distancia de un punto a su cuerpo "padre"
}
```

**Modelo jerárquico.** Todo punto se coloca respecto a un cuerpo padre, en la **dirección real** y a la distancia `localDistance(radioPadre, d)`:
- un planeta respecto al Sol,
- una luna respecto a su planeta,
- la cámara respecto al cuerpo enfocado.

Lunas y cámara usan **la misma función**, así que la cámara nunca se cree fuera de la órbita lunar mientras se ve dentro, y nada acaba dentro de un planeta inflado.

- **Real**: `radius = localDistance = km / 1000` (1 unidad = 1.000 km). Lineal y honesta.
- **Comprimida** (por defecto):
  - Radio inflado: `R' = c · r^p` (c = 2,3; p = 0,45). Los cuerpos pequeños se ven y se respeta el orden de tamaños.
  - Distancia: `localDistance = R'padre · h(d / rPadre)`, con un perfil `h(x)` de tres tramos, con valor y pendiente continuos en cada unión (el zoom no da tirones):
    1. **Lineal** hasta `x0` = 2 radios: proporciones reales cerca del cuerpo (altitud, relieve, anillos).
    2. **Logarítmico** hasta `xc` = el tamaño de su sistema de lunas (`BodyData.systemRadii`: la luna o anillo más lejano × 1,3; 20 radios si no tiene; 4 para el Sol): `h = x0 · (1 + ln(x / x0))`. Comprime las lunas para que quepan entre los planetas vecinos.
    3. **Potencia** más allá: `h = hc + (x0 / q) · ((x / xc)^q − 1)` con q = 0,5. Reparte los planetas sin amontonarlos y deja encuadrar todo el sistema.
  - Ajuste (con un script de comprobación): ningún sistema de lunas ocupa más de ⅓ del hueco hasta la órbita vecina, las distancias son monótonas y desde el Sol cabe la órbita de Neptuno. Con el perfil logarítmico único de la fase 1, la Luna (1.040) se salía del hueco hasta Venus (630) y Calisto (2.500) del de Saturno (1.200).
  - Valores actuales: R'☉ = 979, R'⊕ = 118,5, R'♃ = 348; órbitas de Mercurio 17.300, Tierra 28.100, Júpiter 64.900, Saturno 88.100, Neptuno 156.900, Plutón 179.800; Tierra–Luna 1.040, Júpiter–Calisto 2.500, anillo F a 760 del centro de Saturno. Encuadrar Neptuno desde el Sol pide ~180 UA de distancia: el zoom llega a 3·10¹⁰ km (200 UA).
- **Cometas**: su `radiusKm` es un radio de referencia de la coma (6.000 km), no el del núcleo (va en la ficha). Coma y colas son puntos respecto al núcleo y usan la escala del propio cometa, como las lunas la de su planeta: con la del Sol, en su tramo de potencia, la coma se aplastaría el doble en la dirección del Sol que de lado, y la cámara (que enfoca con `localDistance` del cometa) no la vería donde está. Con 6.000 km la coma comprimida mide como la Tierra (R′ = 115) y una cola de 0,3 UA unas 9.000 unidades, un tercio de la órbita de la Tierra: se ve desde el sistema entero.
- **Transición animada**: `blend ∈ [0,1]` interpola ambas funciones en unos 2,5 s (`setMode('real')`, tecla `E`), así el cambio de escala es un efecto visual en sí mismo.
- **En los shaders**: anillos, asteroides y órbitas se colocan en la GPU con `ScaleSystem.distanceNode(padre, km)`, la misma función en TSL (uniforms que `update` refresca). Siguen la transición sin recalcular nada en la CPU.
- Los parámetros (`compressedParams`) se ajustan en vivo desde el panel de debug.
- Profundidad y fondo: el plano lejano está a 10¹⁰ y la esfera de estrellas a 10⁹, por encima de todo incluso en escala real (Plutón ≈ 6·10⁶).

## 5. Astronomía (`astro/`)

- `bodies.ts`: tabla de datos de cada cuerpo (radio medio, achatamiento, inclinación del eje, periodo de rotación, elementos orbitales, padre, texturas, tipo de render).
- `kepler.ts`: posición a partir de los **elementos orbitales aproximados de JPL** (*Keplerian Elements for Approximate Positions of the Major Planets*, válidos 1800–2050) con sus tasas por siglo. Resolución de la ecuación de Kepler por Newton-Raphson. Precisión de unos pocos minutos de arco: de sobra para lo visual.
- `moon.ts`: Luna geocéntrica con **Meeus, cap. 47** (la teoría ELP-2000/82 truncada: 60 términos en longitud y distancia y 60 en latitud, coeficientes de la transcripción de la biblioteca `astronomia`, MIT) y la precesión de la eclíptica de la fecha a la J2000 (Meeus 21.5 y 21.7). Frente a JPL Horizons, 1–5″ (3–10 km) entre 2000 y 2040; la fórmula del *Astronomical Almanac* que había antes se desviaba 0,19° (1.300 km): para los eclipses no servía.
- `units.ts` → **ΔT** (TT − UT, tabla del IERS interpolada; 69 s en 2026): las efemérides (`positionRelativeToParent`) se evalúan en tiempo terrestre y el giro de la Tierra (GMST) en UT. En 69 s la Luna recorre 70 km.
- `satellites.ts`: resto de lunas con los **elementos medios de JPL** (época J2000) en su plano de Laplace o en el ecuador del planeta, con giro de ápsides y precesión del nodo. Titán lleva ω y M reajustados: con los valores publicados se desviaba 157° de JPL Horizons.
- **Tritón** (`fromRotation`): es síncrono y sin oblicuidad, así que su ecuador es el plano de su órbita y Neptuno está en su meridiano principal. Su posición sale de la orientación IAU (con los términos periódicos en N7, que llevan la precesión del plano en 688 años) más un desfase de 2,76° ajustado a Horizons: error < 0,1° de 1950 a 2100 (con elementos medios fijos, < 7°).
- `orientation.ts`: **orientación IAU** (WGCCRE 2015, kernel `pck00011.tpc` de NAIF) de todos los cuerpos: polo (α0, δ0 con su deriva) y meridiano principal `W = W0 + Ẇ·d`, más los términos periódicos (`PoleData.periodic`) de Neptuno y Tritón. Marco del cuerpo: x hacia el nodo Q del ecuador sobre el ecuador ICRF, y hacia el polo; el giro W alrededor de y lleva x a la longitud 0°. Así Urano va de lado, el polo de Saturno (y sus anillos) tiene la inclinación de la fecha y las lunas síncronas miran a su planeta. Las órbitas de las lunas usan el mismo plano.
- `ephemeris.ts`: posición relativa al padre y ángulo de giro.
  - **Tierra**: polo de la IAU con la precesión (α₀ = −0,641°·T, δ₀ = 90° − 0,557°·T: los ζ y θ de la IAU 1976) y giro = tiempo sidéreo de Greenwich (GMST) − 90° − z, porque GMST se mide desde el equinoccio de la fecha y el nodo Q, sobre el ecuador de la fecha, está a 90° + z de él. Con el polo de J2000 y GMST − 90°, en 2026 el meridiano de Greenwich quedaba 0,34° al este (se vio al comparar los eclipses con la NASA). Punto subsolar el 20/03/2026 a las 12:00 UTC: lon +1,87° (la ecuación del tiempo, −7,5 min) y lat −0,04° (el equinoccio es a las 14:46); lon −88,15° a las 18:00 y lat ±23,44° en los solsticios.
  - La posición de la Tierra es la del baricentro Tierra-Luna de JPL menos la Luna / 82,3 (~4.700 km).
  - **Luna**: rotación síncrona, lon 0° hacia la Tierra (queda la libración en latitud, real).
  - Resto: W de la IAU.
- **Verificación contra JPL Horizons** (27/10/2026):
  - Posiciones (vectores eclípticos J2000): planetas y Plutón con error angular < 0,08°; Luna 1–5″ (con Meeus 47, desde la fase 4); Ío, Europa, Ganímedes y Calisto ~0,1°; Caronte 0,15°; Titán < 0,4° (en 2000, 2013 y 2026) y Tritón < 0,1° (38 fechas de 1950 a 2100).
  - Orientación (punto subsolar, con el tiempo de luz desde la Tierra): latitud con error ≤ 0,26° en Mercurio, Venus, Júpiter, Saturno, Urano, Neptuno, Plutón, Ío y Titán, y 1,2° en Marte (su polo IAU tiene términos periódicos que no se incluyen); longitud dentro de ~1° (Horizons da longitudes oeste para los cuerpos de giro directo y este para los retrógrados). El Sol está 8° al sur del plano de los anillos de Saturno, como corresponde tras el cruce de 2025.
  - La Luna muestra a la Tierra su lon 0° (lat −4,9°: libración real).
- Convención de texturas: lon = atan2(−z, x) en el espacio local del cuerpo (este = −z), así un giro positivo alrededor de +y es hacia el este.
- `units.ts`: constantes (UA en km, J2000, segundos por día) y conversión de fecha a siglos julianos.

### 5.1 La Estación Espacial Internacional (`iss.ts`, `sgp4.ts`)

- **SGP4** (`satellite.js`, MIT) sobre el TLE de CelesTrak: es el modelo con el que se publican los elementos y el único que los reproduce (con dos cuerpos y J2 la ISS se desvía cientos de km en horas por el rozamiento). Se importa desde `astro/sgp4.ts`, no del índice del paquete: este reexporta una versión WebAssembly con workers que Vite no sabe empaquetar.
- TEME → marco fijo de la Tierra con el tiempo sidéreo (`eciToEcf`) → eclíptica con la orientación de la Tierra que dibuja la escena (`eclipticFromBodyFixed`): así pasa sobre el sitio correcto del mapa. Verificado con wheretheiss.at: la misma longitud y 0,18° de diferencia en latitud, que es la geodésica frente a la geocéntrica.
- El TLE incluido es del 27/10/2026; al arrancar se pide el del día a CelesTrak (permite CORS) y se guarda 12 h en `localStorage`. A más de 14 días de su época la posición es aproximada (la órbita es la buena, el punto de la órbita no); a más de 60, se propaga sin rozamiento (con él SGP4 la haría reentrar). Antes del 20/11/1998 y después de 2030 no se dibuja.

### 5.2 Cometas (`comets.ts`)

- Ocho: Halley, Encke, 67P, Hale-Bopp, NEOWISE, Tsuchinshan-ATLAS, 3I/ATLAS (interestelar, e = 6,1) y C/2026 A2 (Bok), el que está activo ahora. Elementos osculantes de **JPL Horizons en el perihelio de su aparición más conocida**: con los de la Small-Body Database (otra época) el Halley de 1986 caía a 5 millones de km de su sitio y el Hale-Bopp de 1997 a 10; con estos, a menos de 2.000 km en los ocho.
- **Periódicos** (Halley, Encke y 67P): los elementos de **cada aparición entre 1900 y 2100** (3, 61 y 28), en `cometApparitions.ts`, generado por `scripts/build-comet-apparitions.mjs`: la solución de Horizons de cada aparición observada (`DES=2P;CAP<año`) y, en los huecos, lo que integra Horizons (con los planetas) desde la más cercana. `cometElementsAt` elige la del perihelio más cercano; la órbita dibujada se rehace al cambiar. Con dos cuerpos desde 1986, el Halley volvía en febrero de 2062 en vez del 28 de julio de 2061. Frente a Horizons, lejos de los perihelios: Encke y 67P < 0,02° vistos desde el Sol (0,48° en 1959 y 0,35° en 2031 para el 67P, junto a Júpiter); Halley < 0,6° a 20–35 UA.
- Kepler con **Newton acotado** en cada cónica (elipse con E, hipérbola con H): siempre converge, también con e = 0,9992 junto al perihelio o con e = 1,0001.
- **Actividad** (0–1) con la magnitud total de JPL (M1, K1): el brillo crece como r^−K1. Fija el tamaño de la coma, la longitud de las colas y su brillo.
- Para la cola de polvo, `propagateUniversal`: dos cuerpos desde un estado con variables universales (Curtis, alg. 3.3–3.4).

### 5.3 Eclipses y tránsitos (`eclipses.ts`, `bodies/Shadows.ts`)

- **La geometría de la sombra va siempre en km verdaderos**, nunca en unidades de escena: en la escala comprimida la Luna está ~7 veces más cerca de la Tierra, en proporción a su tamaño, y la sombra caería donde no es (y habría un eclipse cada luna nueva).
- `sunCoverage(punto, ocultador, radio, Sol, radio angular del Sol)`: fracción del disco del Sol tapada. Ángulo entre centros con `atan2(|u × s|, u · s)` (con `acos` no hay precisión: el Sol mide 0,05° visto desde Júpiter) y un `smoothstep` del contacto exterior al interior, por (a/s)² si el ocultador es más pequeño (anular). La misma fórmula en la CPU y en TSL.
- **Ocultadores** de cada cuerpo (`occludersOf`): su planeta y sus lunas, hasta cuatro. La Tierra como ocultador lleva la ampliación de su sombra por la atmósfera (1/85, regla de Danjon) y, lejos de ella (la Luna), deja pasar luz rojiza: la Luna eclipsada se ve cobriza.
- **Tiempo de luz**: el ocultador se toma donde estaba cuando la luz que llega ahora pasó por él (1,3 s de la Luna a la Tierra: 38 km de órbita). En el marco del Sol la luz va en línea recta desde su centro: no hay aberración que añadir.
- **En la GPU** (`EclipseShadow`): por cuerpo, uniforms con la posición de cada ocultador respecto a él en radios del cuerpo y ejes de escena, su radio, la dirección y el radio angular del Sol. Cada partícula (globo, nubes, atmósfera, gigantes y chunks de superficie) evalúa la luz en su dirección, **por vértice** (`varying`); un uniform la salta si ninguna sombra puede tocar el cuerpo. La luz de ciudades no se apaga (no es del Sol).
- **En la CPU**: el punto lejano se apaga (Ío al entrar en la sombra de Júpiter), el cielo a ras de suelo se oscurece y salen las estrellas en la totalidad, y la ISS se apaga en la sombra de la Tierra.
- **Búsqueda** (`findShadowEvents`): muestreo a 1/60 del periodo sinódico, mínimo local del alcance de la penumbra (distancia del receptor al eje / (radio + penumbra)), afinado con sección áurea, y contactos por bisección. Clasificación: total, anular o parcial (umbra o antumbra en el suelo); total, parcial o penumbral de Luna; tránsitos de sombra y eclipses de las cuatro galileanas.
- **Verificación** contra el catálogo de la NASA (GSFC), eclipses de Sol de 2026 a 2028: el lugar del máximo a 3–23 km (57 km en el rasante del 17/02/2026, junto a la Antártida) y la hora a menos de un minuto (10:06:45 UT el 02/08/2027). Los lugares se muestran con latitud geodésica, la de los mapas. Eclipses de Luna de 2026–2028 con el tipo correcto. Tránsito de la sombra de Ío del 28/10/2026 a las 16:00 UT: el eje pasa a 0,02 radios del centro de Júpiter y allí la luz es 0.
- Desde el suelo, en la escala comprimida, la Luna no tapa exactamente al Sol (su paralaje está deformada): la sombra y el oscurecimiento son los reales, el disco solo cuadra en la escala real.

## 6. Partículas en GPU (`particles/`)

### 6.1 Infraestructura

- Cada sistema de partículas usa **buffers de almacenamiento** `vec4` creados con `instancedArray`. Son buffers de GPU que puede escribir un *compute shader* (fase 1: estado de la granulación del Sol; fase 3: chunks de superficie) o rellenarse una vez desde la CPU.
- Render con `THREE.Sprite` + `SpriteNodeMaterial` instanciado (`sprite.count = N`, `positionNode = buffer.toAttribute()`). Cada partícula es un *quad* orientado a cámara con caída suave desde el centro, de modo que se ve como un punto de luz, no un cuadrado. Si hace falta un tamaño fijo en píxeles, se usa `PointsNodeMaterial` con `sizeNode`.
- Mezcla aditiva sin escribir profundidad para cuerpos emisivos (Sol, corona, auras). Para superficies sólidas, recorte con `alphaTest` y escritura de profundidad: así no hay que ordenar partículas y la parte trasera del planeta no se ve a través.
- `ParticleField.ts` encapsula el sprite instanciado, el material y el **tamaño de partícula** (uniform) ligado al número visible (§6.3). Cada cuerpo construye sus nodos TSL; las piezas comunes (disco, escala con mínimo en píxeles, descarte de la cara oculta, normal en mundo) están en `particles/nodes.ts`.
- **Cara oculta**: la escala del sprite se multiplica por 0 cuando la normal se aleja de la cámara (con margen para el limbo y el relieve). El quad colapsa y no se rasteriza.
- **Aspecto de nube de partículas**: los puntos **no se tocan**. Cada capa tiene un tamaño de punto menor que la separación media (`overlap` ≈ 0,6–0,75; superficie 0,72) y el LOD mantiene una separación de ~2,6 px en pantalla (§6.3), así que hay aire entre partículas a cualquier distancia. Como con huecos el planeta cubre menos, cada punto sólido lleva una ganancia de brillo (`rockyLook.dotGain`). Separación y tamaño se ajustan en vivo (`particleLook`).
- **Micro-esferas** (`ball`, `ballDepth`, `ballSprite` en `particles/nodes.ts`): cada partícula sólida se sombrea como una bola, no como un disco plano.
  - La normal sale de la UV del sprite (siempre de cara a la cámara): `(x, y, √(1−x²−y²))` en vista → mundo.
  - Luz: sombra del planeta (día/noche) × Lambert de cada bola, más oclusión en el borde de cada bola.
  - Profundidad por píxel (`depthNode`) de la superficie de la bola: correcta cuando se acercan o se cruzan (por ejemplo, al empujarlas con el ratón).
  - Cuando la partícula mide menos de ~3–10 px en pantalla, el sombreado se funde hacia la luz plana del planeta: si no, sale moiré.
  - Las nubes son bolas translúcidas con borde suave corto (algodón); el Sol, bolas incandescentes más brillantes en el centro.

### 6.2 Horneado (`particles/bake.worker.ts`, `particles/progressive.ts`)

Los datos estáticos de cada partícula se calculan **una vez, en Web Workers** (un pequeño grupo, hasta 4, para hornear cuerpos en paralelo) y se suben a la GPU. No bloquea el hilo principal y funciona igual en WebGPU y WebGL2. Coste medido: ~0,8 s para 1,2M puntos sin texturas y ~1,7 s con dos texturas 4k.

- **Distribución progresiva** (`particles/progressive.ts`):
  - Retícula de **Fibonacci** con jitter de ~0,25 separaciones: la distribución más isótropa, sin filas ni columnas de cerca. Se probó antes la secuencia R2, pero al proyectarla a la esfera se estira ~π veces en longitud y de cerca se veían columnas.
  - **Orden estratificado por niveles**: de una rejilla de cubo proyectado gruesa a otra el doble de fina, se elige al azar un punto libre por celda vacía. Cualquier prefijo cubre la esfera: es la base del LOD (§6.3).
  - **Dentro de cada nivel, orden de bits invertidos** (código de Morton invertido, tipo van der Corput en 2D): un prefijo que se queda a medio nivel rellena la esfera de forma pareja. Con un orden al azar quedaban grumos y huecos visibles en cuanto los puntos casi se tocan (se vio en Júpiter).
- **Distribución por densidad** (nubes): muestreo por rechazo según el brillo de la textura. Sale en orden aleatorio, así que también vale cualquier prefijo.
- **Ruido fractal** (`BakeRequest.noise`): fBm de ruido de valor por punto, estirable en longitud. Da color a los cuerpos sin textura (Venus) y turbulencia a las bandas de los gigantes.
- Mapas cuyo borde izquierdo no está en −180° (los de USGS con 0–360°): `BakeTexture.leftLon` desplaza la u. Una textura que falla no tumba el cuerpo: sale con su color base.
- Para cada punto se calcula lat/lon → UV equirectangular y se muestrea con filtro bilineal:
  - **albedo** (sRGB → lineal) → color,
  - **altura** (valores crudos, `colorSpaceConversion: 'none'`) → desplazamiento radial exagerado (uniform `relief`, ajustable en vivo),
  - **luces nocturnas** (Tierra),
  - **agua** = altura bajo el nivel del mar → reflejo especular.
- Un aleatorio estable por partícula va en `w` del buffer de direcciones (animación de aparición, alturas de capa).
- Fase 3: los chunks de superficie se generarán en GPU (compute) escribiendo en los mismos buffers `vec4`.

### 6.3 Niveles de detalle (`particles/LodManager.ts`)

El criterio es el **tamaño angular** del cuerpo en pantalla (radio proyectado en píxeles), no la distancia bruta.

**Implementado (fase 1): LOD continuo por densidad.** Cada cuerpo dibuja solo las `N = min(total, 2π · radioPx² / separaciónPx²)` primeras partículas (el orden estratificado garantiza que cubren la esfera), con `separaciónPx` ≈ 2,6 px CSS, y el tamaño de punto se ajusta a esa separación. Sin esto, un cuerpo pequeño en pantalla amontona cientos de miles de sprites de tamaño mínimo en unos pocos píxeles: cientos de fragmentos por píxel que la GPU tiene que serializar. En las mediciones el coste crecía al **alejarse** la Tierra (más lejos = más lento); con el LOD se invierte (en una misma tanda: 40 radios ≈ 0,2 ms frente a 2,4 radios ≈ 29 ms, siempre con la GPU en baja frecuencia, ver §12).

**Implementado (fase 2): niveles con detalle bajo demanda** (`bodies/DetailTier.ts`). Con 18 cuerpos, lo que limita no es el dibujo (el LOD por densidad ya lo acota) sino la **memoria y el tiempo de carga**: una capa rocosa ocupa ~80 B por partícula (48 de datos + 32 de la perturbación) y hornear todo al arrancar serían más de 0,5 GB y varios segundos.

| Nivel | Cuándo | Representación | Partículas |
|---|---|---|---|
| **Punto** | < 4 px | Sprite brillante con el color del cuerpo, en la cara que mira a la cámara (`BaseBody`) | 1 |
| **Vista previa** | Siempre en memoria | La misma esfera con pocas partículas, sin perturbación ni flujo | ≤ 40k (cubre hasta ~200 px de radio) |
| **Completo** | Al enfocar el cuerpo o al pasar de 160 px | Todas las capas, con perturbación del ratón, flujo de bandas y anillos densos | 150k–1,2M |
| **Superficie** (fase 3) | Órbita baja → suelo | Completo de fondo + chunks del quadtree alrededor de la cámara (§7) | 2M–6M en total |

- El completo se empieza a hornear **al elegir el cuerpo**, así que se solapa con el viaje. Al llegar entra con la **condensación** (`BaseBody.condense`, 1,4 s) y la vista previa se oculta al terminar.
- Se **libera** cuando lleva 15 s sin foco y por debajo de 60 px (`config.lod`). three r186 no tiene API pública para soltar buffers de almacenamiento: `particles/gpu.ts` usa el registro interno del renderer, aislado en una función. Verificado con `renderer.info.memory`: al alejarse de Júpiter la memoria vuelve exactamente al valor previo (119 → 69 MB), y al volver se hornea de nuevo y se ve sin errores de WebGPU.
- Dentro de cada nivel sigue el LOD por densidad. Las capas con otra área (anillos) llevan su propio factor de fracción.
- Pendiente: presupuesto global de partículas entre cuerpos (hoy no hace falta: solo hay uno o dos completos a la vez).

### 6.4 Interacción con el ratón (`particles/Disturbance.ts`)

Al pasar el cursor por encima, las partículas cercanas se desordenan y luego vuelven a su sitio. Es la primera **simulación con estado**:

- Cada capa del detalle completo (superficies rocosas, globos gaseosos, nubes, superficie del Sol) tiene dos buffers extra por partícula: desplazamiento y velocidad. La vista previa no los lleva.
- Una pasada compute por frame integra un **muelle amortiguado** (Euler semi-implícito) hacia la posición de reposo. Esa posición es la misma expresión TSL que usa el material, leída con `buffer.element(i)` en vez de `toAttribute()`.
- El Engine calcula el rayo del cursor en mundo (la cámara está en el origen) y cada cuerpo lo lleva al espacio local de cada capa (`BaseBody.localPointerRay`), con un radio de influencia en píxeles (`disturbanceLook.radiusPx`) convertido a unidades locales según la distancia.
- Dirección del empuje: fuera del rayo, algo hacia fuera de la superficie y un vector aleatorio por partícula (`hash(instanceIndex)`) que domina (`disorder`), así que se revuelven en vez de abrir un agujero limpio.
- Solo se simula mientras hace falta: con el cursor encima y hasta 4 s después, que es lo que tardan en asentarse.
- **Límites** (fase 4): el radio de influencia no pasa de 0,3 radios del cuerpo y el empuje se apaga entre 140 y 40 px de radio en pantalla (`LocalRay.gain`). Antes, de lejos, los 90 px del cursor abarcaban el cuerpo entero y el empuje (proporcional a ese radio) lo inflaba al doble o al triple.
- Coste de memoria: 32 B más por partícula (unos 38 MB para la Tierra), solo en el cuerpo con detalle completo.
- **Superficie** (fase 4): con el pool entero serían 32 B × 3,7–5,1M partículas. Solo llevan muelle los chunks que toca el círculo del cursor sobre el suelo (32 huecos de 6.400 partículas, 6,5 MB), que lo conservan hasta asentarse (4 s). Si se llenan (barriendo deprisa), se reutiliza el que lleve más tiempo sin cursor, con su estado a cero por una pasada compute (un bit por hueco). Medido a 50 m: en un barrido de 30 posiciones, todos los chunks bajo el cursor tenían hueco. El punto se busca marchando por el rayo con la altura del terreno (`groundHeightKm`) y bisección; origen del rayo y vertical de cada hueco van en un buffer pequeño, restados en float64 respecto al centro del chunk (con `uniformArray` de vec3 en el compute salían NaN).

## 7. Superficie y aterrizaje (`surface/`)

Se baja de forma continua desde la órbita hasta ~10 m del suelo en todos los cuerpos rocosos (salvo Venus, que solo enseña nubes). Verificado con descensos automáticos (900 frames de 2000 km a 10 m) sobre el Himalaya, Tycho y Valles Marineris, y de 1500 km a 10 m en Mercurio, Europa y Titán (los dos últimos sin mapa de alturas), con el tiempo parado y en marcha: ninguna posición no finita, la cámara nunca por debajo de 11 m del suelo dibujado y el plano cercano siempre por delante.

**Huecos** (hojas visibles que acaban el frame sin chunk; se ve el fondo): 0 en reposo con ventanas de 1024×768 a 1920×1080. Al girar 180° de golpe a 10 m, hasta 15 durante 3 frames; en un descenso rápido (100 km → 10 m en 150 frames), hasta 20 durante 9 frames, recuperados en 11.

### 7.1 Cubo-esfera + quadtree (`cubeSphere.ts`, `CubeSphereQuadtree.ts`)

- **Cubo equiangular**: la coordenada de cara u ∈ [−1, 1] es un ángulo y el punto del cubo es `N + tan(u·π/4)·A + tan(v·π/4)·B` (distorsión de área < 1,5×; la proyección gnómica pura llega a 5×). Cada cara es la raíz de un quadtree.
- Cada nodo guarda en float64 su dirección central, su medio ángulo y, la primera vez que hace falta, su altura en el centro y la máxima (centro y esquinas).
- **División por separación de partícula en pantalla**: se divide si pasa de 4 px y se fusiona por debajo de 3,1 px (histéresis). Profundidad máxima 23 (`config.surfaceMaxDepth`): a 10 m de la Tierra hacen falta partículas a ~1,5 cm.
- **Solo lo visible**: frustum de la cámara (los 4 planos laterales) contra la esfera del nodo, y horizonte de la esfera más lo que asoma por detrás la parte más alta del nodo. Con el margen global de montañas o un cono circular salían 5M de partículas a ras de suelo; con esto, ~400 chunks (2,6M).

### 7.2 El terreno: la misma función en CPU y GPU (`terrain.ts`, `TerrainData.ts`)

`altura(dir) = relieve · (mapa(dir) − referencia) + tierra · ruido(dir)`, en radios. La CPU la usa para la colisión de la cámara y la GPU para los chunks: si no coincidieran, la cámara chocaría con un suelo que no es el que se ve.

- **Mapa de alturas**: B-spline cúbica hecha a mano (16 lecturas de una textura r32float) con la misma fórmula en las dos. Con bilineal el terreno eran facetas planas de un texel (10 km en la Tierra) con aristas rectas muy visibles; el filtrado por hardware, además, tiene poca precisión dentro del texel. El mapa se decodifica una vez y la misma matriz va a la CPU y a la GPU.
- **Ruido de valor sobre un hash entero** (u32 que desborda igual en JS y en WGSL): octavas 3D gruesas sobre la dirección (continuas entre caras) y octavas 2D finas sobre la rejilla de cada cara, con la celda calculada en enteros desde el índice del nodo del quadtree. Amplitud = rugosidad × longitud de onda, mayor en las montañas; sin ruido en el agua. Las octavas llegan a dos separaciones de partícula del chunk.
- **Relieve a ras de suelo** (`presets.surface.relief`): la exageración pensada para la órbita (21× en la Tierra: el Everest tendría 190 km) se modera al bajar, en el globo, hasta ~3×. Así no hay salto cuando aparecen los chunks, que usan siempre el valor de suelo.
- **Mapas de 16 bits** para la Luna (LOLA) y Marte (MOLA): binario `.u16` de 4096×2048 (`scripts/build-height-u16.py`).
- **Tierra** (fase 4): ETOPO 2022 de NOAA en **float16**, 8192×4096 (5 km por texel), comprimido con zlib (`.f16z`, 17,5 MB; lo descomprime el navegador con `DecompressionStream`). La CPU guarda los mismos bits que sube a la GPU (textura r16float) y los decodifica con una tabla: la colisión lee el mismo suelo y ocupa la mitad que en float32. La escala es la del mapa de 8 bits del globo (océano = 0, 1 = 6.396 m: ajustada con los dos mapas y lineal también en el Himalaya), así que el relevo no salta: 25 m de media en la escala dibujada (RMS 285 m, los picos más finos). Agua: altura ≤ 0 (`surface.waterBelow`).

**Precisión (lo más delicado).** A profundidad 22 un chunk mide 2,4 m y una partícula ~1,5 cm; en float32 una dirección absoluta tiene ~0,4 m de error en la Tierra. Reglas:

- Todo lo que depende de la posición absoluta se evalúa **respecto al centro del chunk**, precalculado en float64 en la CPU: texel del centro (entero + resto) y su derivada, celda entera y resto de cada octava 3D, índices del nodo para las octavas 2D.
- El desplazamiento de cada partícula se calcula sin restar vectores casi iguales: `normalize(q0 + δ) − normalize(q0) = δ/L − q0·x / (L·L0·(L + L0))`.
- **Parte entera y fracción siempre por separado**: sumadas (un texel ~700), la fracción en float32 solo tenía unos pocos valores dentro de un chunk y salían terrazas de 7 cm (se veían como rayas a ras de suelo).
- El mapa se interpola **restando la altura del centro a cada texel antes de sumar** (restar al final dos alturas de ~0,6 deja escalones de ~2 mm que la normal convierte en sombras).
- `tan` de ángulos diminutos con serie de Taylor: la función rápida de la GPU tiene error absoluto (~10⁻⁴ en Apple).
- Diferencia medida entre la altura de la GPU y la de la CPU: ~4 cm en los chunks cercanos (frente a 10 m de altitud mínima) y 15–50 cm en los lejanos.

### 7.3 Chunks (`Surface.ts`, `SurfaceChunk.ts`, `ChunkPool.ts`)

- **Pool**: buffers para 576 chunks de 80×80 partículas (3,7M, ~180 MB) con posición relativa al centro, color y normal del terreno. A 10 m del suelo hacen falta ~300 con una ventana de 1024×768, ~450 con 1440×900 y ~490 con 1920×1080. Con el pool por encima del 80 %, los umbrales de división suben y el detalle se degrada en vez de atascarse. Se reserva al activar la superficie y se libera al salir (verificado: 321 → 183 MB al subir).
- **Prioridad**: primero las hojas visibles sin chunk (huecos), después las divisiones, de las partículas más separadas a las menos; hasta 32 chunks por frame.
- **Generación en GPU**: una pasada compute por frame para hasta 32 chunks, con los datos de cada uno en un buffer de trabajos. Normal del terreno por diferencias finitas, color del albedo real oscurecido en las pendientes, luces nocturnas y agua.
- **Colocación**: cada chunk es un `Sprite` hijo del grupo que gira con el cuerpo, en su centro (float64); todos comparten un material con uniforms por objeto (`onObjectUpdate`: hueco del pool, separación, aparición).
- **Reparto de las partículas: ruido azul progresivo** (tesela toroidal de 6400 puntos con el algoritmo del mejor candidato de Mitchell, desplazada por chunk y con una de las 8 simetrías del cuadrado: con solo desplazarla se veía un mosaico en algunos ángulos). Se probaron una rejilla con jitter y la secuencia R2 (guardan filas que, con el suelo de canto, se ven como rayas) y el azar puro (grumos, ruido de televisión).
- **Última octava fina fundida**: cada chunk suma las octavas 2D hasta dos separaciones de su partícula, así que entre dos niveles cambiaba la textura. El generador guarda aparte lo que sube la última (en `offset.w`) y la normal sin ella; el material las funde con la fracción dibujada (entra entre 0,4 y 1), que depende de la distancia y no del nivel. Bajo la cámara la fracción es 1: el suelo es el mismo que el de la colisión. Para que quepan dos normales, van en octaédrico (`normal` = dos vec2) y el agua y las luces nocturnas, 8 bits cada una, en `color.w`.
- **Densidad continua por partícula**: en el shader, cada partícula calcula a su distancia cuántas hacen falta para ~2,6 px de separación; como el orden es progresivo, su índice sirve de umbral y los puntos crecen cuando se dibujan menos. Sin saltos de densidad entre chunks ni entre niveles.
- Al dividir, el padre sigue dibujándose y se funde (0,35 s) mientras aparecen los hijos.
- **Relevo globo ↔ superficie**: la superficie se crea cuando el globo ya no da 2,6 px (fracción de detalle 0,8; sale por debajo de 0,55). Al completarse, los chunks aparecen fundiéndose (0,35 s) con el globo aún visible, que se oculta después; al subir, el globo vuelve y los chunks se desvanecen antes de liberarse. Nubes y atmósfera se desvanecen al bajar por debajo de ellas; la luz pasa de la normal de la esfera a la del terreno entre 0,08 y 0,01 radios de altitud.
- Cada mapa tiene su altura de referencia: el de 8 bits del globo lunar tiene el radio medio en 0,453 y el LOLA de 16 bits en 0,5 (medido); con la misma referencia, el suelo saltaba ~1,5 km en el relevo.

### 7.4 Horizonte (`core/Horizon.ts`)

Entre las partículas del terreno hay aire (el estilo del proyecto): por los huecos se veía el cielo azul (el suelo parecía lavado y cada nivel de detalle se veía de un tono) o las estrellas (en la Luna). El fondo de la escena es ahora un degradado: cielo con el color de la atmósfera de día por encima del horizonte (que baja con la altitud) y, por debajo, un tono oscuro del albedo del suelo bajo la cámara: 0,3 × la luz de día a ras de suelo y 0,7 desde 0,05 radios (a 150 km de la Luna, con el tono de ras de suelo, salían puntos claros sobre negro: luminancia 54 en los huecos frente a 140–165 en los puntos; ahora 92). Las estrellas, los puntos lejanos de los cuerpos, las órbitas, los asteroides y los nombres solo se ven por encima del horizonte (`horizonMask`); las estrellas, además, se apagan de día.

### 7.5 Pendiente

- Corregido en la fase 4: el horizonte con el que se descartan nodos se calcula sobre el radio medio o, si el suelo bajo la cámara está más bajo, sobre ese suelo. Dentro de Valles Marineris la cámara está por debajo del radio medio y el horizonte salía cero: solo quedaban 33 chunks gruesos y se veía el fondo. Medido a 10 m (1024×768, calidad alta): sin cambios fuera de los cañones (Tierra: 0 huecos en reposo y 360–367 chunks con el cálculo viejo y el nuevo).

- **Gigantes gaseosos**: bajar entre capas de nubes (fase 4). De momento la cámara se queda sobre la cima de las nubes.
- Corregidos en la fase 4: el mosaico de la tesela y el cambio de textura en los bordes de chunk (§7.3) y el mapa de la Tierra (§7.2). Por debajo de 5 km, en la Tierra, todo sigue siendo ruido procedural; falta la carga por teselas.

## 8. Tipos de cuerpo (`bodies/`)

Todos implementan `CelestialBody` (`bodies/CelestialBody.ts`): `update(ctx)`, `setLod(nivel)`, `object3d` y `dispose()`.

| Clase | Técnica |
|---|---|
| `Sun` ✅ | 320k partículas. Granulación (Worley) y regiones activas (fractal) calculadas en una **pasada compute** por frame; oscurecimiento del limbo; HDR para el bloom. Corona: 70k partículas aditivas con flujo hacia fuera sin estado. **Protuberancias** (fase 4): 14 arcos magnéticos anclados en latitudes activas, con plasma que cae de una pata a otra en hilos retorcidos (42k partículas, todo en el vertex shader: un nlerp y unos senos), rojas como en H-alfa; sobre el disco casi no suman, como los filamentos. |
| `RockyPlanet` ✅ | Horneado §6.2 + superficie §7 (fase 3). Una esfera que solo escribe profundidad, por debajo del suelo más hondo (fase 4): desde el lado de noche, entre los puntos negros se veía lo que hay detrás del planeta (el Sol, la Luna). Sombras de eclipse (§5.3) en globo, nubes, atmósfera y superficie. Mercurio, Venus, Tierra, Luna, Marte, las cuatro galileanas, Titán, Tritón, Plutón y Caronte (150k–1,2M partículas en el detalle completo). Lambert con *wrap* para suavizar el terminador; luces de ciudades en HDR solo en el lado nocturno; reflejo Blinn-Phong en el agua. Opciones por cuerpo (`presets.ts`): tinte y ganancia (los muy claros, por debajo del umbral del bloom), color por ruido fractal sin textura (Venus), relleno de las zonas sin datos de los mosaicos con el color medio. |
| `Atmosphere` ✅ | Cáscara fina de partículas aditivas, más densa abajo. El brillo del limbo sale de la geometría (la línea de visión cruza más partículas) más un término de Fresnel. Colores de día y de terminador por cuerpo (Tierra azul y naranja, Marte tenue, Titán una bruma naranja espesa). Solo se dibuja el anillo cercano al limbo: las de cara a la cámara apenas aportan y eran el grueso del coste. |
| `CloudLayer` ✅ | 320k partículas translúcidas repartidas por densidad de la textura de nubes, deriva de la capa respecto a la superficie. Turbulencia con ***curl noise*** (fase 4): una pasada compute calcula el rotacional de un ruido 3D que cambia despacio (seis lecturas) y desplaza cada partícula sobre la capa, sin amontonarlas; solo con las nubes visibles y el planeta de más de 150 px de radio. De cerca, cuando cada partícula mide más de 7–35 px, las bolas pasan a vellones suaves, más grandes y tenues que se funden entre sí. Pendiente: sombra sobre la superficie. |
| `GasGiant` ✅ | Júpiter (mapa de Cassini), Saturno, Urano y Neptuno (perfil de bandas procedural con turbulencia de ruido), achatados. Una pasada compute mueve las partículas (que llevan su color) con dos giros que conservan el área: **bandas rígidas** en sentidos alternos con bordes estrechos (una cizalla continua deshacía el reparto uniforme de los puntos) y **vórtices** que giran enteros alrededor de su centro (la Gran Mancha Roja, la Gran Mancha Oscura de Neptuno). Velocidades artísticas en tiempo real, como la granulación del Sol; por encima de `flow.calm` no hay flujo. Limbo oscurecido y **sombra de los anillos** sobre el globo (rayo hacia el Sol contra el plano del ecuador). Fase 4: **bruma** detrás de los puntos (una de cada seis partículas como disco grande, suave y tenue, sin escribir profundidad: solo asoma entre ellos y de cerca ya no se ve negro); **manchas** de color (`spots`) y el **hexágono** del polo norte de Saturno (a 77°, fijo respecto al giro, con su vórtice central), con bandas cada 10° de latitud según las imágenes de Cassini. |
| `Rings` ✅ | Saturno (C, B, división de Cassini, A con el hueco de Encke, F; 700k partículas) y los anillos finos y oscuros de Urano. Radio muestreado del perfil (en km) y pasado a escena con `distanceNode`, como las lunas. **Velocidad kepleriana** ω = √(GM/r³) integrada en compute (cada partícula su ω), con el paso limitado cuando el tiempo va muy rápido para que no se vuelva ruido. Cara iluminada o en contraluz y **sombra del planeta** sobre los anillos. |
| `AsteroidBelt` ✅ | Cinturón principal (60k, con los huecos de Kirkwood 4:1, 3:1, 5:2, 7:3 y 2:1), troyanos de Júpiter en L4 y L5 (15k) y cinturón de Kuiper (30k). Elementos orbitales aleatorios; una pasada compute avanza la anomalía media con el tiempo simulado y resuelve Kepler (también tras un salto de fecha). Puntos de tamaño fijo, atenuados cuando la cámara está dentro del cinturón. |
| `OrbitLines` ✅ | Órbitas de partículas: puntos muestreados en el tiempo (una vuelta hacia atrás) con las mismas efemérides que mueven cada cuerpo, más brillantes justo detrás de él (estela). Se apagan cerca del cuerpo y cuando la órbita es diminuta en pantalla. |
| `Comet` ✅ | Coma (densidad más concentrada que 1/r², algo hacia el Sol, verdosa hacia fuera), **cola de polvo con síndinas** (la CPU propaga con dos cuerpos una rejilla de 24 edades × 6 β, granos soltados hace τ días que notan la gravedad del Sol rebajada en (1 − β) por la presión de la luz; el shader interpola: la cola se curva y se queda atrás en el plano de la órbita) y **cola de iones** recta, en contra del Sol con la aberración del viento solar (400 km/s), azul, con filamentos que ondulan. Todo aditivo, de tamaño fijo en píxeles, y el flujo con una fase reducida en la CPU. Coma y colas se colocan respecto al núcleo en km y pasan a escena con `distanceNode` **del propio cometa** (§4.3). |
| `Station` ✅ | La ISS de partículas (~60.000, en orden aleatorio para el LOD): armadura en celosía de 109 m, ocho alas solares de 35 × 11,6 m que giran con las juntas alfa y beta hacia el Sol (en el shader, con tres uniforms), radiadores, módulos (Zvezda, Zariá, Unity, Destiny, Harmony, Columbus, Kibo, Tranquility, la Cúpula, Nauka) y las alas rusas. Actitud de vuelo +XVV (proa hacia la velocidad, +z a la Tierra). Celdas azules con destellos y kapton dorado por detrás; se apaga en la sombra de la Tierra, enrojece al cruzar el terminador y desde abajo la ilumina la Tierra. Se oculta con el reloj por encima de 1 h/s si no está enfocada (da vueltas a saltos). |
| `Starfield` ✅ | Yale BSC (9.096 estrellas, `scripts/build-stars.mjs`) a radio 10⁹ alrededor de la cámara, tamaño constante en píxeles. Magnitud → tamaño y brillo, índice B-V → color. Fase 5: pasa a la capa cósmica, con la Vía Láctea del panorama (§14). |

## 9. Navegación (`navigation/`)

`CameraRig` mantiene la posición de la cámara en espacio de escena (float64, `origin.cameraScene`), el punto al que mira y la distancia a la superficie (para el plano cercano dinámico). Delega en el modo activo:

- **`OrbitMode`** ✅: arrastrar para girar alrededor del cuerpo enfocado y rueda para acercarse. El zoom es multiplicativo sobre la **altitud sobre el suelo** (km): con terreno por debajo del radio medio (cráteres, Hellas) la distancia al centro no sirve. La distancia al centro es radio + suelo bajo la cámara (`groundHeightKm`, la misma función que dibuja los chunks, con todo el detalle) + altitud, y pasa a escena con `localDistance` del cuerpo enfocado (§4.3). Mínimo: 10 m sobre el suelo en los cuerpos con superficie, 4 % del radio en el resto.
- **A ras de suelo** ✅: por debajo de 0,1 radios la cámara pasa al marco del cuerpo (gira con él: a 10 min/s la Tierra se desplazaría ~70 m por frame bajo los pies) y la mirada se inclina hacia el horizonte con la altitud (escala logarítmica entre 0,05 radios y 3·10⁻⁶), con la vertical del lugar como "arriba". Arrastrar con el botón derecho (o con Mayús) cambia el rumbo y la inclinación, hasta ~68° sobre el horizonte (fase 6: antes se quedaba justo por debajo y no se veían las constelaciones altas); el arrastre normal mueve unos centímetros por píxel a 10 m. La orientación de los cuerpos se calcula antes que la cámara: si no, el suelo se medía con el giro del frame anterior y la cámara quedaba cientos de metros por encima o por debajo.
- **Viaje entre cuerpos** ✅ (en `OrbitMode.focusOn`, no en un modo aparte): dura de 2,4 a 5,5 s según cuánto cambia la escala; la distancia se interpola en escala logarítmica; la dirección gira (slerp) de la de salida a una **llegada por el lado de día** (37° del Sol, algo por encima del plano) y a mitad de viaje la cámara **sube sobre el plano del sistema**, así se ven la salida y la llegada. La mirada pasa del cuerpo de origen al de destino en el primer 40 %. Al arrancar, la cámara también mira el lado de día.
- **Aterrizar y despegar** ✅ (`OrbitMode.land` / `ascend`, botón del título, tecla `T`): bajada animada de 4,5 a 9 s, con la altitud en escala logarítmica, hasta 1,5·10⁻³ radios (5 km en Marte) y con la mirada inclinada hacia el horizonte. Si el cuerpo tiene un lugar destacado (`astro/facts.ts`: Valles Marineris, el cráter Tycho, el Himalaya…), la cámara pasa desde el principio al marco del cuerpo y se desplaza hasta encima de él en la primera mitad. Antes, el motor **adelanta el reloj hasta la media mañana del lugar** si allí es de noche (Newton sobre el ángulo horario con las posiciones y el giro reales de cada fecha de prueba) y pone el tiempo a 1 min/s; lo cuenta un aviso. Arrastrar o usar la rueda cancela la bajada.
- **`FreeFlyMode`** ✅ (tecla `V` o botón): WASD para moverse, R/F para subir y bajar, Q/E para girar sobre el eje, flechas o arrastre para mirar, Mayús para el turbo (×5) y la rueda para la velocidad de crucero.
  - La cámara va **anclada** al cuerpo más cercano: se guarda como (dirección, distancia en km) respecto a él. Así sigue al cuerpo aunque el reloj vaya a 1 año/s, y el cambio de escala la recoloca sola. Cada frame se mueve en escena (relativo al ancla) y vuelve a km con `ScaleSystem.inverseLocalDistance` (bisección en log-distancia: la función es monótona también durante la transición entre escalas).
  - El ancla es el cuerpo con menor distancia en radios propios (lo que se ve), con histéresis (×0,7). Se calcula con la posición de este frame (durante el cambio de escala la Tierra se mueve miles de unidades por frame) y no cambia a mitad de ese cambio. El relevo parte de la posición de escena actual: no hay saltos. El ancla es el cuerpo «enfocado» para el resto del motor (detalle completo, superficie, cielo, nombres).
  - Velocidad = 0,8 × altura sobre el suelo del ancla (en escena) por segundo: cruzar de h a h/e cuesta lo mismo a 10 m que a 1 UA. Colisión con el relieve a 8 m (en km, con `groundHeightKm`); por debajo de 0,1 radios, marco del cuerpo, y por debajo de 0,05, el horizonte se nivela solo.
  - Al salir (`V`, `Esc` o elegir un cuerpo), `OrbitMode.adopt` toma la cámara donde esté (mismo cuerpo, dirección y altitud) y `CameraRig` funde la mirada anterior con la nueva en 0,9 s.
- `focusOn` admite una **dirección de llegada** (los eclipses y tránsitos miran hacia la sombra; los cometas, desde encima del plano de su órbita) y una distancia; si no, la de `BodyData.viewRadii` (300 radios en los cometas) o 3,2.
- Selección ✅: clic (sin arrastre) con *ray picking* contra esferas analíticas (`navigation/picking.ts`, radio mínimo de 14 px para cuerpos diminutos), clic en una etiqueta, el navegador de cuerpos o teclas 0–9.

## 10. Post-procesado (`postfx/`)

`RenderPipeline` con:

- **Bloom** ✅ (`bloom()` de `three/addons/tsl/display/BloomNode.js`): el toque artístico principal. Umbral 1,05, por encima del albedo iluminado (≤ 1): solo hacen bloom el Sol (HDR) y las luces de ciudades.
- **Tramado** ✅ (fase 4): los anillos que se veían en el halo del Sol no eran de la cadena de mips sino escalones de 8 bits de un degradado muy suave sobre negro (a lo largo de un radio, el valor 1 duraba 40 px). El tone mapping y el espacio de color se aplican a mano (`renderOutput`, con `outputColorTransform = false`) y después se suma medio nivel de ruido (*interleaved gradient noise*): el ancho medio de los escalones del halo bajó de 6,4 a 2,6 px.
- **Warp** ✅: estelas radiales hacia los bordes (máximo de 10 muestras hacia el centro: cada estrella deja una línea nítida), aberración cromática y una viñeta fría. Lo gobierna el **progreso del viaje**, no la velocidad de la cámara (en la escala comprimida esa velocidad no significa nada): sin² de la curva del viaje por una intensidad que crece con el cambio de escala (de la Tierra a la Luna apenas se nota; de Neptuno a Mercurio, mucho). En vuelo libre, el turbo hacia delante. El campo de visión se abre hasta 9° en el punto álgido. Va en una rama con un uniform: en reposo cuesta lo mismo que sin él. Con `prefers-reduced-motion`, al 30 %.
- Tone mapping ACES ✅. Pendiente: exposición automática suave.

## 11. UI (`ui/`)

Sin framework: cada componente es una clase con su `el` y un `update(estado)`; `Hud` los coloca y reparte el estado de cada frame. Las cifras se repintan a ~20 Hz y solo si cambian (`setText`). Estilo en `style.css`: cristal oscuro con borde fino y desenfoque (sin desenfoque en calidad baja), acento con el color del cuerpo de referencia (`--body`, realzado para que los oscuros se lean), nombres en Instrument Serif y cifras en Geist Mono tabular (`docs/ASSETS.md`).

- **Título** ✅ (arriba a la izquierda, `FocusTitle`): tipo («Gigante de hielo · 7.º planeta», «Luna de Júpiter»), nombre con una entrada animada, altitud y distancia al Sol (en vuelo libre, velocidad) y las acciones principales: **Aterrizar** (o **Volver a la órbita** cerca del suelo) y **Ficha**.
- **Rendimiento** ✅ (arriba a la derecha, `PerfMeter`): fps, gráfica de los últimos 120 frames con la referencia de 60 fps y el perfil de calidad. Abre los **ajustes** (`SettingsPanel`): calidad (Auto, Baja, Media, Alta, Ultra) con lo que cambia y lo recomendado para el equipo, datos en vivo (fps, partículas, densidad de píxeles, motor) y preferencias (medidor, perturbación del ratón, nombres, órbitas), guardadas en `localStorage`.
- **Tiempo** ✅ (abajo a la izquierda, `TimeBar`): fecha y hora UTC, más lento / pausa / más rápido, nueve marcas para elegir la velocidad de un clic, volver a ahora y saltar a una fecha.
- **Navegador de cuerpos** ✅ (abajo en el centro, `BodyDock`): el Sol y los planetas como esferas de su color (tamaño logarítmico con el radio, Saturno con anillo) y, encima, las lunas del sistema enfocado (con la ISS en el de la Tierra). Al final de la fila, **Cometas** abre su grupo (también se abre al enfocar uno). La ISS y los cometas usan filas propias en la ficha (`BodyFacts.rows`): su «gravedad en la superficie» no diría nada.
- **Herramientas** ✅ (abajo a la derecha, `Toolbar`): escala comprimida/real, órbitas, nombres, constelaciones (abre su panel, §15.3), vuelo libre, eventos, sonido (`M`), ajustes, ayuda, ocultar la interfaz (`U`) y pantalla completa.
- **Eventos** ✅ (`EventsPanel`, tecla `C` o el botón del eclipse en las herramientas): próximos o anteriores eclipses de Sol y de Luna (tipo, máximo, lugar o duración), tránsitos de sombra y eclipses en Júpiter, y el paso de los cometas por el perihelio, calculados con las mismas efemérides (§5.3). «Ir» pone el reloj un poco antes (1 min/s; 10 min/s en Júpiter; 6 h/s y 4 días después del perihelio en los cometas) y lleva la cámara mirando a la sombra; en los eclipses centrales, «Desde el suelo» aterriza en el lugar del máximo. Se rehace al moverse mucho la fecha, como mucho cada 1,5 s.
- **Ficha** ✅ (`InfoPanel`, tecla `I`): descripción, radio, masa, gravedad y velocidad de escape (calculadas con la masa y el radio), rotación, órbita (de los elementos orbitales), inclinación del eje, temperatura, presión y lunas conocidas, con fuentes (NASA NSSDCA y JPL SSD, en `astro/facts.ts`); en vivo, distancia al Sol, tiempo de luz, distancia a la Tierra y a la cámara; y el botón para aterrizar en su lugar destacado.
- **Capas** ✅ (`Overlays`): «Rumbo a…» con el progreso del viaje, avisos breves (calidad ajustada, reloj adelantado al aterrizar), una pista de bienvenida que se va al usar los controles (y no vuelve) y la ayuda de controles (`?`). En vuelo libre, retícula y teclas.
- **Etiquetas** ✅ (`ui/Labels.ts`): nombre de los cuerpos que miden menos de 30 px, clicables. Se ocultan si quedan detrás del disco de un cuerpo más cercano o encima de otra más importante (Sol, luego planetas, luego lunas). Imprescindibles en escala real.
- **Pantalla de carga** ✅ (en `index.html`, para verse antes de que llegue el código): un disco de polvo en órbita kepleriana que se agrupa en anillos según avanza la carga real (motor, horneado de cada cuerpo, estrellas) y se condensa en el protosol al terminar. Mientras tanto `BaseBody.formationHeld` retiene la condensación de los cuerpos: al levantarse el telón todos se forman a la vez desde el polvo, a la vista, y después entra la interfaz.
- **Teclado y foco**: tras un clic con el ratón el botón suelta el foco (así Espacio sigue pausando y no repite el clic); con Tab el foco se queda y se ve. Esc cierra lo último abierto y sale del vuelo libre. `prefers-reduced-motion` quita las animaciones de la interfaz y reduce el warp.
- **Pantallas pequeñas**: por debajo de 1640 px el navegador pasa a su propia fila (en una sola hacen falta ~1.600 px; con el corte en 1240 la barra de herramientas se salía por la derecha); por debajo de 760 px todo se apila abajo, el medidor se reduce a los fps y la ficha sale como hoja inferior.
- **Debug** ✅ (lil-gui, solo con `?debug`): exposición, bloom, brillo del Sol y corona, luces nocturnas, reflejo, nubes, atmósfera, estrellas, aspecto de las partículas y del ratón, flujo y bola de los gigantes, brillo de anillos, asteroides y órbitas, relieve por cuerpo y parámetros de la escala comprimida. Con `?debug` también quedan `window.engine` y los *timestamps* de GPU (`engine.renderer.resolveTimestampsAsync('render')`).

## 12. Rendimiento

- Objetivo: **60 fps con unos 4M de partículas** en una GPU integrada moderna (Apple M1 o similar) con WebGPU. En WebGL2 el presupuesto se reduce automáticamente a la mitad.
- Lo que se mueve se calcula en la GPU: en el vertex shader si es barato y depende solo del tiempo, y en *compute* (una vez por partícula) si es caro, como el ruido de Worley del Sol. Nunca ruido caro por vértice: cada sprite tiene 4 vértices y lo multiplicaría por 4. La CPU solo calcula unas decenas de posiciones de cuerpos por frame.
- El LOD por densidad (§6.3) es lo que más pesa: el coste real está en el número de sprites diminutos que caen sobre los mismos píxeles, no en el total de partículas.
- **Perfiles de calidad** ✅ (`core/Quality.ts`):

  | Perfil | Densidad de píxeles | Separación | Pool de superficie | Bloom | MSAA | Cristal |
  |---|---|---|---|---|---|---|
  | Baja | 1 | 3,4 px | 320 chunks | 1/4 | no | no |
  | Media | 1,5 | 3,0 px | 448 | 0,35 | sí | sí |
  | Alta | 2 | 2,6 px | 576 | 1/2 | sí | sí |
  | Ultra | 3 | 2,2 px | 800 | 1/2 | sí | sí |

  Lo que más pesa es el relleno de píxeles: la densidad de píxeles (×4 de 1 a 2) y la separación entre partículas (su número va con 1/separación²). La superficie deriva de la separación sus umbrales de división y fusión y la densidad del shader, así que el perfil también actúa a ras de suelo. En caliente cambian densidad, separación, bloom y cristal; el pool, en el siguiente descenso; el MSAA, al recargar (el pase de escena lo fija al compilarse; la UI lo avisa).
- **Detección**: sin WebGPU o en un móvil, baja; NVIDIA o AMD, ultra; Intel o ≤ 4 núcleos, media; Qualcomm/ARM, baja; Apple y desconocidas, alta (el objetivo de este apartado). En **Auto** se parte de ahí y solo se baja (nunca se sube), si la mediana del tiempo de frame pasa de 1/42 s dos ventanas de 3 s seguidas, sin contar los 6 s tras arrancar o cambiar de perfil (shaders y horneados) ni los tirones de más de 250 ms, y solo con la página visible: con el panel oculto o con frames avanzados a mano el medidor no mide nada real. `?quality=alta` (o baja, media, ultra) fija el perfil y desactiva el ajuste: para medir de forma reproducible.
- La densidad de píxeles por debajo de la nativa reescala la imagen y en Retina se ve borrosa: por eso alta usa 2.
- La profundidad por píxel de las micro-esferas desactiva el *early-z*. Como `alphaTest` ya lo desactivaba, el coste extra es moderado, pero hay que tenerlo en cuenta al medir.
- Medición de la fase 1: no hay una cifra fiable. Las pruebas se hicieron con la app sin ventana visible y macOS baja la frecuencia de la GPU; los *timestamps* variaron de 0,2 a 60 ms para la misma vista. Hay que medir con la ventana delante (fps del HUD).
- Texturas grandes (heightmaps de 16k) se cargan bajo demanda y con un nivel de baja resolución primero.

## 13. Sonido (`audio/Soundscape.ts`)

Procedural con Web Audio: sin archivos ni licencias. El Engine le pasa cada frame el gigante gaseoso que más se ve (su radio angular), el del Sol, el cuerpo de referencia con la altitud y el warp.

- **Vacío**: silencio.
- **Gigantes**: zumbido grave (fundamental, sierra desafinada, subarmónico y quinta por un paso bajo que respira con un LFO lento) más un retumbo de ruido marrón. Sube con el **tamaño aparente** (lo que se ve, no los km: en la escala comprimida es lo que cuenta) y cada uno tiene su tono (Júpiter 36 Hz, Saturno 41, Neptuno 47, Urano 52).
- **Sol**: rugido de ruido marrón y chasquidos (ruido agudo abierto a ráfagas por otro ruido muy lento, rectificado con un `WaveShaper`).
- **Viento**: dentro de la atmósfera, más fuerte cuanto más abajo, con ráfagas (dos LFO de ritmos distintos sobre la ganancia y otro sobre el filtro). Tenue y agudo en Marte, grave en Titán, denso en Venus y en las cimas de las nubes de los gigantes; nada en los cuerpos sin aire.
- **Warp**: un soplo cuyo paso banda sube con la intensidad y un barrido grave.
- Las modulaciones van por ganancias que valen 0 con su voz apagada: un LFO no suena solo. Todo cambio de nivel o tono es `setTargetAtTime` (sin chasquidos) y la salida pasa por un compresor.
- **Arranque**: el navegador solo deja sonar tras un gesto; el contexto se crea en el primer clic o tecla. Con la pestaña oculta o el sonido apagado se suspende (al apagar, tras bajar el volumen).
- **Control**: tecla `M`, botón del altavoz en las herramientas y «Sonido ambiente» en los ajustes; se guarda en `localStorage` (`particles.sound`) y por defecto está activado.

## 14. Más allá del sistema solar (fase 5, en curso)

Fase 5: alejarse desde el sistema solar hasta la Vía Láctea entera, el Grupo Local y los cúmulos de galaxias. Hechos: la capa cósmica, el marco galáctico, el relevo, la Vía Láctea vista desde fuera (primera versión) y el zoom con la tecla `G`. Lo demás es diseño.

### 14.1 Por qué una capa aparte

Estirar `ScaleSystem` y `OrbitMode` hasta distancias galácticas no funciona:

- En la escala real (1 unidad = 1.000 km) la esfera de estrellas está a 10⁹ (≈ 6.700 UA) y el plano lejano a 10¹⁰ (≈ 1 año luz): más allá, el Sol queda detrás del cielo y luego se recorta.
- `inverseLocalDistance` busca hasta 10¹³ km (~1 año luz): el vuelo libre se rompería.
- El zoom llega a 3·10¹⁰ km (`MAX_DISTANCE_KM`, 200 UA) y la rueda multiplica por ~1,16 en cada golpe: unos 115 golpes hasta ver la galaxia entera y otros 40 hasta Virgo.
- Tampoco hace falta la escala comprimida: Andrómeda está a ~25 diámetros de la Vía Láctea, mientras que la Tierra está a ~11.700 diámetros del Sol. En el cosmos la escala real ya se ve bien, y es la única.

### 14.2 La capa cósmica

- **Verdad en km float64, como el resto** (los catálogos se convierten al cargar). A 10²² km (Laniakea) el float64 resuelve ~10⁶ km: de sobra. Las posiciones cósmicas nunca se mezclan con las de la escena solar.
- **Cámara cósmica** = posición del Sol en la galaxia + desplazamiento verdadero de la cámara respecto al Sol (en km, el que guarda el modo de navegación según §9). Dentro del sistema solar ese desplazamiento es despreciable (200 UA = 0,003 años luz): el cielo cósmico es el que se ve desde el Sol.
- **`ScaleSystem.cosmic`**: km → años luz, solo para lo que sube a la GPU. Así se mantiene la regla de §4.2 (solo `ScaleSystem` convierte km).
- **Se dibuja como `Starfield`** (`cosmos/CosmicLayer.ts`): cada partícula se proyecta sobre una cáscara de radio 5·10⁹ alrededor de la cámara (por fuera de la escena solar entera durante el relevo, dentro del plano lejano), en su dirección real. Tamaño angular = diámetro / distancia real, entre 1,4 y 7 px. Por debajo del mínimo el brillo baja con el área (brillo superficial constante, como en el cielo de verdad); por encima del máximo sube con el área, hasta ×4: de cerca, una nube de millones de estrellas no se ve como una mancha de cientos de píxeles sino como un punto más brillante, y la galaxia se resuelve en "estrellas" al acercarse. Al ser aditivo no hay que ordenar ni hace falta otra pasada: bloom, warp, `horizonMask` y el apagado de día y en la totalidad funcionan igual. La escena solar queda siempre delante, porque el relevo (§14.4) la mantiene dentro de la cáscara.
- **Precisión**: la resta centro de la galaxia − cámara se hace en float64 en la CPU por objeto y sube como uniform; las partículas guardan su posición relativa al centro de su galaxia (años luz, ejes de escena), como las de los planetas. Con la cámara en el Sol, a 8,2 kpc del centro, el error de float32 en las partículas cercanas es de ~100 UA: invisible.
- **Desvanecido cercano**: cada partícula del modelo representa millones de estrellas. Se apaga entre 8 y 2 diámetros suyos de la cámara; allí mandarán el panorama (desde dentro) y las estrellas con distancia.
- **Polvo** (las franjas oscuras): no se puede sumar. Va en una capa con mezcla `dst · (1 − src)` (`CustomBlending`), que tampoco necesita orden, y absorbe más el azul. Oscurece también lo que hay delante; de lejos no se nota.
- **Orden de dibujo** (`renderOrder`): galaxia −4, polvo −3, Sol-estrella −2, estrellas de Yale −1. Todo va antes que lo translúcido de la escena solar (nubes, atmósferas), que así lo atenúa.
- **LOD** por densidad, como en §6.3: el modelo sale de un worker (`cosmos/galaxy.worker.ts`) en orden aleatorio, que vale para cualquier prefijo. Se dibujan 1,5 partículas por píxel² del disco en pantalla (mínimo 30.000) y cada una lleva la luz de las que faltan.
- La galaxia se genera la primera vez que la cámara pasa de 100 UA del Sol o se pulsa `G` (~0,5 s en el worker, 760.000 partículas, ~24 MB) y se queda en memoria.
- Módulo: `src/cosmos/`, al nivel de `bodies/` en la regla de dependencias (§2).

### 14.3 Marco galáctico

- Galáctico ↔ ecuatorial J2000 en `astro/frames.ts` (polo norte galáctico en AR 192,859°, Dec +27,128°; longitud galáctica del polo norte celeste 122,932°) y de ahí `equatorialToEcliptic` → `eclToScene`, como las estrellas.
- El Sol está a 8,18 kpc del centro (GRAVITY 2019) y ~21 pc sobre el plano (`astro/galaxy.ts`). Así el centro queda a b = −0,15° (Sagitario A* está a −0,05°: no se nota).
- Verificado con un script: la matriz es ortonormal (error 6·10⁻¹⁷); (l, b) = (0°, 0°) da AR 266,405°, Dec −28,936°; el polo norte galáctico, AR 192,860°, Dec +27,128°; el plano galáctico va 60,2° inclinado sobre la eclíptica.
- El plano galáctico está inclinado ~60° respecto a la eclíptica: al alejarse, el «arriba» de la cámara gira hacia el norte galáctico para que la galaxia se vea plana, y vuelve a la eclíptica al entrar.
- **Comprobación** (como la lon 0° de los mapas): desde el Sol, el centro galáctico (AR 266,40°, Dec −28,94°) cae entre Escorpio y Sagitario, entre las estrellas de Yale. Un panorama del cielo se ve **desde dentro**, así que el este va al revés que en el mapa de un planeta: comprobarlo con la Gran Nube de Magallanes y el Saco de Carbón junto a la Cruz del Sur.

### 14.4 Los escalones

| Escalón | Cámara a | Qué se ve | Datos (candidatos) |
|---|---|---|---|
| Vía Láctea desde dentro | Dentro del sistema solar | La banda en el cielo, con sus nubes oscuras | Panorama: NASA Deep Star Maps (coordenadas ecuatoriales) o el mapa de Gaia (galácticas) |
| Salir del sistema solar | 1.000 UA – 1.000 años luz | El Sol se vuelve una estrella más; con estrellas en 3D, las constelaciones se deforman | HYG (~120.000 estrellas con distancia, opcional) |
| Vía Láctea desde fuera | ~100.000 años luz | Barra, brazos, polvo y «Estás aquí» | Modelo con parámetros publicados; cúmulos globulares de Harris; Nubes de Magallanes |
| Grupo Local | ~5 millones de años luz | Andrómeda, Triángulo y las enanas | McConnachie 2012 (~100 galaxias) |
| Cúmulos y red cósmica | 50–500 millones de años luz | Filamentos y nudos de galaxias | 2MRS (~44.000 galaxias) o Cosmicflows-4 (~56.000 con distancia) |

1. **Vía Láctea desde dentro** (lo que §8 tenía pendiente): las estrellas puntuales del panorama se quitan con un filtro de mediana en el script (ya están en Yale) y el resto se muestrea por densidad, como las nubes. Los sprites son suaves y sí se solapan: es un brillo, no un sólido. Si aun así se ve granulado, el brillo difuso va como textura en el fondo (`horizonBackground`, hoy negro en el espacio) y las partículas encima.
2. **Relevo sistema solar ↔ cosmos** ✅ (`core/Handoff.ts`) por la distancia en **km reales** de la cámara al Sol, entre 1.000 y 10.000 UA en escala logarítmica. Vale igual en la escala comprimida y en la real. A 1.000 UA, en la comprimida, la órbita de Neptuno aún ocupa ~10° de pantalla; a 10.000 UA, ~3°. En la real, 10.000 UA son 1,5·10⁹ unidades: la escena solar sigue dentro de la cáscara.
   - `handoff.solar` (1 → 0) multiplica lo que se ve de lejos (puntos de los cuerpos, órbitas, cinturones y cometas) y el propio Sol con su corona. A 0 se ocultan los cuerpos y los cinturones, no hay nombres ni clic sobre ellos y el vuelo libre no arranca; el que ya vuela se queda en 1.000 UA.
   - El Sol-estrella se dibuja sin prueba de profundidad: en el relevo, el Sol de la escena solar (opaco y cada vez más oscuro) está delante en la misma dirección y lo taparía. Solo se ve fuera del sistema solar, donde nada sólido puede quedar en medio.
   - Más allá, la cámara de la escena solar se queda en el borde (`localDistance` de 10.000 UA) y la de la capa cósmica sigue en km.
   - El Sol queda como una estrella de la capa cósmica (magnitud absoluta 4,83, con un brillo mínimo para seguir marcando dónde está). Entra a la vez que sale la escena solar.
   - Medido frame a frame con `G` desde la Tierra: la dirección al Sol de la capa cósmica y la de la escena solar coinciden en todo el relevo (0,0000° en la escala comprimida y 0,0000015° en la real).
   - Las estrellas de Yale están en el infinito y lejos del Sol enseñarían las mismas constelaciones. Provisionalmente se apagan entre 0,15 y 1,5 años luz mientras entra el modelo de la galaxia. Con distancias (HYG) pasarán a 3D con magnitud aparente = absoluta + 5·log₁₀(d / 10 pc) en el shader.
   - Opcional: la nube de Oort (2.000–100.000 UA), muy tenue.
3. **Vía Láctea desde fuera** (primera versión ✅, `cosmos/milkyWayModel.ts`): modelo procedural con parámetros publicados.
   - Disco exponencial fino (escala de 2,6 kpc) y grueso, vacío dentro de la barra. Bulbo en caja y barra de 4,6 kpc de semilongitud a 27° de la línea Sol–centro, con el extremo cercano hacia l > 0. Halo tenue.
   - Cuatro brazos espirales logarítmicos de arrastre, en dos pares simétricos (paso de 11,5° y de 10°). Están ajustados para que, en la dirección del Sol, crucen donde los sitúan las paralajes de máseres (Reid et al. 2019): Norma 4,0, Escudo 5,4, Sagitario 6,9, Perseo 10,2 y Exterior 12,0 kpc (medidos: 4,4, 5,4, 6,9, 10 y 12,4). Más el brazo de Orión (8,5 kpc, un tramo de −25° a 40°), con el Sol en su borde interior.
   - Estrellas jóvenes azules en los brazos (la mitad en asociaciones OB), regiones HII rosadas, y estrellas viejas y amarillas en el bulbo; el disco es más denso sobre los brazos. Polvo en grumos y franjas en el borde interior (cóncavo) de los brazos, más una capa fina en el plano.
   - La luz de cada partícula va repartida por su área: las pequeñas (HII) brillan más por píxel con la misma luz.
   - «Sol · estás aquí» y «Centro galáctico» con `MarkerLabels` (`ui/Labels.ts`).
   - Pendiente: cúmulos globulares reales (Harris, ~150), las Nubes de Magallanes, los nombres de los brazos y el fundido con el panorama. Desde dentro, de momento se ve el propio modelo como puntos.
4. **Grupo Local**: catálogo de McConnachie (2012), con posición, distancia, tamaño y tipo. Cada galaxia usa una **plantilla de partículas por tipo** compartida (espiral, barrada, elíptica, irregular, enana esferoidal), orientada con su inclinación y su ángulo de posición. Andrómeda y M33 llevan modelo propio y son enfocables (órbita, sin entrar).
5. **Cúmulos y red cósmica**: cada galaxia es un punto con el color de su tipo, y las K que más miden en pantalla llevan un impostor con su plantilla (ranuras fijas: K × partículas por plantilla acota el coste). Con distancias sacadas del corrimiento al rojo, los cúmulos se estiran hacia nosotros (**dedos de Dios**): a los miembros de un cúmulo conocido se les reduce la dispersión radial a la que tienen en el cielo, o se usan las distancias de Cosmicflows, con su error. Nombres: Virgo, Coma, el Gran Atractor, el Vacío Local y Laniakea.

### 14.5 Navegación e interfaz

- **Tecla `G`** ✅ (`Engine.toggleGalaxy`): con el Sol enfocado, el zoom llega a 3·10¹⁸ km (~320.000 años luz); con otro cuerpo sigue en 200 UA, porque en la escala comprimida su dirección al Sol no es la real. `G` viaja al Sol si hace falta y anima la altitud en escala logarítmica (`OrbitMode.zoomTo`, el mismo mecanismo que el aterrizaje) hasta ~127.000 años luz, por encima del disco y del lado del Sol: así el Sol queda debajo del centro, como en los mapas. Fuera del sistema solar la rueda va tres veces más rápida.
- **`OrbitMode.cameraKm`** ✅: la cámara verdadera (km respecto al Sol) sale de la altitud en km, no de la posición de escena, que más allá del relevo se queda en el borde. En los viajes y en vuelo libre sale de la posición de escena con `inverseLocalDistance`, que ahora busca hasta 10²⁴ km.
- **Pivote y «arriba»** ✅: el centro de la órbita pasa del Sol al centro galáctico entre 2.000 y 40.000 años luz; la mirada sigue siendo −dir, solo se desplaza la cámara. El «arriba» gira hacia el norte galáctico entre 300 y 5.000 años luz, calculado aparte del marco del arrastre. Por encima de 3.000 años luz (2.000 al bajar) arrastrar gira alrededor del polo galáctico (marco `galaxy`), sin que la imagen dé un giro.
- **Vuelta** ✅ (`Engine.leaveCosmos`): desde el cosmos, todo viaje (elegir un cuerpo, «Ir» a un eclipse o a un cometa, o `G` otra vez) vuelve primero a 600 UA y después hace lo pedido entero, también aterrizar. El viaje parte de la posición de escena, que allí se queda en el borde: sin esto la cámara saltaría de golpe. Verificado desde 120.000 años luz: a la Tierra, al Halley de 2061 (el mayor encogimiento por frame, un 7 %) y al eclipse de 2027 «desde el suelo» (aterriza a 10 km), sin posiciones no finitas.
- Pendiente: `OrbitMode` orbitará también otras referencias cósmicas (Andrómeda, M87) con la misma lógica en km.
- **Escalones** (Sistema solar · Vecindario · Vía Láctea · Grupo Local · Virgo · Red cósmica) como botones, con el viaje logarítmico de `focusOn` y el warp.
- Distancias en UA → años luz → millones de años luz ✅ (`ui/format.ts`). Pendiente: la barra de escala.
- En los niveles cósmicos se ocultan el vuelo libre y la barra de tiempo: la galaxia tarda ~230 millones de años en dar una vuelta y no hay nada que animar con el reloj. Si se anima algo (el giro del modelo), es artístico y con la fase reducida en la CPU.
- Ficha para la Vía Láctea, Andrómeda y los cúmulos.

### 14.6 Límites

- La Vía Láctea vista desde fuera es un **modelo hecho con datos**: nadie la ha fotografiado desde fuera. Las posiciones de las demás galaxias son reales; su forma es una plantilla por tipo con su orientación real.
- Rendimiento: con la galaxia llenando la pantalla, el aditivo es caro (sobredibujo). Sprites pequeños, LOD por densidad y un tope de impostores.
- Licencias: los catálogos y panoramas de §14.4 son candidatos; hay que comprobar su licencia y registrarla en `docs/ASSETS.md` antes de usarlos.

## 15. Constelaciones (fase 6)

Las 88 constelaciones de la IAU sobre el cielo de Yale: figuras, límites y nombres, con su ficha, el resaltado bajo el ratón y en cuál está cada cuerpo visto desde la Tierra. Módulos: `astro/constellations.ts` (datos, `constellationAt`, fechas), `bodies/Constellations.ts` (dibujo), `core/SkyController.ts` (preferencias, ratón, seleccionada), `ui/ConstellationLabels.ts` y `ui/ConstellationPanel.ts`; en `Engine`, solo la carga, el clic, las teclas y «mirar hacia».

### 15.1 Datos (`scripts/build-constellations.mjs` → `public/data/constellations.json`)

- **Figuras**: las de la página de constelaciones de la IAU, en la versión de d3-celestial (Olaf Frohn, BSD-3; `constellations.lines.json`, J2000). 89 trazos: la Serpiente va partida en cabeza y cola, las dos con el mismo nombre. Cada vértice se ajusta a la estrella de Yale más cercana (≤ 0,05°): así la línea acaba en el punto que se dibuja y se detecta cualquier espejo o salto en ±180°.
- **Límites**: Delporte (1930), en la versión J2000 de Davenhall y Leggett (CDS VI/49) que trae d3-celestial (`constellations.borders.json`: cada borde compartido una sola vez). Los bordes son paralelos y meridianos **de B1875**: en J2000 son curvas. Si dos vértices seguidos están a más de 1°, se densifica en B1875 (AR o Dec constante) y cada punto se precesa a J2000 (1.152 tramos); un arco de círculo máximo cortaría, por ejemplo, el casquete de la Osa Menor a +88°. Ese casquete venía con puntos intermedios interpolados en J2000, hasta 0,45° por debajo del paralelo: los que pasan de +87,4° en B1875 se devuelven a +88°.
- **¿En qué constelación cae una dirección?** (`constellationAt`): la tabla de Roman (1987, CDS VI/42, tomada de astropy, BSD-3). La dirección J2000 se precesa a B1875 (IAU 1976, Lieske) y vale la primera fila con Dec ≥ Dec mínima y AR mínima ≤ AR < AR máxima.
- **Nombres**: en español (d3-celestial, `es`), con su posición para la etiqueta y su rango (1–3, por tamaño y brillo); el latino, el genitivo y la abreviatura. Lo escrito a mano (qué representa, si es del zodiaco) va en `astro/constellations.ts`.
- **Por constelación** (en el script): área exacta con la tabla de Roman (en B1875, entre dos declinaciones de la tabla cada intervalo de AR es de una sola constelación: suma de ΔAR · Δsen Dec; en total 41.252,96 grados²), estrella más brillante de Yale con su nombre propio, número de estrellas a simple vista (V ≤ 6) y extensión en declinación (del límite densificado).
- **Estrellas con nombre**: las ~100 más brillantes con nombre de la IAU (`starnames.json` de d3-celestial, cruzado con Yale por posición), en español donde lo hay (Sirio, Arturo, Espiga…).
- Todo en J2000 y sin movimiento propio: en 1900–2100 la precesión mueve las estrellas ~1,4° por siglo respecto al equinoccio de la fecha, pero las figuras van con las estrellas (las dos en J2000), así que cuadran siempre.

### 15.2 Dibujo (`bodies/Constellations.ts`)

- **Como `Starfield`**: partículas aditivas a radio 10⁹ (en el infinito: el objeto queda en el origen, que es la cámara), tamaño constante en píxeles con `pixelAngle`, `renderOrder` −1 y sin escribir profundidad.
- **Líneas de puntos**, como las órbitas: cada tramo se muestrea con slerp (nunca interpolando AR y Dec) cada 0,2° (con el campo de visión de 50°, unos 4 px), sin tramos repetidos. Junto a cada estrella, un hueco de su radio en pantalla más 3 px (cada punto guarda su distancia a la estrella más cercana y el tamaño de esta, y el shader lo compara con `pixelAngle`). 20.562 partículas las figuras, 14.420 los límites (cada 0,32°) y 1.600 las guías (cada 0,45°): nada frente a los millones de los cuerpos.
- Tenues: por debajo del umbral del bloom (1,05). Los límites, más tenues y espaciados, en otro tono.
- **Aparición**: al activarlas, los puntos se encienden desde las estrellas hacia el centro de cada tramo (un uniform de progreso; cada punto guarda su distancia a la estrella más cercana).
- **Máscaras**, las mismas que las estrellas: `aboveHorizon` a ras de suelo, `starLook.brightness` (de día y en la totalidad), el relevo hacia el cosmos (`1 − galaxy` con `STARS_FADE_*`; a 1 se ocultan) y la cuenta de partículas del HUD.
- **Resaltado**: cada punto lleva el índice de su constelación; un uniform con la seleccionada y otro con la que está bajo el ratón la iluminan sin tocar los buffers.

### 15.3 Nombres e interacción

- `ui/ConstellationLabels.ts`, aparte de `Labels` y por debajo de sus nombres: uno por constelación (dos para la Serpiente) en la dirección de su etiqueta, en versalitas y tenue, y los de las estrellas hasta la magnitud 1,9. Primero las estrellas y después las constelaciones por rango, sin solaparse; ocultos bajo el horizonte (`sky.up` y `sky.dip`, como `Labels`), detrás del disco de un cuerpo y de día. Los de las constelaciones se pulsan. Con las figuras apagadas (`K`) solo queda el de la seleccionada.
- **Panel** (`ConstellationPanel`, en el lado derecho como la ficha y los eventos): interruptores de las seis capas, buscador sin tildes, filtros (todas, zodiaco, norte, sur y, a ras de suelo, las que están sobre el horizonte) y la ficha, con el paso del Sol por las de la eclíptica (Meeus 25 menos la precesión desde J2000) y el mes en que culmina a medianoche.
- **Bajo el ratón**: el rayo del cursor (la cámara está en el origen: basta su dirección) pasa a ecuatoriales J2000 y `constellationAt` dice cuál es. Clic en el cielo vacío (sin cuerpo debajo) la selecciona y abre su ficha.
- **Mirar hacia una constelación** (`OrbitMode.lookToward`): conserva la altitud (`focusOn` la cambiaría). En órbita la cámara mira hacia −dir, así que rodea el cuerpo hasta dejar la constelación a un ángulo α del centro: el radio angular del cuerpo más 12°, sin pasar del borde de la pantalla en esa dirección (menos 7°), por el giro más corto. A ras de suelo gira el rumbo y la inclinación de la mirada; el giro que se ve es rumbo × t (t = cuánto se inclina la mirada con la altitud), así que el camino corto se busca en ese ángulo. Si está bajo el horizonte, un aviso.
- **En qué constelación está un cuerpo** visto desde la Tierra: dirección en **km verdaderos** (`positionKm(cuerpo) − positionKm(Tierra)`, ejes de escena → eclíptica → ecuatorial), nunca en escena: en la escala comprimida las direcciones entre cuerpos no son las reales (la misma razón que en §5.3).

### 15.4 Límites

- Las figuras son una convención (las de la IAU y Sky & Telescope); hay otras igual de válidas. Las ilustraciones mitológicas quedan fuera por licencias.
- Fuera del sistema solar las constelaciones no significan nada: se apagan con las estrellas de Yale. Deformarlas al alejarse necesita las estrellas en 3D (HYG, §14.4).
