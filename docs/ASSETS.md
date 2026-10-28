# Assets y fuentes de datos

Qué hace falta, de dónde sacarlo y con qué **licencia**. Antes de añadir un archivo a `public/`, apúntalo en la tabla de "Descargados" con su origen. Lo usado en la fase 1 está al final.

## Texturas de color (albedo)

| Cuerpo | Fuente | Licencia |
|---|---|---|
| Tierra (Blue Marble) | NASA Visible Earth — Blue Marble Next Generation | Dominio público (NASA) |
| Tierra (luces nocturnas) | NASA Black Marble | Dominio público (NASA) |
| Tierra (nubes) | NASA Visible Earth — cloud combined | Dominio público (NASA) |
| Luna | NASA SVS — CGI Moon Kit (LRO) | Dominio público (NASA) |
| Marte | USGS Astrogeology — Viking/MOLA color mosaic | Dominio público (USGS/NASA) |
| Mercurio | USGS — MESSENGER MDIS global mosaic | Dominio público |
| Júpiter, Saturno | NASA/JPL (Cassini, Juno) mapas cilíndricos | Dominio público, con créditos de procesado según el autor |
| Todos (alternativa cómoda) | Solar System Scope textures | **CC BY 4.0**: exige atribución visible en la app |

## Mapas de altura (heightmaps)

| Cuerpo | Fuente | Licencia |
|---|---|---|
| Tierra | Globo: GEBCO de NASA (8 bits). Superficie: NOAA ETOPO 2022 (float16) | Dominio público |
| Luna | NASA SVS CGI Moon Kit — LOLA displacement | Dominio público |
| Marte | USGS — MOLA MEGDR | Dominio público |
| Mercurio | USGS — MESSENGER DEM | Dominio público |

## Tipografías e iconos de la interfaz

Se instalan con npm (Fontsource) y Vite las empaqueta: no van en `public/`.

| Recurso | Fuente | Licencia |
|---|---|---|
| Geist y Geist Mono (texto y cifras) | Vercel, vía `@fontsource-variable/geist` y `@fontsource-variable/geist-mono` | SIL Open Font License 1.1 |
| Instrument Serif (nombres de los cuerpos) | Instrument, vía `@fontsource/instrument-serif` | SIL Open Font License 1.1 |
| Iconos (`src/ui/icons.ts`) | Dibujados para este proyecto | Los del proyecto |

## Datos de la ficha de cada cuerpo

| Dato | Fuente | Licencia |
|---|---|---|
| Masa, temperatura media, presión y lunas de planetas, Luna y Plutón | NASA NSSDCA — Planetary Fact Sheet (Metric), consultada el 27/10/2026 | Dominio público (NASA) |
| GM de las lunas | JPL SSD — Planetary Satellite Physical Parameters | Dominio público (NASA/JPL) |
| Temperatura y presión de Titán | Huygens (ESA/NASA, 2005) | Dato científico publicado |

## Catálogos

| Dato | Fuente | Licencia |
|---|---|---|
| Estrellas | Yale Bright Star Catalog (~9.000 estrellas) o HYG Database (~120.000) | Dominio público / CC BY-SA 4.0 (HYG) |
| Órbitas planetarias | JPL — *Keplerian Elements for Approximate Positions of the Major Planets* | Dominio público |
| Verificación | JPL Horizons (efemérides de referencia) | Dominio público |
| Anillos de Saturno | Perfil radial de opacidad (Cassini) | Dominio público |

## Datos incluidos en el código (fase 4)

No van en `public/`: son tablas en `src/astro/`.

| Dato | Fuente | Licencia |
|---|---|---|
| Luna (60 + 60 términos de ELP-2000/82) | Meeus, *Astronomical Algorithms*, cap. 47, en la transcripción de la biblioteca `astronomia` (commenthol, Sonia Keys) | MIT (los coeficientes son datos de la teoría ELP-2000/82, de Chapront) |
| ΔT (TT − UT) | IERS, valores medidos | Dominio público |
| Elementos de los cometas | JPL Horizons (osculantes en el perihelio de cada aparición) y JPL Small-Body Database (M1, K1), consultados el 27–28/10/2026 | Dominio público (NASA/JPL) |
| Apariciones de Halley, Encke y 67P de 1900 a 2100 (`src/astro/cometApparitions.ts`) | JPL Horizons: solución de cada aparición observada (`DES=…;CAP<año`) y su integración en los huecos; generado con `node scripts/build-comet-apparitions.mjs` el 28/10/2026 | Dominio público (NASA/JPL) |
| Términos periódicos del polo de Neptuno y de Tritón | NAIF, kernel `pck00011.tpc` (IAU WGCCRE 2015) | Dominio público (NASA/JPL) |
| TLE de la ISS (NORAD 25544) | CelesTrak (se renueva al arrancar si hay red) | Datos públicos de NORAD/18 SDS |
| Medidas de la ISS | NASA — International Space Station Facts and Figures | Dominio público (NASA) |
| Núcleos de los cometas | NASA y ESA (Giotto, Rosetta, Deep Impact) | Datos científicos publicados |
| Verificación de eclipses | NASA GSFC — catálogo de eclipses (Espenak) | Dominio público (NASA) |

