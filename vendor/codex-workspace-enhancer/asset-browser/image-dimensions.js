import { promises as fs } from "node:fs";

const MAX_HEADER_BYTES = 256 * 1024;
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function validDimensions(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

export function imageDimensionsFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;

  if (buffer.length >= 24
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return validDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      const markerStart = offset - 1;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 1;
        continue;
      }
      if (markerStart + 4 > buffer.length) return null;
      const segmentLength = buffer.readUInt16BE(markerStart + 2);
      if (segmentLength < 2 || markerStart + 2 + segmentLength > buffer.length) return null;
      if (JPEG_SOF_MARKERS.has(marker) && segmentLength >= 7) {
        return validDimensions(
          buffer.readUInt16BE(markerStart + 7),
          buffer.readUInt16BE(markerStart + 5),
        );
      }
      offset = markerStart + 2 + segmentLength;
    }
    return null;
  }

  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") {
    return validDimensions(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
  }

  if (buffer.length >= 30 && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return validDimensions(width, height);
    }
  }

  return null;
}

export async function readImageDimensions(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(MAX_HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return imageDimensionsFromBuffer(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
