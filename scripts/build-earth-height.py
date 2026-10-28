"""
ETOPO 2022 (NOAA, 60″) → mapa de alturas de la Tierra para la superficie (docs/ARQUITECTURA.md §7.2,
docs/ASSETS.md): 8192×4096, media flotante (float16) little-endian, fila 0 = norte, borde
izquierdo en −180°, comprimido con zlib (`.f16z`, lo descomprime el navegador).

Descarga (OPeNDAP, cada 2′, en 10 bandas de 540 filas; ~233 MB):
  B=https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc
  curl -g -o z<k>.dods "$B.dods?z[<1080k>:2:<1080k+1078>][0:2:21599]"   (k = 0…9)

Uso:
  python3 -I scripts/build-earth-height.py <carpeta con z0.dods…z9.dods> <height_4k.png del globo> <salida.f16z>

- La escala es la del mapa de 8 bits del globo (GEBCO de NASA, océano = 0): se ajusta con los
  dos mapas a la vez, para que la altura no salte en el relevo globo ↔ superficie (§7.3).
- Océano (altura ≤ 0) = 0, como en el globo. Antes de filtrar, el fondo marino se recorta a
  −100 m: si no, una costa con fosas al lado se hundiría.
- Remuestreo separable con un filtro triangular del tamaño del texel de salida (sin aliasing).
"""
import struct
import sys
import zlib
from array import array

SRC_W, SRC_H = 10800, 5400          # cada 2′, de sur a norte
SRC_LON0, SRC_LAT0, SRC_STEP = -180 + 1 / 120, -90 + 1 / 120, 1 / 30
OUT_W, OUT_H = 8192, 4096
SEA_FLOOR = -100.0


def read_bands(folder):
    data = array('f')
    for k in range(10):
        buf = open(f'{folder}/z{k}.dods', 'rb').read()
        i = buf.index(b'\nData:\n') + 7
        n, _ = struct.unpack('>II', buf[i:i + 8])
        band = array('f')
        band.frombytes(buf[i + 8:i + 8 + n * 4])
        if sys.byteorder == 'little':
            band.byteswap()
        data.extend(band)
    assert len(data) == SRC_W * SRC_H, len(data)
    return data


def taps(n_out, n_src, src_of_out, wrap):
    """Por cada salida, los (índice, peso) de un filtro triangular del tamaño del texel de salida."""
    r = max(1.0, n_src / n_out)
    out = []
    for o in range(n_out):
        s = src_of_out(o)
        lo, hi = int(s - r) - 1, int(s + r) + 2
        pairs = []
        for i in range(lo, hi + 1):
            w = 1 - abs(i - s) / r
            if w <= 0:
                continue
            j = i % n_src if wrap else min(max(i, 0), n_src - 1)
            pairs.append((j, w))
        total = sum(w for _, w in pairs)
        out.append([(j, w / total) for j, w in pairs])
    return out


def resample(src):
    # Horizontal: lon de salida −180 + (x + ½)·360/OUT_W.
    hx = taps(OUT_W, SRC_W, lambda x: (-180 + (x + 0.5) * 360 / OUT_W - SRC_LON0) / SRC_STEP, True)
    rows = []
    for y in range(SRC_H):
        row = src[y * SRC_W:(y + 1) * SRC_W]
        row = array('f', [v if v > SEA_FLOOR else SEA_FLOOR for v in row])
        rows.append(array('f', [sum(row[j] * w for j, w in t) for t in hx]))
        if y % 500 == 0:
            print(f'horizontal {y}/{SRC_H}', flush=True)
    # Vertical: lat de salida 90 − (y + ½)·180/OUT_H (fila 0 = norte).
    vy = taps(OUT_H, SRC_H, lambda y: (90 - (y + 0.5) * 180 / OUT_H - SRC_LAT0) / SRC_STEP, False)
    out = array('f', [0.0]) * (OUT_W * OUT_H)
    for y, t in enumerate(vy):
        acc = [0.0] * OUT_W
        for j, w in t:
            r = rows[j]
            for x in range(OUT_W):
                acc[x] += r[x] * w
        out[y * OUT_W:(y + 1) * OUT_W] = array('f', acc)
        if y % 500 == 0:
            print(f'vertical {y}/{OUT_H}', flush=True)
    return out


