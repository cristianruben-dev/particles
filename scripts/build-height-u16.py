"""
Modelo de elevación de 16 bits → binario crudo `.u16` (little-endian, fila 0 = norte,
borde izquierdo en −180°) para la superficie (docs/ARQUITECTURA.md §7.2, docs/ASSETS.md).

Uso:
  python3 -I scripts/build-height-u16.py mola <megt90n000eb.img> <salida.u16> <ancho> <bajo_m> <alto_m>
  python3 -I scripts/build-height-u16.py lola <ldem_16_uint.tif> <salida.u16> <ancho> <bajo_m> <alto_m>

- mola: MGS MOLA MEGDR (int16 big-endian, 5760×2880, metros, borde izquierdo en 0° E).
- lola: CGI Moon Kit `ldem_*_uint.tif` (uint16 sin comprimir, medios metros + 20000,
  centrado en 0°).
Remuestrea con filtro bilineal a ancho × ancho/2 y normaliza: bajo_m → 0, alto_m → 65535.
"""
import struct
import sys
from array import array


def read_mola(path):
    w, h = 5760, 2880
    data = array('h')
    with open(path, 'rb') as f:
        data.frombytes(f.read())
    if sys.byteorder == 'little':
        data.byteswap()
    # Media vuelta: el MEGDR empieza en 0° E.
    rolled = array('f', [0.0]) * (w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            rolled[row + x] = data[row + (x + w // 2) % w]
    return w, h, rolled


def read_tiff_u16(path):
    with open(path, 'rb') as f:
        buf = f.read()
    endian = '<' if buf[:2] == b'II' else '>'
    (ifd,) = struct.unpack(endian + 'I', buf[4:8])
    (count,) = struct.unpack(endian + 'H', buf[ifd:ifd + 2])
    tags = {}
    for i in range(count):
        tag, typ, n, value = struct.unpack(endian + 'HHII', buf[ifd + 2 + i * 12: ifd + 14 + i * 12])
        if typ == 3 and n == 1:
            value &= 0xFFFF if endian == '<' else 0xFFFFFFFF
            if endian == '>':
                value >>= 16
        tags[tag] = (typ, n, value)
    w, h = tags[256][2], tags[257][2]
    assert tags.get(259, (0, 0, 1))[2] == 1, 'TIFF comprimido: no soportado'
    assert tags[258][2] == 16, 'Se esperaban 16 bits'
    typ, n, off = tags[273]
    if n == 1:
        offsets = [off]
    else:
        fmt = endian + ('I' if typ == 4 else 'H') * n
        offsets = list(struct.unpack(fmt, buf[off: off + n * (4 if typ == 4 else 2)]))
    typ, n, off = tags[279]
    if n == 1:
        counts = [off]
    else:
        fmt = endian + ('I' if typ == 4 else 'H') * n
        counts = list(struct.unpack(fmt, buf[off: off + n * (4 if typ == 4 else 2)]))
    raw = b''.join(buf[o: o + c] for o, c in zip(offsets, counts))
    data = array('H')
    data.frombytes(raw[: w * h * 2])
    if (endian == '>') == (sys.byteorder == 'little'):
        data.byteswap()
    # Medios metros con desplazamiento de 20000.
    meters = array('f', [(v - 20000) / 2 for v in data])
    return w, h, meters


def resample(w, h, src, out_w):
    out_h = out_w // 2
    out = array('f', [0.0]) * (out_w * out_h)
    sx, sy = w / out_w, h / out_h
    for y in range(out_h):
        fy = min(max((y + 0.5) * sy - 0.5, 0), h - 1)
        y0 = int(fy)
        y1 = min(y0 + 1, h - 1)
        ty = fy - y0
        r0, r1 = y0 * w, y1 * w
        for x in range(out_w):
            fx = (x + 0.5) * sx - 0.5
            x0 = int(fx) if fx >= 0 else -1
            tx = fx - x0
            xa, xb = x0 % w, (x0 + 1) % w
            top = src[r0 + xa] + (src[r0 + xb] - src[r0 + xa]) * tx
            bottom = src[r1 + xa] + (src[r1 + xb] - src[r1 + xa]) * tx
            out[y * out_w + x] = top + (bottom - top) * ty
    return out_h, out


def main():
    kind, src_path, dst, out_w, low, high = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
    w, h, meters = read_mola(src_path) if kind == 'mola' else read_tiff_u16(src_path)
    print(f'{src_path}: {w}×{h}, {min(meters):.0f} … {max(meters):.0f} m')
    out_h, out = resample(w, h, meters, out_w)
    data = array('H', [max(0, min(65535, round((v - low) / (high - low) * 65535))) for v in out])
    if sys.byteorder != 'little':
        data.byteswap()
    with open(dst, 'wb') as f:
        f.write(data.tobytes())
    print(f'{dst}: {out_w}×{out_h} u16, 0 m = {(-low) / (high - low):.4f}')


if __name__ == '__main__':
    main()
