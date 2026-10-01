import assert from "node:assert/strict";
import test from "node:test";

import {
  assetConsoleEmbedPrefix,
  assetConsoleEmbedUrl,
  assetConsoleRoute,
  responseHeadersForCdp,
  transformAssetConsoleBody,
} from "../lib/asset-console-embed.mjs";

const token = "0123456789abcdef0123456789abcdef0123456789abcdef";
const embedUrl = assetConsoleEmbedUrl(token);

test("embedded Asset Console routes only its private sandbox frame to localhost", () => {
  assert.equal(assetConsoleRoute(`${embedUrl}app.js`, { token }), "/app.js");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/api/projects", { token, assetSession: true }), "/api/projects");
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/api/projects", { token }), null);
  assert.equal(assetConsoleRoute("https://example.com/api/projects", { token, assetSession: true }), null);
  assert.equal(assetConsoleRoute("https://web-sandbox.oaiusercontent.com/__codex_asset_console__/wrong/app.js", { token }), null);
  assert.throws(() => assetConsoleEmbedPrefix("predictable"), /Invalid Asset Console embed token/);
});

test("embedded Asset Console rewrites local assets and stale transport headers", () => {
  const html = Buffer.from('<link href="/ui-v3.css"><script src="/app.js"></script>');
  const rewritten = transformAssetConsoleBody(embedUrl, html, { token }).toString("utf8");
  assert.match(rewritten, new RegExp(`${token}/ui-v3\\.css`));
  assert.match(rewritten, new RegExp(`${token}/app\\.js`));
  assert.deepEqual(responseHeadersForCdp({ "content-type": "text/css", "content-length": "1", connection: "close" }, 42), [
    { name: "content-type", value: "text/css" },
    { name: "content-length", value: "42" },
  ]);
});
