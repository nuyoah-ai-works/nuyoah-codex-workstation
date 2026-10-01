import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const helperUrl = new URL(
  "../vendor/codex-workspace-enhancer/asset-console/public/asset-metadata-ui.js",
  import.meta.url,
);

test("manual tags merge preset choices and free-form input without duplicates", async () => {
  assert.equal(existsSync(helperUrl), true, "manual metadata UI helper is missing");
  const { mergeManualTags } = await import(helperUrl);

  assert.deepEqual(
    mergeManualTags(["主角", "已审核"], "重要，主角；夜景\n可复用"),
    ["主角", "已审核", "重要", "夜景", "可复用"],
  );
});

test("manual classification promotes review assets while manual tagging keeps them in review", async () => {
  assert.equal(existsSync(helperUrl), true, "manual metadata UI helper is missing");
  const { defaultManualSmartGroup } = await import(helperUrl);
  const reviewAsset = { smartGroup: "review" };

  assert.equal(defaultManualSmartGroup(reviewAsset, "manual-category"), "asset");
  assert.equal(defaultManualSmartGroup(reviewAsset, "manual-tags"), "review");
  assert.equal(defaultManualSmartGroup(reviewAsset, "metadata"), "review");
});
