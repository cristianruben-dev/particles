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
├── astro/               Datos de cuerpos, unidades, órbitas keplerianas
├── particles/           Partículas en GPU, horneado en worker, orden progresivo, LOD
├── bodies/              Cada tipo de cuerpo celeste (Sol, rocoso, gaseoso, anillos…)
├── surface/             Quadtree de cubo-esfera y chunks para el aterrizaje
├── navigation/          Cámara y modos: vuelo libre, órbita, viaje
├── postfx/              Bloom, tone mapping, efecto warp
└── ui/                  HUD, panel de información, panel de debug
scripts/
└── build-stars.mjs      Catálogo Yale BSC → public/data/stars.bin
```

Regla de dependencias (de abajo arriba): `astro`, `scale` → `core` → `particles` → `bodies`, `surface` → `navigation`, `postfx`, `ui` → `main`. Nada de abajo importa de arriba.

## 3. Bucle principal (`core/Engine.ts`)

Cada frame:

1. `SimClock.tick(dtReal)` → avanza el tiempo simulado (tiempo real, 1 min/s, 10 min/s… 1 semana/s).
2. `layoutSystem` (`core/SystemLayout.ts`): posición verdadera de cada cuerpo (km, float64, vía `astro/ephemeris`) y su posición en **espacio de escena** (float64, vía `ScaleSystem`).
3. `CameraRig` + modo de navegación: posición de la cámara en espacio de escena (`origin.cameraScene`) y hacia dónde mira.
4. Cada cuerpo (`BaseBody.update`): `FloatingOrigin` lo coloca en `(posEscena − posCámara)` → float32 cerca de 0; orientación (rotación propia); dirección al Sol; LOD por densidad (§6.3).
5. Pasadas *compute* en GPU solo para lo que cambia cada frame y es caro (fase 1: granulación del Sol). Lo que es función directa del tiempo y barato se calcula en el vertex shader.
6. Render + `RenderPipeline` (bloom, tone mapping; warp en fase 4).
7. HUD.

## 4. Precisión numérica y escalas

### 4.1 El problema

El sistema solar mide unos 9.000 millones de km y queremos ver detalles de metros. float32 (lo que usa la GPU) tiene unos 7 dígitos significativos: a 1 UA del origen, el error ronda los 10 km. Sin tratamiento, la Tierra "tiembla" al acercarse.

### 4.2 La solución: verdad en float64 + render relativo a la cámara

- **Toda posición "verdadera" vive en CPU como `number` (float64) en kilómetros**, en marco heliocéntrico eclíptico J2000 (`Vec3d`, `astro/frames.ts`).
- **Espacio de escena en float64**: `layoutSystem` convierte esas posiciones con `ScaleSystem` (§4.3) a ejes de Three.js (y arriba), todavía en float64 (`body.sceneD`). La cámara también vive ahí (`origin.cameraScene`), la escribe el modo de navegación.
- **Origen flotante** (`core/FloatingOrigin.ts`): la cámara de Three.js está siempre en `(0,0,0)`. Cada frame, cada objeto se coloca en `(sceneD − cameraScene)`, restado en float64 y solo después convertido a float32. Lo que está cerca de la cámara siempre tiene máxima precisión. **Solo `ScaleSystem` convierte km a escena y solo `FloatingOrigin` pasa de escena a float32.**
- **Partículas en espacio local**: las partículas de un planeta se guardan relativas al centro del planeta (en radios), nunca en coordenadas heliocéntricas. Solo el `Object3D` del planeta se mueve con el origen flotante.
- **Chunks de superficie** guardan posiciones relativas al centro del chunk (ver §7), así un chunk de 100 m tiene precisión de milímetros.
- **Profundidad**: `WebGPURenderer({ reversedDepthBuffer: true })` cuando está disponible (mejor precisión que el logarítmico y sin coste en el fragment shader); `logarithmicDepthBuffer: true` como respaldo. Además, `near`/`far` de la cámara se ajustan dinámicamente según la distancia al cuerpo más cercano.

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
  - Distancia: `localDistance = R'padre · h(d / rPadre)`, con `h(x) = x` hasta `x0` = 2 radios (proporciones reales cerca del cuerpo: altitud, relieve) y `h(x) = x0 · (1 + ln(x / x0))` más allá. Valor y pendiente continuos en `x0`: el zoom no da tirones.
  - Valores actuales: R'☉ = 979, R'⊕ = 118,5, R'☾ = 66; Sol–Mercurio ≈ 9.260; Sol–Tierra ≈ 11.100; Tierra–Luna ≈ 1.030 (> R'⊕ + R'☾ = 184,5).
