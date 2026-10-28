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
├── postfx/              Bloom, tone mapping, efecto warp
└── ui/                  HUD, panel de información, panel de debug
scripts/
├── build-stars.mjs      Catálogo Yale BSC → public/data/stars.bin
└── build-mars-height.py MOLA MEGDR → public/textures/mars/height_3k.png
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
- **Transición animada**: `blend ∈ [0,1]` interpola ambas funciones en unos 2,5 s (`setMode('real')`, tecla `E`), así el cambio de escala es un efecto visual en sí mismo.
- **En los shaders**: anillos, asteroides y órbitas se colocan en la GPU con `ScaleSystem.distanceNode(padre, km)`, la misma función en TSL (uniforms que `update` refresca). Siguen la transición sin recalcular nada en la CPU.
- Los parámetros (`compressedParams`) se ajustan en vivo desde el panel de debug.
- Profundidad y fondo: el plano lejano está a 10¹⁰ y la esfera de estrellas a 10⁹, por encima de todo incluso en escala real (Plutón ≈ 6·10⁶).

## 5. Astronomía (`astro/`)

- `bodies.ts`: tabla de datos de cada cuerpo (radio medio, achatamiento, inclinación del eje, periodo de rotación, elementos orbitales, padre, texturas, tipo de render).
- `kepler.ts`: posición a partir de los **elementos orbitales aproximados de JPL** (*Keplerian Elements for Approximate Positions of the Major Planets*, válidos 1800–2050) con sus tasas por siglo. Resolución de la ecuación de Kepler por Newton-Raphson. Precisión de unos pocos minutos de arco: de sobra para lo visual.
- `moon.ts`: Luna geocéntrica con la fórmula de baja precisión del *Astronomical Almanac* (~0,3°) más la corrección de precesión a J2000.
- `satellites.ts`: resto de lunas con los **elementos medios de JPL** (época J2000) en su plano de Laplace o en el ecuador del planeta, con giro de ápsides y precesión del nodo. Titán lleva ω y M reajustados y Tritón va sin precesión del nodo: con los valores publicados se desviaban 157° y 59° de JPL Horizons.
- `orientation.ts`: **orientación IAU** (WGCCRE 2015, kernel `pck00011.tpc` de NAIF) de todos los cuerpos: polo (α0, δ0 con su deriva) y meridiano principal `W = W0 + Ẇ·d`. Marco del cuerpo: x hacia el nodo Q del ecuador sobre el ecuador ICRF, y hacia el polo; el giro W alrededor de y lleva x a la longitud 0°. Así Urano va de lado, el polo de Saturno (y sus anillos) tiene la inclinación de la fecha y las lunas síncronas miran a su planeta. Las órbitas de las lunas usan el mismo plano.
- `ephemeris.ts`: posición relativa al padre y ángulo de giro.
  - **Tierra**: polo del ecuador J2000 y giro = tiempo sidéreo de Greenwich (GMST) − 90° (su nodo Q está en RA 90°). Verificado con el código de la fase 2 (los mismos valores que con el de la fase 1): punto subsolar en lon +1,53° y lat −0,19° el 20/03/2026 a las 12:00 UTC (≈ ecuación del tiempo), lon −88,5° a las 18:00 y lat ±23,44° en los solsticios.
  - **Luna**: rotación síncrona, lon 0° hacia la Tierra (queda la libración en latitud, real).
  - Resto: W de la IAU.
- **Verificación contra JPL Horizons** (27/10/2026):
  - Posiciones (vectores eclípticos J2000): planetas y Plutón con error angular < 0,08°; Luna 0,19°; Ío, Europa, Ganímedes y Calisto ~0,1°; Caronte 0,15°; Titán < 0,4° y Tritón < 7° (en 2000, 2013 y 2026).
  - Orientación (punto subsolar, con el tiempo de luz desde la Tierra): latitud con error ≤ 0,26° en Mercurio, Venus, Júpiter, Saturno, Urano, Neptuno, Plutón, Ío y Titán, y 1,2° en Marte (su polo IAU tiene términos periódicos que no se incluyen); longitud dentro de ~1° (Horizons da longitudes oeste para los cuerpos de giro directo y este para los retrógrados). El Sol está 8° al sur del plano de los anillos de Saturno, como corresponde tras el cruce de 2025.
  - La Luna muestra a la Tierra su lon 0° (lat −4,9°: libración real).
