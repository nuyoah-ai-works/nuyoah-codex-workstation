import { connectMainCodex } from "./cdp-client.mjs";
import { writeFile } from "node:fs/promises";

const title = process.argv.slice(2).join(" ") || "更新 Codex 对话展示逻辑";
const client = await connectMainCodex(Number(process.env.CODEX_DEBUG_PORT || 9231));

try {
  let row = await client.evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'))
      .find((element) => element.getAttribute('data-app-action-sidebar-thread-title') === ${JSON.stringify(title)});
    if (!target) return null;
    const scroll = document.querySelector('[data-app-action-sidebar-scroll]');
    const initialRect = target.getBoundingClientRect();
    const scrollRect = scroll?.getBoundingClientRect();
    if (scroll && scrollRect) {
      scroll.scrollTop += initialRect.top - scrollRect.top - (scrollRect.height - initialRect.height) / 2;
    }
    const rect = target.getBoundingClientRect();
    return {
      id: target.getAttribute('data-app-action-sidebar-thread-id'),
      html: target.outerHTML,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`);
  if (!row) throw new Error(`Thread row not found: ${title}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  row = await client.evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'))
      .find((element) => element.getAttribute('data-app-action-sidebar-thread-title') === ${JSON.stringify(title)});
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      id: target.getAttribute('data-app-action-sidebar-thread-id'),
      html: target.outerHTML,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    row.rect = await client.evaluate(`(() => {
      const target = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]'))
        .find((element) => element.getAttribute('data-app-action-sidebar-thread-title') === ${JSON.stringify(title)});
      const rect = target?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    })()`);
    if (!row.rect) break;
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: row.rect.x + Math.min(row.rect.width / 2, 180),
      y: row.rect.y + row.rect.height / 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const overlay = await client.evaluate(`(() => ({
    rowState: document.querySelector('[data-app-action-sidebar-thread-title=${JSON.stringify(title)}]')?.getAttribute('data-state'),
    bodyTextTail: document.body.innerText.slice(-2000),
    candidates: Array.from(document.body.children).slice(-8).map((element) => ({
      tag: element.tagName,
      text: element.innerText?.slice(0, 1600),
      html: element.outerHTML.slice(0, 10000),
      computed: element.matches?.('[role="tooltip"]') ? {
        width: getComputedStyle(element).width,
        maxWidth: getComputedStyle(element).maxWidth,
        fields: Array.from(element.querySelectorAll('.codex-conversation-preview-text')).map((field) => ({
          lineClamp: getComputedStyle(field).webkitLineClamp,
          lineHeight: getComputedStyle(field).lineHeight,
          overflow: getComputedStyle(field).overflow,
        })),
      } : null,
    })),
  }))()`);
  if (process.env.SCREENSHOT_PATH) {
    const capture = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(process.env.SCREENSHOT_PATH, Buffer.from(capture.data, "base64"));
  }
  console.log(JSON.stringify({ row, overlay }, null, 2));
} finally {
  client.close();
}