- **Transición animada**: `blend ∈ [0,1]` interpola ambas funciones en unos 2 s (`setMode('real')`), así el cambio de escala es un efecto visual en sí mismo. El modo real llega en la fase 2.
- Los parámetros (`compressedParams`) se ajustan en vivo desde el panel de debug.

## 5. Astronomía (`astro/`)

- `bodies.ts`: tabla de datos de cada cuerpo (radio medio, achatamiento, inclinación del eje, periodo de rotación, elementos orbitales, padre, texturas, tipo de render).
- `kepler.ts`: posición a partir de los **elementos orbitales aproximados de JPL** (*Keplerian Elements for Approximate Positions of the Major Planets*, válidos 1800–2050) con sus tasas por siglo. Resolución de la ecuación de Kepler por Newton-Raphson. Precisión de unos pocos minutos de arco: de sobra para lo visual.
- `moon.ts`: Luna geocéntrica con la fórmula de baja precisión del *Astronomical Almanac* (~0,3°) más la corrección de precesión a J2000. Fase 2: resto de lunas con elementos medios.
- `ephemeris.ts`: posición relativa al padre y rotación propia.
  - **Tierra**: inclinación −ε alrededor del eje del equinoccio y giro = tiempo sidéreo de Greenwich (GMST). Verificado: punto subsolar en lon +1,5° y lat −0,2° el 20/03/2026 a las 12:00 UTC (≈ ecuación del tiempo), y lat ±23,44° en los solsticios.
  - **Luna**: rotación síncrona, lon 0° hacia la Tierra (queda la libración en latitud, real).
  - Resto: periodo sidéreo con fase 0 en J2000 (fase 2: polos y W0 de la IAU).
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
- **Distribución por densidad** (nubes): muestreo por rechazo según el brillo de la textura. Sale en orden aleatorio, así que también vale cualquier prefijo.
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

**Pendiente (fase 2):** los niveles discretos de la tabla, el presupuesto global y la transición de condensación entre niveles.

| Nivel | Cuándo | Representación | Partículas aprox. |
|---|---|---|---|
| **L0 — Punto** | < 4 px | Un sprite brillante con el color medio del cuerpo | 1 |
| **L1 — Nube** | 4–150 px | Prefijo corto de la esfera en orden estratificado | 5k–50k |
| **L2 — Globo** | 150 px – órbita baja | Esfera densa con relieve, nubes y atmósfera | 500k–2M |
| **L3 — Superficie** | Órbita baja → suelo | L2 de fondo + chunks del quadtree alrededor de la cámara (§7) | 2M–6M en total |

- Transición entre niveles con **"condensación"**: las partículas nacen desplazadas hacia fuera y se asientan en su sitio. Ya se usa al aparecer cada cuerpo (`BaseBody.condense`, ~2 s): es el efecto "el planeta se forma desde el polvo".
- **Presupuesto global** (`config.ts`): si la suma supera el límite, el `LodManager` baja el nivel de los cuerpos menos importantes en pantalla.

### 6.4 Interacción con el ratón (`particles/Disturbance.ts`)

Al pasar el cursor por encima, las partículas cercanas se desordenan y luego vuelven a su sitio. Es la primera **simulación con estado**:

- Cada capa (superficie de la Tierra y la Luna, nubes, superficie del Sol) tiene dos buffers extra por partícula: desplazamiento y velocidad.
- Una pasada compute por frame integra un **muelle amortiguado** (Euler semi-implícito) hacia la posición de reposo. Esa posición es la misma expresión TSL que usa el material, leída con `buffer.element(i)` en vez de `toAttribute()`.
- El Engine calcula el rayo del cursor en mundo (la cámara está en el origen) y cada cuerpo lo lleva al espacio local de cada capa (`BaseBody.localPointerRay`), con un radio de influencia en píxeles (`disturbanceLook.radiusPx`) convertido a unidades locales según la distancia.
- Dirección del empuje: fuera del rayo, algo hacia fuera de la superficie y un vector aleatorio por partícula (`hash(instanceIndex)`) que domina (`disorder`), así que se revuelven en vez de abrir un agujero limpio.
- Solo se simula mientras hace falta: con el cursor encima y hasta 4 s después, que es lo que tardan en asentarse.
- Coste de memoria: 32 B más por partícula (unos 38 MB para la Tierra).

