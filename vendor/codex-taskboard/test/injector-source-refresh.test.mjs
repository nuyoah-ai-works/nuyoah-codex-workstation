import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { refreshInjectionSource } from "../scripts/codex-injector-runtime.mjs";

const injector = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");

// Execute the production source builder without starting its app/CDP entrypoint.
test("a resident notices new HTML asset URLs and releases already-connected targets only on change", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "taskboard-source-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(path.join(projectRoot, "dist/web"), { recursive: true });
  const injectionPath = path.join(projectRoot, "user.js");
  const htmlPath = path.join(projectRoot, "dist/web/index.html");
  await writeFile(injectionPath, "window.fixture = true;");
  await writeFile(htmlPath, '<div id="root"></div><link href="/assets/old.css">');
  const builder = injector.slice(injector.indexOf("async function currentInjectionSource()"), injector.indexOf("async function main()"));
  const readSource = vm.runInNewContext(`${builder}\ncurrentInjectionSource`, {
    readFile, path, createHash, projectRoot, injectionPath,
    taskboardOrigin: "http://127.0.0.1:47823",
    taskboardPageUrl: "http://127.0.0.1:47823/?host=codex",
    injectionSourceHashName: "__CODEX_TASKBOARD_SOURCE_HASH__",
  });
  let current = await readSource();
  let closes = 0;
  const targets = new Map([["renderer", { close() { closes++; } }]]);
  assert.equal(await refreshInjectionSource(current, readSource, targets), current);
  assert.equal(closes, 0);
  await writeFile(htmlPath, '<div id="root"></div><link href="/assets/two-columns.css">');
  const updated = await refreshInjectionSource(current, readSource, targets);
  assert.notEqual(updated.sourceHash, current.sourceHash);
  assert.match(updated.source, /two-columns\.css/);
  assert.doesNotMatch(updated.source, /old\.css/);
  assert.equal(closes, 1);
  assert.equal(targets.size, 0);
  current = updated;
  targets.set("renderer", { close() { closes++; } });
  assert.equal(await refreshInjectionSource(current, readSource, targets), current);
  assert.equal(closes, 1);
  await rm(htmlPath);
  await assert.rejects(refreshInjectionSource(current, readSource, targets), { code: "ENOENT" });
  assert.equal(targets.size, 1);
  assert.equal(closes, 1);
  await writeFile(htmlPath, '<div id="root"></div><link href="/assets/retry.css">');
  const recovered = await refreshInjectionSource(current, readSource, targets);
  assert.match(recovered.source, /retry\.css/);
  assert.equal(closes, 2);
});

test("watch refreshes source before reconciliation without forcing a closed panel open", () => {
  const loop = injector.slice(injector.indexOf("    while (true) {", injector.indexOf("async function main()")));
  assert.match(loop, /await refreshInjectionSource\([\s\S]*?await injectAll\(/);
  assert.match(loop, /sourceHash,\s*false,[^\n]*\n\s*null,\s*injectedTargets,\s*true,\s*supervisor,\s*true,/);
});
