"""
MOLA MEGDR de Marte (16 píxeles/grado, int16 big-endian) → PNG de altura en gris de 8 bits.
Ver docs/ASSETS.md. Uso: python3 -I scripts/build-mars-height.py <megt90n000eb.img> <salida.png>

- Reduce a la mitad (2880×1440) promediando bloques de 2×2.
- Desplaza media vuelta: el MEGDR empieza en 0° E y los mapas del proyecto en −180°.
- Altura: −8200 m → 0 y 21200 m → 255 (el radio medio, 0 m, queda en 0,279).
"""
import struct
import sys
import zlib
from array import array

WIDTH, HEIGHT = 5760, 2880
LOW, HIGH = -8200.0, 21200.0


def main(src: str, dst: str) -> None:
    data = array('h')
    with open(src, 'rb') as f:
        data.frombytes(f.read())
    if sys.byteorder == 'little':
        data.byteswap()
    assert len(data) == WIDTH * HEIGHT, len(data)

    w, h = WIDTH // 2, HEIGHT // 2
    rows = []
    for y in range(h):
        r0, r1 = (2 * y) * WIDTH, (2 * y + 1) * WIDTH
        row = bytearray(w)
        for x in range(w):
            # Columna de salida x ↔ longitud −180° + …: en el MEGDR, la columna (x + w) mod w.
            sx = 2 * ((x + w // 2) % w)
            v = (data[r0 + sx] + data[r0 + sx + 1] + data[r1 + sx] + data[r1 + sx + 1]) / 4
            row[x] = max(0, min(255, round((v - LOW) / (HIGH - LOW) * 255)))
        rows.append(b'\x00' + bytes(row))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack('>I', len(payload)) + tag + payload + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
    png += chunk(b'IEND', b'')
    with open(dst, 'wb') as f:
        f.write(png)
    print(f'{dst}: {w}×{h}, 0 m = {(-LOW) / (HIGH - LOW):.3f}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