## 7. Superficie y aterrizaje (`surface/`)

### 7.1 Cubo-esfera + quadtree

- Cada planeta rocoso se modela como un **cubo proyectado a esfera** (6 caras). Cada cara es la raíz de un **quadtree**.
- Cada nodo del quadtree es un **chunk**: un parche de superficie con un número fijo de partículas (p. ej. 128×128 = 16.384).
- Criterio de subdivisión: si `tamañoDelChunk / distanciaACámara > umbral`, el nodo se divide en 4 hijos. Si baja de `umbral × histéresis`, se fusiona. La histéresis evita parpadeo.
- Como cada chunk tiene las mismas partículas pero cubre menos área, **la densidad crece de forma exponencial al acercarse**. Con 12–15 niveles se pasa de un planeta entero a parches de metros.

### 7.2 Generación de un chunk (`SurfaceChunk.ts`)

Todo en un *compute shader*:

1. Rejilla de `N×N` puntos en la cara del cubo con jitter → proyectar a esfera (mapeo *cube-to-sphere* que conserva el área).
2. Altura = **heightmap real** (resolución limitada, p. ej. 8k–16k para la Tierra) + **ruido fractal procedural** (fBm/ridged, `mx_noise` de TSL) que añade detalle por debajo de la resolución del dato. La amplitud del ruido escala con el tamaño del chunk.
3. Color = albedo real + variación procedural según pendiente y altura (roca, nieve, arena).
4. Posición guardada **relativa al centro del chunk** (precisión, ver §4.2).

### 7.3 Gestión

- Pool de buffers reutilizables: los chunks no se crean ni destruyen en caliente, se reciclan.
- Máximo de chunks activos por frame y cola de generación con prioridad por distancia a la cámara.
- Los chunks hijos aparecen con la misma animación de "condensación" del LOD.
- Gigantes gaseosos: **no tienen superficie**. Al "bajar" entras en capas de nubes volumétricas de partículas y luego aparece un límite de profundidad con niebla.

## 8. Tipos de cuerpo (`bodies/`)

Todos implementan `CelestialBody` (`bodies/CelestialBody.ts`): `update(ctx)`, `setLod(nivel)`, `object3d` y `dispose()`.

| Clase | Técnica |
|---|---|
| `Sun` ✅ | 320k partículas. Granulación (Worley) y regiones activas (fractal) calculadas en una **pasada compute** por frame; oscurecimiento del limbo; HDR para el bloom. Corona: 70k partículas aditivas con flujo hacia fuera sin estado. Fase 2: protuberancias. |
| `RockyPlanet` ✅ | Horneado §6.2 + superficie §7 (fase 3). 1,2M partículas en la Tierra y 400k en la Luna. Lambert con *wrap* para suavizar el terminador; luces de ciudades en HDR solo en el lado nocturno; reflejo Blinn-Phong en el agua. |
| `Atmosphere` ✅ | Cáscara fina (4 % del radio) de 140k partículas aditivas, más densa abajo. El brillo del limbo sale de la geometría (la línea de visión cruza más partículas) más un término de Fresnel. Azul de día y naranja en el terminador. Solo se dibuja el anillo cercano al limbo: las de cara a la cámara apenas aportan y eran el grueso del coste. |
| `CloudLayer` ✅ | 320k partículas translúcidas repartidas por densidad de la textura de nubes, deriva de la capa respecto a la superficie. Fase 2: turbulencia con *curl noise* en compute y sombra sobre la superficie. |
| `GasGiant` | Partículas que se mueven en longitud con velocidad según la latitud (bandas), más vórtices con *curl noise* (Gran Mancha Roja). Color de textura real. |
| `Rings` | Partículas en un disco con densidad de la textura radial de los anillos y **velocidad kepleriana** (`v ∝ r^-1/2`), así las de dentro van más rápido. La sombra del planeta sobre los anillos se calcula en shader. |
| `AsteroidBelt` | Decenas de miles de partículas con elementos orbitales aleatorios (distribución con los huecos de Kirkwood), cada una propagada con Kepler en GPU. |
| `Starfield` ✅ | Yale BSC (9.096 estrellas, `scripts/build-stars.mjs`) a radio 10⁶ alrededor de la cámara, tamaño constante en píxeles. Magnitud → tamaño y brillo, índice B-V → color. Fase 2: Vía Láctea con partículas muestreadas de un panorama. |

## 9. Navegación (`navigation/`)