- Convención de texturas: lon = atan2(−z, x) en el espacio local del cuerpo (este = −z), así un giro positivo alrededor de +y es hacia el este.
- `units.ts`: constantes (UA en km, J2000, segundos por día) y conversión de fecha a siglos julianos.

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
- Coste de memoria: 32 B más por partícula (unos 38 MB para la Tierra), solo en el cuerpo con detalle completo.

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
- **Reparto de las partículas: ruido azul progresivo** (tesela de 6400 puntos con el algoritmo del mejor candidato de Mitchell, desplazada por chunk). Se probaron una rejilla con jitter y la secuencia R2 (guardan filas que, con el suelo de canto, se ven como rayas) y el azar puro (grumos, ruido de televisión).
- **Densidad continua por partícula**: en el shader, cada partícula calcula a su distancia cuántas hacen falta para ~2,6 px de separación; como el orden es progresivo, su índice sirve de umbral y los puntos crecen cuando se dibujan menos. Sin saltos de densidad entre chunks ni entre niveles.
- Al dividir, el padre sigue dibujándose y se funde (0,35 s) mientras aparecen los hijos.
- **Relevo globo ↔ superficie**: la superficie se crea cuando el globo ya no da 2,6 px (fracción de detalle 0,8; sale por debajo de 0,55). Al completarse, los chunks aparecen fundiéndose (0,35 s) con el globo aún visible, que se oculta después; al subir, el globo vuelve y los chunks se desvanecen antes de liberarse. Nubes y atmósfera se desvanecen al bajar por debajo de ellas; la luz pasa de la normal de la esfera a la del terreno entre 0,08 y 0,01 radios de altitud.
- Cada mapa tiene su altura de referencia: el de 8 bits del globo lunar tiene el radio medio en 0,453 y el LOLA de 16 bits en 0,5 (medido); con la misma referencia, el suelo saltaba ~1,5 km en el relevo.

### 7.4 Horizonte (`core/Horizon.ts`)

Entre las partículas del terreno hay aire (el estilo del proyecto): por los huecos se veía el cielo azul (el suelo parecía lavado y cada nivel de detalle se veía de un tono) o las estrellas (en la Luna). El fondo de la escena es ahora un degradado: cielo con el color de la atmósfera de día por encima del horizonte (que baja con la altitud) y, por debajo, un tono oscuro del albedo del suelo bajo la cámara. Las estrellas, los puntos lejanos de los cuerpos, las órbitas, los asteroides y los nombres solo se ven por encima del horizonte (`horizonMask`); las estrellas, además, se apagan de día.

### 7.5 Pendiente

- Corregido en la fase 4: el horizonte con el que se descartan nodos se calcula sobre el **suelo más bajo posible** (`1 − relieve·referencia − ruido`), no sobre el radio medio. Dentro de Valles Marineris la cámara está por debajo del radio medio y el horizonte salía cero: solo quedaban 33 chunks gruesos y se veía el fondo.

- **Gigantes gaseosos**: bajar entre capas de nubes (fase 4). De momento la cámara se queda sobre la cima de las nubes.
- Patrón de mosaico de la tesela de ruido azul en algunos ángulos, y bordes de chunk con un ligero cambio de textura (las octavas finas que tiene cada nivel).
- Tierra: el mapa de alturas es de 8 bits y 4k (10 km por texel); por debajo de eso todo es ruido procedural.

## 8. Tipos de cuerpo (`bodies/`)

Todos implementan `CelestialBody` (`bodies/CelestialBody.ts`): `update(ctx)`, `setLod(nivel)`, `object3d` y `dispose()`.