## Bibliotecas de cálculo

| Biblioteca | Uso | Licencia |
|---|---|---|
| `satellite.js` 7.1.0 | SGP4 para la ISS (solo los módulos de JavaScript, vía `src/astro/sgp4.ts`) | MIT |

## Organización en `public/`

```
public/
├── textures/<cuerpo>/albedo_<res>.jpg
├── textures/<cuerpo>/height_<res>.png      (16 bits si es posible)
├── textures/<cuerpo>/night_<res>.jpg       (solo Tierra)
├── textures/<cuerpo>/clouds_<res>.jpg      (solo Tierra)
└── data/stars.bin                          (catálogo convertido a binario)
```

Resoluciones previstas: `2k` para la carga inicial, `8k` y `16k` bajo demanda (fase 3).

## Descargados

Descargados el 27/10/2026 y redimensionados con `sips` (macOS). Todo es dominio público salvo que se indique otra cosa; se agradece el crédito.

| Archivo en `public/` | Origen | Crédito / licencia | Proceso |
|---|---|---|---|
| `textures/earth/albedo_4k.jpg` | https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg | NASA Earth Observatory — Blue Marble Next Generation (topografía y batimetría, dic. 2004). Dominio público | 5400×2700 → 4096×2048 |
| `textures/earth/height_4k.png` | https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png | NASA Earth Observatory / GEBCO — elevación del terreno. Océano = 0, Everest ≈ 242, máximo 253; lineal, 25 m por nivel (1 = 6.396 m, medido contra ETOPO 2022) | 21600×10800 → 4096×2048, gris 8 bits |
| `textures/earth/night_3k.jpg` | https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg | NASA Earth Observatory — Black Marble 2016. Dominio público | 3600×1800 sin cambios |
| `textures/earth/clouds_2k.jpg` | https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg | NASA Earth Observatory — Blue Marble, nubes. Dominio público | 2048×1024 sin cambios |
| `textures/moon/albedo_2k.jpg` | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif | NASA SVS — CGI Moon Kit (LRO/LROC). Dominio público | TIFF → JPEG 2048×1024 |
| `textures/moon/height_1k.jpg` | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg | NASA SVS — CGI Moon Kit (LRO/LOLA). Dominio público. 0,5 = radio medio | 1024×512 sin cambios |
| `data/stars.bin` | https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz | Yale Bright Star Catalog, 5ª ed. (Hoffleit & Warren), vía CDS VizieR V/50 | `node scripts/build-stars.mjs <catalog>` → 9.096 estrellas, 4 float32 (RA, Dec, Vmag, B-V) |

El catálogo original no se guarda en el repo: para regenerar `stars.bin`, descarga y descomprime `catalog.gz` y pasa su ruta al script.

### Fase 2 (27/10/2026)

