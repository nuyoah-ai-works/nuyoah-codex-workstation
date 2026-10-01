function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
}

function normalizeWindow(value) {
  const usedPercent = clampPercent(value?.used_percent);
  const windowMinutes = Number(value?.window_minutes);
  if (usedPercent == null || !Number.isFinite(windowMinutes) || windowMinutes <= 0) return null;
  const resetsAtSeconds = Number(value?.resets_at);
  const resetsAt = Number.isFinite(resetsAtSeconds) && resetsAtSeconds > 0
    ? new Date(resetsAtSeconds * 1000).toISOString()
    : null;
  return { usedPercent, windowMinutes, resetsAt };
}

export function parseRateLimitLines(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = String(lines[index] || "").trim();
    if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") continue;
    const limits = entry.payload.rate_limits;
    const windows = [normalizeWindow(limits?.primary), normalizeWindow(limits?.secondary)].filter(Boolean);
    if (!windows.length) continue;
    const governing = windows.reduce((current, candidate) => (
      candidate.usedPercent > current.usedPercent ? candidate : current
    ));
    return {
      limitId: String(limits.limit_id || "codex"),
      planType: limits.plan_type ? String(limits.plan_type) : null,
      usedPercent: governing.usedPercent,
      remainingPercent: Math.round(100 - governing.usedPercent),
      windowMinutes: governing.windowMinutes,
      resetsAt: governing.resetsAt,
    };
  }
  return null;
}

function windowLabel(minutes) {
  if (minutes === 10_080) return "本周";
  if (minutes === 1_440) return "今日";
  if (minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes}分钟`;
}

function resetLabel(value, timeZone) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${Number(part("month"))}月${Number(part("day"))}日 ${part("hour")}:${part("minute")}`;
}

export function presentRateLimit(usage, { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const remainingPercent = clampPercent(usage?.remainingPercent);
  if (remainingPercent == null) {
    return {
      available: false,
      text: "剩余量 --",
      remainingPercent: null,
      tone: "muted",
      ariaLabel: "Codex 剩余量暂不可用",
    };
  }
  const period = windowLabel(Number(usage.windowMinutes));
  const reset = resetLabel(usage.resetsAt, timeZone);
  const roundedRemaining = Math.round(remainingPercent);
  const tone = roundedRemaining <= 10 ? "critical" : roundedRemaining <= 30 ? "warning" : "normal";
  return {
    available: true,
    text: `${period}剩余 ${roundedRemaining}%`,
    remainingPercent: roundedRemaining,
    tone,
    ariaLabel: `Codex ${period}额度剩余 ${roundedRemaining}%${reset ? `，${reset} 重置` : ""}`,
  };
}
