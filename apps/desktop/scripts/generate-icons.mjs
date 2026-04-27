import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const buildDir = new URL("../build/", import.meta.url);
const icoSizes = [16, 32, 48, 64, 128, 256];
const crcTable = createCrcTable();

await mkdir(buildDir, { recursive: true });

const icoPngs = icoSizes.map((size) => ({ size, png: createPng(size) }));
const ico = createIco(icoPngs);

await writeFile(new URL("icon.ico", buildDir), ico);
await writeFile(new URL("installerIcon.ico", buildDir), ico);
await writeFile(new URL("uninstallerIcon.ico", buildDir), ico);
await writeFile(new URL("icon.png", buildDir), createPng(512));

console.log(`Generated app icons in ${buildDir.pathname}`);

function createPng(size) {
  const image = drawIcon(size);
  const rowLength = size * 4 + 1;
  const raw = Buffer.alloc(rowLength * size);

  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    image.copy(raw, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([
      uint32(size),
      uint32(size),
      Buffer.from([8, 6, 0, 0, 0])
    ])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);

  drawRoundedRect(pixels, size, 0.035, 0.035, 0.93, 0.93, 0.19, [18, 24, 34, 255]);
  drawRoundedRect(pixels, size, 0.09, 0.09, 0.82, 0.82, 0.14, [31, 171, 152, 255]);
  drawRoundedRect(pixels, size, 0.125, 0.125, 0.75, 0.75, 0.12, [15, 23, 42, 255]);

  drawRoundedRect(pixels, size, 0.18, 0.18, 0.64, 0.43, 0.055, [240, 253, 250, 255]);
  drawRoundedRect(pixels, size, 0.205, 0.205, 0.59, 0.38, 0.04, [20, 32, 46, 255]);
  drawRoundedRect(pixels, size, 0.435, 0.61, 0.13, 0.1, 0.015, [240, 253, 250, 255]);
  drawRoundedRect(pixels, size, 0.34, 0.705, 0.32, 0.065, 0.026, [240, 253, 250, 255]);

  drawBitmapLetter(pixels, size, "R", 0.295, 0.295, 0.038, [240, 253, 250, 255]);
  drawBitmapLetter(pixels, size, "C", 0.51, 0.295, 0.038, [125, 243, 211, 255]);

  drawRoundLine(pixels, size, 0.26, 0.84, 0.74, 0.84, 0.018, [255, 209, 102, 255]);
  drawCircle(pixels, size, 0.26, 0.84, 0.055, [255, 209, 102, 255]);
  drawCircle(pixels, size, 0.74, 0.84, 0.055, [125, 243, 211, 255]);
  drawCircle(pixels, size, 0.5, 0.84, 0.032, [240, 253, 250, 255]);

  return pixels;
}

function drawBitmapLetter(pixels, size, letter, startX, startY, cell, color) {
  const glyphs = {
    R: ["1110", "1001", "1001", "1110", "1010", "1001", "1001"],
    C: ["0111", "1000", "1000", "1000", "1000", "1000", "0111"]
  };
  const rows = glyphs[letter];
  const gap = cell * 0.16;

  for (let y = 0; y < rows.length; y += 1) {
    for (let x = 0; x < rows[y].length; x += 1) {
      if (rows[y][x] === "1") {
        drawRoundedRect(
          pixels,
          size,
          startX + x * cell,
          startY + y * cell,
          cell - gap,
          cell - gap,
          cell * 0.18,
          color
        );
      }
    }
  }
}

function drawRoundedRect(pixels, size, x, y, width, height, radius, color) {
  const minX = Math.max(0, Math.floor((x - radius) * size));
  const maxX = Math.min(size - 1, Math.ceil((x + width + radius) * size));
  const minY = Math.max(0, Math.floor((y - radius) * size));
  const maxY = Math.min(size - 1, Math.ceil((y + height + radius) * size));
  const cx = x + width / 2;
  const cy = y + height / 2;
  const aa = 1.5 / size;

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const nx = (px + 0.5) / size;
      const ny = (py + 0.5) / size;
      const qx = Math.abs(nx - cx) - (width / 2 - radius);
      const qy = Math.abs(ny - cy) - (height / 2 - radius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      const dist = outside + inside - radius;
      const alpha = clamp(0.5 - dist / aa, 0, 1);

      if (alpha > 0) {
        blendPixel(pixels, size, px, py, color, alpha);
      }
    }
  }
}

function drawCircle(pixels, size, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor((cx - radius) * size));
  const maxX = Math.min(size - 1, Math.ceil((cx + radius) * size));
  const minY = Math.max(0, Math.floor((cy - radius) * size));
  const maxY = Math.min(size - 1, Math.ceil((cy + radius) * size));
  const aa = 1.5 / size;

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const nx = (px + 0.5) / size;
      const ny = (py + 0.5) / size;
      const dist = Math.hypot(nx - cx, ny - cy) - radius;
      const alpha = clamp(0.5 - dist / aa, 0, 1);

      if (alpha > 0) {
        blendPixel(pixels, size, px, py, color, alpha);
      }
    }
  }
}

function drawRoundLine(pixels, size, x1, y1, x2, y2, radius, color) {
  const minX = Math.max(0, Math.floor((Math.min(x1, x2) - radius) * size));
  const maxX = Math.min(size - 1, Math.ceil((Math.max(x1, x2) + radius) * size));
  const minY = Math.max(0, Math.floor((Math.min(y1, y2) - radius) * size));
  const maxY = Math.min(size - 1, Math.ceil((Math.max(y1, y2) + radius) * size));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const aa = 1.5 / size;

  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const nx = (px + 0.5) / size;
      const ny = (py + 0.5) / size;
      const t = clamp(((nx - x1) * dx + (ny - y1) * dy) / lenSq, 0, 1);
      const lx = x1 + dx * t;
      const ly = y1 + dy * t;
      const dist = Math.hypot(nx - lx, ny - ly) - radius;
      const alpha = clamp(0.5 - dist / aa, 0, 1);

      if (alpha > 0) {
        blendPixel(pixels, size, px, py, color, alpha);
      }
    }
  }
}

function blendPixel(pixels, size, x, y, color, coverage) {
  const index = (y * size + x) * 4;
  const srcAlpha = (color[3] / 255) * coverage;
  const dstAlpha = pixels[index + 3] / 255;
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);

  if (outAlpha <= 0) {
    return;
  }

  for (let i = 0; i < 3; i += 1) {
    pixels[index + i] = Math.round(
      (color[i] * srcAlpha + pixels[index + i] * dstAlpha * (1 - srcAlpha)) / outAlpha
    );
  }

  pixels[index + 3] = Math.round(outAlpha * 255);
}

function createIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  let offset = headerSize + images.length * entrySize;
  const header = Buffer.alloc(offset);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  images.forEach(({ size, png }, index) => {
    const entryOffset = headerSize + index * entrySize;
    header[entryOffset] = size === 256 ? 0 : size;
    header[entryOffset + 1] = size === 256 ? 0 : size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data])))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let value = i;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[i] = value >>> 0;
  }

  return table;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
