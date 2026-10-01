import assert from "node:assert/strict";
import test from "node:test";

async function usageModule() {
  return import("../lib/usage-data.mjs").catch(() => ({}));
}

test("latest Codex rate-limit event determines the truthful remaining percentage", async () => {
  const { parseRateLimitLines } = await usageModule();
  const lines = [
    JSON.stringify({
      timestamp: "2026-08-09T10:00:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 35, window_minutes: 10080, resets_at: 1786825820 },
          secondary: null,
          plan_type: "prolite",
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-08-09T12:22:49Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 48, window_minutes: 10080, resets_at: 1786825820 },
          secondary: null,
          plan_type: "prolite",
        },
      },
    }),
  ];

  assert.deepEqual(parseRateLimitLines?.(lines), {
    limitId: "codex",
    planType: "prolite",
    usedPercent: 48,
    remainingPercent: 52,
    windowMinutes: 10080,
    resetsAt: "2026-08-15T20:30:20.000Z",
  });
});

test("the most constrained active window is displayed when Codex returns two limits", async () => {
  const { parseRateLimitLines } = await usageModule();
  const lines = [JSON.stringify({
    timestamp: "2026-08-09T12:22:49Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: 22, window_minutes: 300, resets_at: 1786230000 },
        secondary: { used_percent: 70, window_minutes: 10080, resets_at: 1786825820 },
        plan_type: "prolite",
      },
    },
  })];

  assert.equal(parseRateLimitLines?.(lines)?.remainingPercent, 30);
  assert.equal(parseRateLimitLines?.(lines)?.windowMinutes, 10080);
});

test("usage presentation is compact and has an honest unavailable fallback", async () => {
  const { presentRateLimit } = await usageModule();
  const usage = {
    remainingPercent: 52,
    usedPercent: 48,
    windowMinutes: 10080,
    resetsAt: "2026-08-15T20:30:20.000Z",
  };

  assert.deepEqual(presentRateLimit?.(usage, { timeZone: "Asia/Shanghai" }), {
    available: true,
    text: "本周剩余 52%",
    remainingPercent: 52,
    tone: "normal",
    ariaLabel: "Codex 本周额度剩余 52%，8月16日 04:30 重置",
  });
  assert.deepEqual(presentRateLimit?.(null), {
    available: false,
    text: "剩余量 --",
    remainingPercent: null,
    tone: "muted",
    ariaLabel: "Codex 剩余量暂不可用",
  });
});
