#!/usr/bin/env node

import assert from "node:assert/strict";

const port = Number(process.env.CODEX_DEBUG_PORT ?? 9231);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url === "app://-/index.html");
assert.ok(target?.webSocketDebuggerUrl, "Codex renderer is unavailable");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  pending.get(message.id)(message);
  pending.delete(message.id);
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description ?? "Runtime evaluation failed");
  }
  return response.result.result.value;
}

async function waitForValue(read, accept, message, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

async function waitForBoard() {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(`(() => {
      window.__codexTaskboardInjection__?.open();
      const frame = document.getElementById("codex-taskboard-frame");
      const doc = frame?.contentDocument;
      doc?.querySelector('[aria-label="返回项目首页"]')?.click();
      const outer = doc?.querySelector(".project-swimlane-scroll");
      const lane = [...(doc?.querySelectorAll(".project-swimlane") ?? [])]
        .find((candidate) => candidate.querySelectorAll(".project-swimlane-card").length > 2);
      const list = lane?.querySelector(".project-swimlane-list");
      const handle = lane?.querySelector(".project-swimlane-resize-handle");
      const frameRect = frame?.getBoundingClientRect();
      const listRect = list?.getBoundingClientRect();
      const localX = listRect ? listRect.x + Math.min(listRect.width / 2, 80) : 0;
      const localY = listRect ? listRect.y + Math.min(listRect.height / 2, 100) : 0;
      const globalTarget = frameRect ? document.elementFromPoint(frameRect.x + localX, frameRect.y + localY) : null;
      const localTarget = doc?.elementFromPoint(localX, localY);
      return Boolean(
        frame?.offsetParent
        && outer
        && outer.scrollWidth > outer.clientWidth
        && list
        && list.scrollHeight > list.clientHeight
        && handle?.getBoundingClientRect().height
        && globalTarget === frame
        && localTarget?.closest(".project-swimlane-list") === list
      );
    })()`);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Project swimlane board did not become ready");
}

async function wheelAt(x, y, deltaX, deltaY) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  for (let step = 0; step < 4; step += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round(x),
      y: Math.round(y),
      deltaX: deltaX / 4,
      deltaY: deltaY / 4,
      modifiers: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 45));
  }
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function dragHandle(from, deltaX) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, button: "none", buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  for (let step = 1; step <= 6; step += 1) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x + (deltaX * step / 6),
      y: from.y,
      button: "left",
      buttons: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x + deltaX, y: from.y, button: "left", buttons: 0, clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 180));
}

try {
  await waitForBoard();
  const geometry = await evaluate(`(() => {
    const frame = document.getElementById("codex-taskboard-frame");
    const doc = frame.contentDocument;
    const frameRect = frame.getBoundingClientRect();
    const outer = doc.querySelector(".project-swimlane-scroll");
    const lane = [...doc.querySelectorAll(".project-swimlane")]
      .find((candidate) => candidate.querySelectorAll(".project-swimlane-card").length > 2);
    const list = lane?.querySelector(".project-swimlane-list");
    const handle = lane?.querySelector(".project-swimlane-resize-handle");
    const listRect = list?.getBoundingClientRect();
    const handleRect = handle?.getBoundingClientRect();
    outer.scrollTo({ left: 0, top: 0 });
    if (list) list.scrollTop = 0;
    return {
      point: listRect ? {
        x: frameRect.x + listRect.x + Math.min(listRect.width / 2, 80),
        y: frameRect.y + listRect.y + Math.min(listRect.height / 2, 100),
      } : null,
      handlePoint: handleRect ? {
        x: frameRect.x + handleRect.x + handleRect.width / 2,
        y: frameRect.y + handleRect.y + Math.min(handleRect.height / 2, 120),
      } : null,
      listScrollable: Boolean(list && list.scrollHeight > list.clientHeight),
      outerScrollable: outer.scrollWidth > outer.clientWidth,
      laneWidth: lane?.getBoundingClientRect().width ?? 0,
      otherLaneWidth: lane?.nextElementSibling?.getBoundingClientRect().width ?? 0,
    };
  })()`);

  assert.equal(geometry.listScrollable, true, "a populated swimlane must own vertical scrolling");
  assert.equal(geometry.outerScrollable, true, "the swimlane board must own horizontal scrolling");
  assert.ok(geometry.point, "a populated swimlane was not found");

  await wheelAt(geometry.point.x, geometry.point.y, 0, 360);
  const verticalScrollTop = await waitForValue(
    () => evaluate(`(() => {
      const frame = document.getElementById("codex-taskboard-frame");
      const lane = [...frame.contentDocument.querySelectorAll(".project-swimlane")]
        .find((candidate) => candidate.querySelectorAll(".project-swimlane-card").length > 2);
      return lane.querySelector(".project-swimlane-list").scrollTop;
    })()`),
    (value) => value > 0,
    "mouse-wheel input did not scroll a swimlane vertically",
  );

  assert.ok(geometry.handlePoint, "each swimlane must expose a width resize handle");
  await dragHandle(geometry.handlePoint, 72);
  const resizedWidths = await waitForValue(
    () => evaluate(`(() => {
      const frame = document.getElementById("codex-taskboard-frame");
      const lane = [...frame.contentDocument.querySelectorAll(".project-swimlane")]
        .find((candidate) => candidate.querySelectorAll(".project-swimlane-card").length > 2);
      return {
        selected: lane.getBoundingClientRect().width,
        adjacent: lane.nextElementSibling.getBoundingClientRect().width,
      };
    })()`),
    (value) => value.selected >= geometry.laneWidth + 60,
    "dragging the divider did not widen the selected swimlane",
  );
  assert.ok(
    resizedWidths.selected >= geometry.laneWidth + 60,
    `dragging the divider must widen the selected swimlane (${geometry.laneWidth} -> ${resizedWidths.selected})`,
  );
  assert.equal(resizedWidths.adjacent, geometry.otherLaneWidth, "resizing one swimlane must not change its neighbor");

  const resetHandlePoint = await evaluate(`(() => {
    const frame = document.getElementById("codex-taskboard-frame");
    const lane = [...frame.contentDocument.querySelectorAll(".project-swimlane")]
      .find((candidate) => candidate.querySelectorAll(".project-swimlane-card").length > 2);
    const rect = lane.querySelector(".project-swimlane-resize-handle").getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return { x: frameRect.x + rect.x + rect.width / 2, y: frameRect.y + rect.y + Math.min(rect.height / 2, 120) };
  })()`);
  await dragHandle(resetHandlePoint, -72);

  await wheelAt(geometry.point.x, geometry.point.y, 320, 0);
  const horizontalScrollLeft = await waitForValue(
    () => evaluate(`document.getElementById("codex-taskboard-frame").contentDocument.querySelector(".project-swimlane-scroll").scrollLeft`),
    (value) => value > 0,
    "horizontal wheel input did not scroll the swimlane board",
  );

  console.log(JSON.stringify({
    verticalScrollTop,
    horizontalScrollLeft,
    laneWidthBefore: geometry.laneWidth,
    laneWidthAfter: resizedWidths.selected,
  }, null, 2));
} finally {
  try {
    await evaluate(`(() => {
      const frame = document.getElementById("codex-taskboard-frame");
      const doc = frame?.contentDocument;
      doc?.querySelector(".project-swimlane-scroll")?.scrollTo({ left: 0, top: 0 });
      doc?.querySelectorAll(".project-swimlane-list").forEach((list) => { list.scrollTop = 0; });
    })()`);
  } catch {
    // The live renderer may be replaced while the verification is closing.
  }
  socket.close();
}
