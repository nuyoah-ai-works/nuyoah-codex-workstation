// Adapted from Codex Workspace Enhancer 8552882 (MIT); read-only filename parsing.
import path from 'node:path';
const mjNamePattern = /^u(?<userId>\d+)__(?<payload>.*?)_(?<jobId>[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})_(?<variant>\d+)\.(?<ext>png|jpe?g|webp)$/iu;

function aspectLabel(value) {
  const compact = String(value || "").replace(/[^0-9]/g, "");
  return ({ "11": "1:1", "169": "16:9", "916": "9:16", "43": "4:3", "34": "3:4", "32": "3:2", "23": "2:3" })[compact]
    || String(value || "").replace(/_/g, ":");
}

function parameterParts(payload) {
  const firstParameter = payload.search(/(?:^|_)--[a-z][a-z0-9-]*_/iu);
  const prompt = firstParameter < 0 ? payload : payload.slice(0, firstParameter).replace(/_+$/u, "");
  const parameterText = firstParameter < 0 ? "" : payload.slice(firstParameter).replace(/^_+/u, "");
  const parameters = {};
  for (const segment of parameterText.split(/_(?=--[a-z][a-z0-9-]*_)/iu)) {
    const match = segment.match(/^--([a-z][a-z0-9-]*)_(.*)$/iu);
    if (match) parameters[match[1].toLowerCase()] = match[2].replace(/_+$/u, "");
  }
  return {
    prompt: prompt.replace(/_+/g, " ").trim(),
    parameters
  };
}

export function parseMidjourneyFilename(fileName) {
  const name = path.basename(String(fileName || ""));
  const match = name.match(mjNamePattern);
  if (!match?.groups) return null;
  const { prompt, parameters } = parameterParts(match.groups.payload);
  const profileValue = parameters.profile || parameters.p || "";
  const profiles = profileValue.split("_").map((item) => item.trim()).filter((item) => /^[a-z0-9]+$/iu.test(item));
  const aspect = aspectLabel(parameters.ar || "");
  const lead = prompt || (profiles.length ? `P值 ${profiles[0]}` : "Midjourney 图片");
  return {
    name,
    userId: match.groups.userId,
    jobId: match.groups.jobId.toLowerCase(),
    variant: Number(match.groups.variant),
    extension: `.${match.groups.ext.toLowerCase().replace("jpeg", "jpg")}`,
    prompt,
    parameters,
    profiles,
    aspect,
    label: `${lead.slice(0, 52)} · #${Number(match.groups.variant) + 1}`
  };
}