| Clase | Técnica |
|---|---|
| `Sun` ✅ | 320k partículas. Granulación (Worley) y regiones activas (fractal) calculadas en una **pasada compute** por frame; oscurecimiento del limbo; HDR para el bloom. Corona: 70k partículas aditivas con flujo hacia fuera sin estado. Fase 4: protuberancias. |
| `RockyPlanet` ✅ | Horneado §6.2 + superficie §7 (fase 3). Mercurio, Venus, Tierra, Luna, Marte, las cuatro galileanas, Titán, Tritón, Plutón y Caronte (150k–1,2M partículas en el detalle completo). Lambert con *wrap* para suavizar el terminador; luces de ciudades en HDR solo en el lado nocturno; reflejo Blinn-Phong en el agua. Opciones por cuerpo (`presets.ts`): tinte y ganancia (los muy claros, por debajo del umbral del bloom), color por ruido fractal sin textura (Venus), relleno de las zonas sin datos de los mosaicos con el color medio. |
| `Atmosphere` ✅ | Cáscara fina de partículas aditivas, más densa abajo. El brillo del limbo sale de la geometría (la línea de visión cruza más partículas) más un término de Fresnel. Colores de día y de terminador por cuerpo (Tierra azul y naranja, Marte tenue, Titán una bruma naranja espesa). Solo se dibuja el anillo cercano al limbo: las de cara a la cámara apenas aportan y eran el grueso del coste. |
| `CloudLayer` ✅ | 320k partículas translúcidas repartidas por densidad de la textura de nubes, deriva de la capa respecto a la superficie. Pendiente: turbulencia con *curl noise* en compute y sombra sobre la superficie. |
| `GasGiant` ✅ | Júpiter (mapa de Cassini), Saturno, Urano y Neptuno (perfil de bandas procedural con turbulencia de ruido), achatados. Una pasada compute mueve las partículas (que llevan su color) con dos giros que conservan el área: **bandas rígidas** en sentidos alternos con bordes estrechos (una cizalla continua deshacía el reparto uniforme de los puntos) y **vórtices** que giran enteros alrededor de su centro (la Gran Mancha Roja, la Gran Mancha Oscura de Neptuno). Velocidades artísticas en tiempo real, como la granulación del Sol. Limbo oscurecido y **sombra de los anillos** sobre el globo (rayo hacia el Sol contra el plano del ecuador). |
| `Rings` ✅ | Saturno (C, B, división de Cassini, A con el hueco de Encke, F; 700k partículas) y los anillos finos y oscuros de Urano. Radio muestreado del perfil (en km) y pasado a escena con `distanceNode`, como las lunas. **Velocidad kepleriana** ω = √(GM/r³) integrada en compute (cada partícula su ω), con el paso limitado cuando el tiempo va muy rápido para que no se vuelva ruido. Cara iluminada o en contraluz y **sombra del planeta** sobre los anillos. |
| `AsteroidBelt` ✅ | Cinturón principal (60k, con los huecos de Kirkwood 4:1, 3:1, 5:2, 7:3 y 2:1), troyanos de Júpiter en L4 y L5 (15k) y cinturón de Kuiper (30k). Elementos orbitales aleatorios; una pasada compute avanza la anomalía media con el tiempo simulado y resuelve Kepler (también tras un salto de fecha). Puntos de tamaño fijo, atenuados cuando la cámara está dentro del cinturón. |
| `OrbitLines` ✅ | Órbitas de partículas: puntos muestreados en el tiempo (una vuelta hacia atrás) con las mismas efemérides que mueven cada cuerpo, más brillantes justo detrás de él (estela). Se apagan cerca del cuerpo y cuando la órbita es diminuta en pantalla. |
| `Starfield` ✅ | Yale BSC (9.096 estrellas, `scripts/build-stars.mjs`) a radio 10⁹ alrededor de la cámara, tamaño constante en píxeles. Magnitud → tamaño y brillo, índice B-V → color. Fase 4: Vía Láctea con partículas muestreadas de un panorama. |

## 9. Navegación (`navigation/`)

`CameraRig` mantiene la posición de la cámara en espacio de escena (float64, `origin.cameraScene`), el punto al que mira y la distancia a la superficie (para el plano cercano dinámico). Delega en el modo activo:

