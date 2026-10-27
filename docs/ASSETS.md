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
| Tierra | NASA SRTM / GEBCO (incluye batimetría) | Dominio público / GEBCO libre con atribución |
| Luna | NASA SVS CGI Moon Kit — LOLA displacement | Dominio público |
| Marte | USGS — MOLA MEGDR | Dominio público |
| Mercurio | USGS — MESSENGER DEM | Dominio público |

## Catálogos

| Dato | Fuente | Licencia |
|---|---|---|
| Estrellas | Yale Bright Star Catalog (~9.000 estrellas) o HYG Database (~120.000) | Dominio público / CC BY-SA 4.0 (HYG) |
| Órbitas planetarias | JPL — *Keplerian Elements for Approximate Positions of the Major Planets* | Dominio público |
| Verificación | JPL Horizons (efemérides de referencia) | Dominio público |
| Anillos de Saturno | Perfil radial de opacidad (Cassini) | Dominio público |

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
| `textures/earth/height_4k.png` | https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png | NASA Earth Observatory / GEBCO — elevación del terreno. Océano = 0, Everest ≈ 242, máximo 253 | 21600×10800 → 4096×2048, gris 8 bits |
| `textures/earth/night_3k.jpg` | https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg | NASA Earth Observatory — Black Marble 2016. Dominio público | 3600×1800 sin cambios |
| `textures/earth/clouds_2k.jpg` | https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg | NASA Earth Observatory — Blue Marble, nubes. Dominio público | 2048×1024 sin cambios |
| `textures/moon/albedo_2k.jpg` | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif | NASA SVS — CGI Moon Kit (LRO/LROC). Dominio público | TIFF → JPEG 2048×1024 |
| `textures/moon/height_1k.jpg` | https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_3_8bit.jpg | NASA SVS — CGI Moon Kit (LRO/LOLA). Dominio público. 0,5 = radio medio | 1024×512 sin cambios |
| `data/stars.bin` | https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz | Yale Bright Star Catalog, 5ª ed. (Hoffleit & Warren), vía CDS VizieR V/50 | `node scripts/build-stars.mjs <catalog>` → 9.096 estrellas, 4 float32 (RA, Dec, Vmag, B-V) |

El catálogo original no se guarda en el repo: para regenerar `stars.bin`, descarga y descomprime `catalog.gz` y pasa su ruta al script.
