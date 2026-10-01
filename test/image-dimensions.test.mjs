import assert from "node:assert/strict";
import test from "node:test";

import { imageDimensionsFromBuffer } from "../vendor/codex-workspace-enhancer/asset-browser/image-dimensions.js";

test("reads PNG dimensions without decoding the image", () => {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(941, 16);
  buffer.writeUInt32BE(1672, 20);

  assert.deepEqual(imageDimensionsFromBuffer(buffer), { width: 941, height: 1672 });
});

test("reads JPEG dimensions from a start-of-frame marker", () => {
  const buffer = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x06, 0x88,
    0x03, 0xad,
    0x03, 0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
  ]);

  assert.deepEqual(imageDimensionsFromBuffer(buffer), { width: 941, height: 1672 });
});

test("returns null for unsupported or truncated data", () => {
  assert.equal(imageDimensionsFromBuffer(Buffer.from("not an image")), null);
  assert.equal(imageDimensionsFromBuffer(Buffer.from([0xff, 0xd8, 0xff])), null);
});
