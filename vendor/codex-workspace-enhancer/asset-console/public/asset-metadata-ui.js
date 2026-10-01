export function parseManualTags(value) {
  return String(value || "")
    .split(/[\n,，;；、]+/u)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function mergeManualTags(selectedTags = [], customTags = "") {
  const selected = Array.from(selectedTags || [], (tag) => String(tag || "").trim()).filter(Boolean);
  return [...new Set([...selected, ...parseManualTags(customTags)])];
}

export function defaultManualSmartGroup(asset = {}, intent = "metadata") {
  if (intent === "manual-category" && asset.smartGroup === "review") return "asset";
  return ["asset", "review", "noise"].includes(asset.smartGroup) ? asset.smartGroup : "review";
}
