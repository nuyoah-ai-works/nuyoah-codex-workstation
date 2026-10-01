import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/injector.mjs", import.meta.url), "utf8");

test("injector only evaluates the public renderer in the top-level Codex frame", () => {
  assert.match(source, /if \(window\.top === window\)/);
  assert.doesNotMatch(source, /Runtime\.addBinding|Page\.setBypassCSP|TV_URL|readTaskboardSnapshot/);
});

test("injector keeps Chinese Skill labels in the local host bridge", () => {
  assert.match(source, /SkillChineseLabelService/);
  assert.match(source, /takeSkillLabelRequest/);
  assert.match(source, /skillLabelService\.decorate\(rawSkillCatalog\)/);
  assert.match(source, /skillLabelService\.generate\(rawSkillCatalog/);
  assert.match(source, /mode === "refresh"/);
  assert.match(source, /nextSkillCatalogRefreshAt = 0/);
});

test("injector never pushes local session history into the native conversation", () => {
  assert.doesNotMatch(source, /readConversationHistory/);
  assert.doesNotMatch(source, /setConversationHistory/);
  assert.doesNotMatch(source, /pushConversationHistory/);
});
