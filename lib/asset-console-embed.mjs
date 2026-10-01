export const ASSET_CONSOLE_EMBED_ORIGIN = "https://web-sandbox.oaiusercontent.com";
export const ASSET_CONSOLE_EMBED_PREFIX = "/__codex_asset_console__/";

export function assetConsoleEmbedPrefix(token) {
  if (!/^[a-f0-9]{32,128}$/i.test(token || "")) throw new Error("Invalid Asset Console embed token");
  return `${ASSET_CONSOLE_EMBED_PREFIX}${token}/`;
}

export function assetConsoleEmbedUrl(token) {
  return `${ASSET_CONSOLE_EMBED_ORIGIN}${assetConsoleEmbedPrefix(token)}`;
}

export function assetConsoleRoute(requestUrl, { token, assetSession = false } = {}) {
  const url = new URL(requestUrl);
  if (url.origin !== ASSET_CONSOLE_EMBED_ORIGIN) return null;
  const embedPrefix = assetConsoleEmbedPrefix(token);
  let pathname = url.pathname;
  if (pathname.startsWith(embedPrefix)) {
    pathname = pathname.slice(embedPrefix.length - 1) || "/";
  } else if (!assetSession || (!pathname.startsWith("/api/") && pathname !== "/media")) {
    return null;
  }
  return `${pathname}${url.search}`;
}

export function transformAssetConsoleBody(requestUrl, body, { token } = {}) {
  const pathname = new URL(requestUrl).pathname;
  const embedPrefix = assetConsoleEmbedPrefix(token);
  if (pathname === embedPrefix || pathname === `${embedPrefix}index.html`) {
    return Buffer.from(body.toString("utf8")
      .replaceAll('href="/', `href="${embedPrefix}`)
      .replaceAll('src="/', `src="${embedPrefix}`));
  }
  if (pathname.endsWith("/app.js")) {
    return Buffer.from(body.toString("utf8").replace(
      "if (!window.EventSource) return;",
      "return; // Embedded mode uses the existing timed refresh instead of SSE.",
    ));
  }
  return body;
}

export function responseHeadersForCdp(headers, bodyLength) {
  const blocked = new Set(["content-length", "transfer-encoding", "content-encoding", "connection"]);
  const result = Object.entries(headers || {}).flatMap(([name, value]) => {
    if (value == null || blocked.has(name.toLowerCase())) return [];
    return [{ name, value: Array.isArray(value) ? value.join(", ") : String(value) }];
  });
  result.push({ name: "content-length", value: String(bodyLength) });
  return result;
}
