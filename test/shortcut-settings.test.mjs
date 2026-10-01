import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../inject/conversation-preview.user.js", import.meta.url), "utf8");

test("shortcut settings persist visibility and custom entries", () => {
  assert.match(source, /codex-conversation-preview:shortcut-settings/);
  assert.match(source, /codexSidebarShortcutSettings/);
  assert.match(source, /codexShortcutVisible/);
  assert.match(source, /data-codex-shortcut-custom-form/);
  assert.match(source, /localStorage\.setItem\(SHORTCUT_SETTINGS_STORAGE_KEY/);
});

test("the unified workstation participates in the same visibility menu", () => {
  assert.match(source, /name:\s*"工作站"/);
  assert.match(source, /id:\s*"workstation"/);
  assert.match(source, /kind:\s*"enhancement"/);
  assert.match(source, /openWorkstationPanel/);
  assert.match(source, /openSkillsGrouping/);
  assert.match(source, /openAssetConsolePanel/);
  assert.match(source, /shortcutCatalog\.filter\(\(item\) => item\.kind !== "settings"\)/);
});

test("workstation font controls adjust one pixel and persist the selected size", () => {
  assert.match(source, /nuyoah-workstation:font-size-v1/);
  assert.match(source, /WORKSTATION_FONT_SIZE_MIN = 11/);
  assert.match(source, /WORKSTATION_FONT_SIZE_MAX = 18/);
  assert.match(source, /WORKSTATION_FONT_SIZE_DEFAULT = 17/);
  assert.match(source, /savedFontSize === null \? NaN : Number\(savedFontSize\)/);
  assert.match(source, /decrease\.dataset\.nuyoahWorkstationFontAction = "decrease"/);
  assert.match(source, /increase\.dataset\.nuyoahWorkstationFontAction = "increase"/);
  assert.match(source, /setWorkstationFontSize\(workstationFontSize - 1\)/);
  assert.match(source, /setWorkstationFontSize\(workstationFontSize \+ 1\)/);
  assert.match(source, /localStorage\.setItem\(WORKSTATION_FONT_SIZE_KEY/);
});

test("custom shortcuts support preset icons and both open modes", () => {
  assert.match(source, /SHORTCUT_ICON_PRESETS/);
  assert.match(source, /data-codex-shortcut-icon/);
  assert.match(source, /value="internal"/);
  assert.match(source, /value="browser"/);
  assert.match(source, /openCustomShortcutPanel/);
  assert.match(source, /openCustomShortcutInBrowser/);
});

test("custom shortcut URLs are restricted to http and https", () => {
  assert.match(source, /url\.protocol !== "https:" && url\.protocol !== "http:"/);
});
