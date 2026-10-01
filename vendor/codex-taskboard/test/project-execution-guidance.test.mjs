import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const appSource = await readFile(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const cardSource = await readFile(
  new URL("../web/src/components/ProjectSwimlaneBoard.tsx", import.meta.url),
  "utf8",
);
const detailSource = await readFile(
  new URL("../web/src/components/TaskDetail.tsx", import.meta.url),
  "utf8",
);

test("folder choices use the complete Codex catalog and preserve project display names", () => {
  assert.match(appSource, /listDeviceProjects\(signal\)/);
  assert.match(appSource, /label: project\.name/);
  assert.match(appSource, /task\.sourceWorkspacePath/);
  assert.match(appSource, /task\.sourceProjectId \? deviceWorkspacePaths\[task\.sourceProjectId\]/);
  assert.match(appSource, /<option key=\{option\.value\} value=\{option\.value\}>\{option\.label\}<\/option>/);
});

test("portfolio cards show grounded execution guidance instead of only the title", () => {
  assert.match(cardSource, /taskGuidance\(task\)/);
  assert.match(cardSource, />任务描述</);
  assert.match(cardSource, /guidance\.stage/);
  assert.match(cardSource, />下一步</);
  assert.match(cardSource, /aria-label="建议方向"/);
  assert.match(cardSource, /task\.sourceProjectName \?\?/);
});

test("detail suggestions send full project context through an explicit auto-submit path", () => {
  assert.match(detailSource, /下一步建议/);
  assert.match(detailSource, /onExecuteSuggestion\(currentTask, suggestion\)/);
  assert.match(appSource, /buildTaskExecutionPrompt\(\{/);
  assert.match(appSource, /task\.sourceWorkspacePath/);
  assert.match(appSource, /autoSubmit: options\?\.autoSubmit === true/);
});