- **`OrbitMode`** ✅: arrastrar para girar alrededor del cuerpo enfocado y rueda para acercarse. El zoom es multiplicativo sobre la **altitud sobre el suelo** (km): con terreno por debajo del radio medio (cráteres, Hellas) la distancia al centro no sirve. La distancia al centro es radio + suelo bajo la cámara (`groundHeightKm`, la misma función que dibuja los chunks, con todo el detalle) + altitud, y pasa a escena con `localDistance` del cuerpo enfocado (§4.3). Mínimo: 10 m sobre el suelo en los cuerpos con superficie, 4 % del radio en el resto.
- **A ras de suelo** ✅: por debajo de 0,1 radios la cámara pasa al marco del cuerpo (gira con él: a 10 min/s la Tierra se desplazaría ~70 m por frame bajo los pies) y la mirada se inclina hacia el horizonte con la altitud (escala logarítmica entre 0,05 radios y 3·10⁻⁶), con la vertical del lugar como "arriba". Arrastrar con el botón derecho (o con Mayús) cambia el rumbo y la inclinación; el arrastre normal mueve unos centímetros por píxel a 10 m. La orientación de los cuerpos se calcula antes que la cámara: si no, el suelo se medía con el giro del frame anterior y la cámara quedaba cientos de metros por encima o por debajo.
- **Viaje entre cuerpos** ✅ (en `OrbitMode.focusOn`, no en un modo aparte): dura de 2,4 a 5,5 s según cuánto cambia la escala; la distancia se interpola en escala logarítmica; la dirección gira (slerp) de la de salida a una **llegada por el lado de día** (37° del Sol, algo por encima del plano) y a mitad de viaje la cámara **sube sobre el plano del sistema**, así se ven la salida y la llegada. La mirada pasa del cuerpo de origen al de destino en el primer 40 %. Al arrancar, la cámara también mira el lado de día.
- **Aterrizar y despegar** ✅ (`OrbitMode.land` / `ascend`, botón del título, tecla `T`): bajada animada de 4,5 a 9 s, con la altitud en escala logarítmica, hasta 1,5·10⁻³ radios (5 km en Marte) y con la mirada inclinada hacia el horizonte. Si el cuerpo tiene un lugar destacado (`astro/facts.ts`: Valles Marineris, el cráter Tycho, el Himalaya…), la cámara pasa desde el principio al marco del cuerpo y se desplaza hasta encima de él en la primera mitad. Antes, el motor **adelanta el reloj hasta la media mañana del lugar** si allí es de noche (Newton sobre el ángulo horario con las posiciones y el giro reales de cada fecha de prueba) y pone el tiempo a 1 min/s; lo cuenta un aviso. Arrastrar o usar la rueda cancela la bajada.
- **`FreeFlyMode`** ✅ (tecla `V` o botón): WASD para moverse, R/F para subir y bajar, Q/E para girar sobre el eje, flechas o arrastre para mirar, Mayús para el turbo (×5) y la rueda para la velocidad de crucero.
  - La cámara va **anclada** al cuerpo más cercano: se guarda como (dirección, distancia en km) respecto a él. Así sigue al cuerpo aunque el reloj vaya a 1 año/s, y el cambio de escala la recoloca sola. Cada frame se mueve en escena (relativo al ancla) y vuelve a km con `ScaleSystem.inverseLocalDistance` (bisección en log-distancia: la función es monótona también durante la transición entre escalas).
  - El ancla es el cuerpo con menor distancia en radios propios (lo que se ve), con histéresis (×0,7). Se calcula con la posición de este frame (durante el cambio de escala la Tierra se mueve miles de unidades por frame) y no cambia a mitad de ese cambio. El relevo parte de la posición de escena actual: no hay saltos. El ancla es el cuerpo «enfocado» para el resto del motor (detalle completo, superficie, cielo, nombres).
  - Velocidad = 0,8 × altura sobre el suelo del ancla (en escena) por segundo: cruzar de h a h/e cuesta lo mismo a 10 m que a 1 UA. Colisión con el relieve a 8 m (en km, con `groundHeightKm`); por debajo de 0,1 radios, marco del cuerpo, y por debajo de 0,05, el horizonte se nivela solo.
  - Al salir (`V`, `Esc` o elegir un cuerpo), `OrbitMode.adopt` toma la cámara donde esté (mismo cuerpo, dirección y altitud) y `CameraRig` funde la mirada anterior con la nueva en 0,9 s.
- Selección ✅: clic (sin arrastre) con *ray picking* contra esferas analíticas (`navigation/picking.ts`, radio mínimo de 14 px para cuerpos diminutos), clic en una etiqueta, el navegador de cuerpos o teclas 0–9.

## 10. Post-procesado (`postfx/`)

`RenderPipeline` con:

- **Bloom** ✅ (`bloom()` de `three/addons/tsl/display/BloomNode.js`): el toque artístico principal. Umbral 1,05, por encima del albedo iluminado (≤ 1): solo hacen bloom el Sol (HDR) y las luces de ciudades. Pendiente: se ven anillos concéntricos en el halo del Sol (cadena de mips del bloom).
- **Warp** ✅: estelas radiales hacia los bordes (máximo de 10 muestras hacia el centro: cada estrella deja una línea nítida), aberración cromática y una viñeta fría. Lo gobierna el **progreso del viaje**, no la velocidad de la cámara (en la escala comprimida esa velocidad no significa nada): sin² de la curva del viaje por una intensidad que crece con el cambio de escala (de la Tierra a la Luna apenas se nota; de Neptuno a Mercurio, mucho). En vuelo libre, el turbo hacia delante. El campo de visión se abre hasta 9° en el punto álgido. Va en una rama con un uniform: en reposo cuesta lo mismo que sin él. Con `prefers-reduced-motion`, al 30 %.
- Tone mapping ACES ✅. Pendiente: exposición automática suave.