Dominio público (NASA, JPL, USGS, JHUAPL/SwRI). Las URL de `asc-pds-services.s3…` son el almacén de [planetarymaps.usgs.gov](https://planetarymaps.usgs.gov/mosaic/) (USGS Astrogeology). Antes de usar un mapa nuevo se comprueba con accidentes conocidos que el este y la longitud 0° quedan donde deben; si el borde izquierdo no está en −180°, se indica con `mapLeftLon` en `bodies/presets.ts`.

| Archivo en `public/` | Origen | Crédito / licencia | Proceso |
|---|---|---|---|
| `textures/mercury/albedo_4k.jpg` | https://upload.wikimedia.org/wikipedia/commons/f/f2/Mercury_global_map_2013-05-14_bright.png | NASA / JHUAPL / Carnegie (MESSENGER MDIS). Dominio público | 6132×3066 → 4096×2048 |
| `textures/mercury/height_2k.png` | https://upload.wikimedia.org/wikipedia/commons/d/d9/Mercury_Messenger_DEM_Global_665m_v2_max.png | USGS Astrogeology, DEM global de MESSENGER (665 m, v2). Dominio público. ~0,5 = radio medio | 23040×11520 → 2048×1024, gris 8 bits |
| `textures/mars/albedo_4k.jpg` | https://upload.wikimedia.org/wikipedia/commons/1/1f/Mars_Viking_MDIM21_ClrMosaic_1km.jpg | NASA / JPL / USGS, Viking MDIM 2.1 en color. Dominio público | 21339×10670 → 4096×2048 |
| `textures/mars/height_3k.png` | https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img | NASA PDS, MGS MOLA MEGDR (16 px/grado). Dominio público | `scripts/build-mars-height.py`: 2880×1440, −8200 m → 0 y 21200 m → 255 (0 m = 0,279), media vuelta para empezar en −180° |
| `textures/jupiter/albedo_4k.jpg` | https://upload.wikimedia.org/wikipedia/commons/1/1e/Jupiter_Cylindrical_Map_-_Dec_2000_PIA07782.jpg | NASA / JPL / Space Science Institute, Cassini (PIA07782). Dominio público. Gran Mancha Roja en lon −50°, lat −19,5° del mapa | 3601×1801 → 3600×1800 |
| `textures/io/albedo_2k.jpg` | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif | USGS Astrogeology, Galileo SSI + Voyager en color. Dominio público | 11445×5723 → 2048×1024 |
| `textures/europa/albedo_1k.jpg` | https://upload.wikimedia.org/wikipedia/commons/2/26/Europa_Voyager_GalileoSSI_global_mosaic.jpg | USGS / PDS (T. Becker), Voyager + Galileo SSI. Dominio público | 1024×512 sin cambios; se tiñe en el preset |
| `textures/ganymede/albedo_2k.jpg` | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif | USGS Astrogeology, Voyager + Galileo SSI en color. Dominio público. Borde izquierdo en 0° E | 11520×5760 → 2048×1024 |
| `textures/callisto/albedo_2k.jpg` | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif | USGS Astrogeology, Voyager + Galileo SSI. Dominio público. Borde izquierdo en 0° E | 15138×7569 → 2048×1024; se tiñe en el preset |
| `textures/titan/albedo_2k.jpg` | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Titan_ISS_P19658_Mosaic_Global_4km.tif | USGS / NASA, Cassini ISS a 938 nm. Dominio público. Borde izquierdo en 0° E | 4040×2020 → 2048×1024; bajo una bruma naranja |
| `textures/triton/albedo_2k.jpg` | https://upload.wikimedia.org/wikipedia/commons/6/61/Triton_map_no_grid.jpg | NASA / JPL / USGS, Voyager 2. Dominio público | 14138×7069 → 2048×1024 |
| `textures/pluto/albedo_2k.jpg` | https://upload.wikimedia.org/wikipedia/commons/a/ad/Pluto_color_mapmosaic.jpg | NASA / JHUAPL / SwRI, New Horizons. Dominio público. Borde izquierdo en 0° E | 5926×2963 → 2048×1024 |
| `textures/charon/albedo_2k.jpg` | https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif | NASA / JHUAPL / SwRI / LPI vía USGS, New Horizons. Dominio público | 12693×6347 → 2048×1024 |

### Fase 3 (27/10/2026)

| Archivo en `public/` | Origen | Crédito / licencia | Proceso |
|---|---|---|---|
| `textures/moon/height_4k.u16` | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif | NASA SVS — CGI Moon Kit (LRO/LOLA, 16 px/grado). Dominio público | `scripts/build-height-u16.py lola`: 5760×2880 → 4096×2048, uint16 little-endian, −10000 m → 0 y +10000 m → 65535 (0 m = 0,5) |
| `textures/mars/height_4k.u16` | https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img | NASA PDS — MGS MOLA MEGDR (16 px/grado). Dominio público | `scripts/build-height-u16.py mola`: media vuelta y 5760×2880 → 4096×2048, uint16 little-endian, −8200 m → 0 y 21200 m → 65535 (0 m = 0,279, como el mapa del globo) |

Sin archivo: Venus (cimas de nubes con ruido fractal, la superficie de Magellan no es visible), Saturno, Urano y Neptuno (perfil de bandas procedural; Saturno, con colores tomados de las imágenes de Cassini, el hexágono polar y tormentas) y los anillos (bordes publicados de los anillos C, B, A, F y del de Urano, en `bodies/presets.ts`). El sonido también es procedural (Web Audio): no hay archivos de audio.

### Fase 4 (28/10/2026)

| Archivo en `public/` | Origen | Crédito / licencia | Proceso |
|---|---|---|---|
| `textures/earth/height_8k.f16z` | NOAA NCEI — ETOPO 2022, 60″, elevación de la superficie (`ETOPO_2022_v1_60s_N90W180_surface.nc`), leído por OPeNDAP cada 2′ (10 bandas, ~233 MB, no se guardan): https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc | NOAA National Centers for Environmental Information (2022), ETOPO 2022 15 Arc-Second Global Relief Model, doi:10.25921/fd45-gt74. Dominio público (Gobierno de EE. UU.) | `python3 -I scripts/build-earth-height.py <bandas> public/textures/earth/height_4k.png <salida>`: filtro triangular a 8192×4096, océano = 0 (fondo recortado a −100 m antes de filtrar), escala del mapa de 8 bits del globo ajustada con los dos (1 = 6.396 m), float16 little-endian comprimido con zlib (17,5 MB). Comprobado: Everest, Mont Blanc, Kilimanjaro, Aconcagua y Denali a menos de 0,25° de su sitio (este y lon 0° bien) |

Datos de referencia (no se guardan): polos y meridianos de la IAU desde el kernel de NAIF `pck00011.tpc` (https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc), elementos medios de las lunas de https://ssd.jpl.nasa.gov/sats/elem/ y posiciones de verificación de la API de JPL Horizons.