def read_png_gray(path):
    buf = open(path, 'rb').read()
    w, h, depth, ctype = struct.unpack('>IIBB', buf[16:26])
    assert depth == 8 and ctype == 0, 'Se esperaba gris de 8 bits'
    idat, p = b'', 8
    while p < len(buf):
        (n,) = struct.unpack('>I', buf[p:p + 4])
        kind = buf[p + 4:p + 8]
        if kind == b'IDAT':
            idat += buf[p + 8:p + 8 + n]
        p += 12 + n
    raw = zlib.decompress(idat)
    out = bytearray(w * h)
    prev = bytearray(w)
    for y in range(h):
        f = raw[y * (w + 1)]
        line = bytearray(raw[y * (w + 1) + 1:(y + 1) * (w + 1)])
        for x in range(w):
            a = line[x - 1] if x else 0
            b = prev[x]
            c = prev[x - 1] if x else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 255
        out[y * w:(y + 1) * w] = line
        prev = line
    return w, h, out


def fit_scale(elev, globe):
    """Metros por unidad normalizada del mapa del globo (mínimos cuadrados por el origen, en tierra)."""
    gw, gh, g = globe
    k = OUT_W // gw
    sxy = sxx = 0.0
    for y in range(0, gh, 2):
        for x in range(0, gw, 2):
            v = g[y * gw + x] / 255
            if v < 4 / 255:
                continue
            e = sum(elev[(y * k + j) * OUT_W + x * k + i] for j in range(k) for i in range(k)) / (k * k)
            sxy += e * v
            sxx += v * v
    return sxy / sxx


def half_bits(values):
    out = array('H', bytes(2 * len(values)))
    pack = struct.Struct('<e')
    for i, v in enumerate(values):
        out[i] = struct.unpack('<H', pack.pack(v))[0]
    return out


def main():
    folder, globe_png, out_path = sys.argv[1:4]
    elev = resample(read_bands(folder))
    meters = fit_scale(elev, read_png_gray(globe_png))
    print(f'Escala del globo: {meters:.1f} m por unidad (255 = {meters:.0f} m)')
    norm = array('f', [max(e, 0.0) / meters for e in elev])
    # Comprobaciones: accidentes conocidos (lat, lon E) en su sitio (el este y la lon 0°).
    for name, lat, lon in [('Everest', 27.988, 86.925), ('Mont Blanc', 45.833, 6.865), ('Kilimanjaro', -3.067, 37.356),
                           ('Aconcagua', -32.653, -70.011), ('Denali', 63.069, -151.007), ('Mar Muerto', 31.5, 35.5)]:
        best = (-1.0, 0, 0)
        for dy in range(-6, 7):
            for dx in range(-6, 7):
                y = int((90 - lat) / 180 * OUT_H) + dy
                x = int((lon + 180) / 360 * OUT_W) % OUT_W + dx
                v = norm[y * OUT_W + x]
                if v > best[0]:
                    best = (v, x, y)
        v, x, y = best
        print(f'{name}: máximo cercano {v * meters:.0f} m en lat {90 - (y + 0.5) * 180 / OUT_H:.2f}, lon {(x + 0.5) * 360 / OUT_W - 180:.2f}')
    bits = half_bits(norm)
    if sys.byteorder != 'little':
        bits.byteswap()
    packed = zlib.compress(bits.tobytes(), 9)
    open(out_path, 'wb').write(packed)
    print(f'{out_path}: {len(packed) / 1e6:.1f} MB ({OUT_W}×{OUT_H} float16)')


if __name__ == '__main__':
    main()