## 11. UI (`ui/`)

Sin framework: cada componente es una clase con su `el` y un `update(estado)`; `Hud` los coloca y reparte el estado de cada frame. Las cifras se repintan a ~20 Hz y solo si cambian (`setText`). Estilo en `style.css`: cristal oscuro con borde fino y desenfoque (sin desenfoque en calidad baja), acento con el color del cuerpo de referencia (`--body`, realzado para que los oscuros se lean), nombres en Instrument Serif y cifras en Geist Mono tabular (`docs/ASSETS.md`).

- **Título** ✅ (arriba a la izquierda, `FocusTitle`): tipo («Gigante de hielo · 7.º planeta», «Luna de Júpiter»), nombre con una entrada animada, altitud y distancia al Sol (en vuelo libre, velocidad) y las acciones principales: **Aterrizar** (o **Volver a la órbita** cerca del suelo) y **Ficha**.
- **Rendimiento** ✅ (arriba a la derecha, `PerfMeter`): fps, gráfica de los últimos 120 frames con la referencia de 60 fps y el perfil de calidad. Abre los **ajustes** (`SettingsPanel`): calidad (Auto, Baja, Media, Alta, Ultra) con lo que cambia y lo recomendado para el equipo, datos en vivo (fps, partículas, densidad de píxeles, motor) y preferencias (medidor, perturbación del ratón, nombres, órbitas), guardadas en `localStorage`.
- **Tiempo** ✅ (abajo a la izquierda, `TimeBar`): fecha y hora UTC, más lento / pausa / más rápido, nueve marcas para elegir la velocidad de un clic, volver a ahora y saltar a una fecha.
- **Navegador de cuerpos** ✅ (abajo en el centro, `BodyDock`): el Sol y los planetas como esferas de su color (tamaño logarítmico con el radio, Saturno con anillo) y, encima, las lunas del sistema enfocado.
- **Herramientas** ✅ (abajo a la derecha, `Toolbar`): escala comprimida/real, órbitas, nombres, vuelo libre, ajustes, ayuda, ocultar la interfaz (`U`) y pantalla completa.
- **Ficha** ✅ (`InfoPanel`, tecla `I`): descripción, radio, masa, gravedad y velocidad de escape (calculadas con la masa y el radio), rotación, órbita (de los elementos orbitales), inclinación del eje, temperatura, presión y lunas conocidas, con fuentes (NASA NSSDCA y JPL SSD, en `astro/facts.ts`); en vivo, distancia al Sol, tiempo de luz, distancia a la Tierra y a la cámara; y el botón para aterrizar en su lugar destacado.
- **Capas** ✅ (`Overlays`): «Rumbo a…» con el progreso del viaje, avisos breves (calidad ajustada, reloj adelantado al aterrizar), una pista de bienvenida que se va al usar los controles (y no vuelve) y la ayuda de controles (`?`). En vuelo libre, retícula y teclas.
- **Etiquetas** ✅ (`ui/Labels.ts`): nombre de los cuerpos que miden menos de 30 px, clicables. Se ocultan si quedan detrás del disco de un cuerpo más cercano o encima de otra más importante (Sol, luego planetas, luego lunas). Imprescindibles en escala real.
- **Pantalla de carga** ✅ (en `index.html`, para verse antes de que llegue el código): un disco de polvo en órbita kepleriana que se agrupa en anillos según avanza la carga real (motor, horneado de cada cuerpo, estrellas) y se condensa en el protosol al terminar. Mientras tanto `BaseBody.formationHeld` retiene la condensación de los cuerpos: al levantarse el telón todos se forman a la vez desde el polvo, a la vista, y después entra la interfaz.
- **Teclado y foco**: tras un clic con el ratón el botón suelta el foco (así Espacio sigue pausando y no repite el clic); con Tab el foco se queda y se ve. Esc cierra lo último abierto y sale del vuelo libre. `prefers-reduced-motion` quita las animaciones de la interfaz y reduce el warp.
- **Pantallas pequeñas**: por debajo de 1240 px el navegador pasa a su propia fila; por debajo de 760 px todo se apila abajo, el medidor se reduce a los fps y la ficha sale como hoja inferior.
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