`CameraRig` mantiene la posición de la cámara en espacio de escena (float64, `origin.cameraScene`), el punto al que mira y la distancia a la superficie (para el plano cercano dinámico). Delega en el modo activo:

- **`OrbitMode`** ✅: arrastrar para girar alrededor del cuerpo enfocado y rueda para acercarse. La distancia se guarda en km verdaderos y pasa a escena con `localDistance` del cuerpo enfocado (§4.3). El zoom es multiplicativo sobre la **altitud**, para poder pasar de millones de km a la superficie con la rueda (fase 1: mínimo 4 % del radio; fase 3: hasta el suelo). Al cambiar de foco hay una **transición** de ~2,6 s: la cámara vuela en línea recta hacia el nuevo cuerpo (interpolación logarítmica de distancia) y la mirada gira hacia él en el primer 40 %.
- **`FreeFlyMode`**: WASD + ratón (pointer lock) y Q/E para alabeo. Velocidad automática proporcional a la distancia al cuerpo más cercano (lento cerca, rapidísimo en el vacío), con Shift como multiplicador. Colisión suave con la superficie.
- **`TravelMode`**: al hacer clic en un cuerpo, trayectoria con aceleración y frenado en espacio logarítmico de distancia (se ve tanto la salida como la llegada). Activa el efecto *warp* en `postfx` según la velocidad.
- Selección ✅: clic (sin arrastre) con *ray picking* contra esferas analíticas (`navigation/picking.ts`, radio mínimo de 14 px para cuerpos diminutos), botones del HUD o teclas 1–3.

## 10. Post-procesado (`postfx/`)

`RenderPipeline` con:

- **Bloom** ✅ (`bloom()` de `three/addons/tsl/display/BloomNode.js`): el toque artístico principal. Umbral 1,05, por encima del albedo iluminado (≤ 1): solo hacen bloom el Sol (HDR) y las luces de ciudades. Pendiente: se ven anillos concéntricos en el halo del Sol (cadena de mips del bloom).
- **Warp** (fase 4): estiramiento radial y aberración cromática proporcional a la velocidad de la cámara.
- Tone mapping ACES ✅. Exposición automática suave (fase 4).

## 11. UI (`ui/`)

- **HUD** ✅: cuerpo enfocado, altitud, fecha simulada (UTC), velocidad del tiempo («, pausa, », ahora; teclas `,` `.` espacio `N`), fps, backend y partículas dibujadas; botones de cuerpos (teclas 1–3).
- **Panel de información**: datos del cuerpo (radio, masa, día, año, temperatura).
- **Controles**: escala comprimida/real, velocidad del tiempo, lista de cuerpos para viajar.
- **Debug** ✅ (lil-gui, solo con `?debug`): exposición, bloom, brillo del Sol y corona, luces nocturnas, reflejo, nubes, atmósfera, estrellas, relieve por cuerpo y parámetros de la escala comprimida. Con `?debug` también quedan `window.engine` y los *timestamps* de GPU (`engine.renderer.resolveTimestampsAsync('render')`).

## 12. Rendimiento

- Objetivo: **60 fps con unos 4M de partículas** en una GPU integrada moderna (Apple M1 o similar) con WebGPU. En WebGL2 el presupuesto se reduce automáticamente a la mitad.
- Lo que se mueve se calcula en la GPU: en el vertex shader si es barato y depende solo del tiempo, y en *compute* (una vez por partícula) si es caro, como el ruido de Worley del Sol. Nunca ruido caro por vértice: cada sprite tiene 4 vértices y lo multiplicaría por 4. La CPU solo calcula unas decenas de posiciones de cuerpos por frame.
- El LOD por densidad (§6.3) es lo que más pesa: el coste real está en el número de sprites diminutos que caen sobre los mismos píxeles, no en el total de partículas.
- Densidad de píxeles hasta 2 (`config.maxPixelRatio`). Se probó 1,5 por rendimiento, pero en pantallas Retina la imagen se reescalaba y se veía borrosa.
- La profundidad por píxel de las micro-esferas desactiva el *early-z*. Como `alphaTest` ya lo desactivaba, el coste extra es moderado, pero hay que tenerlo en cuenta al medir.
- Medición de la fase 1: no hay una cifra fiable. Las pruebas se hicieron con la app sin ventana visible y macOS baja la frecuencia de la GPU; los *timestamps* variaron de 0,2 a 60 ms para la misma vista. Hay que medir con la ventana delante (fps del HUD).
- Texturas grandes (heightmaps de 16k) se cargan bajo demanda y con un nivel de baja resolución primero.
