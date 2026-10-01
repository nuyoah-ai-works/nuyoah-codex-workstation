const DEFAULT_TIMEOUT_MS = 30_000;
const TIMEOUT_MESSAGE = "资产扫描超时，请检查关联文件夹是否可访问后重试";

export function createAssetScanCoordinator({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const inFlight = new Map();

  function waitFor(pending) {
    const duration = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), duration);
      pending.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  return {
    run(projectId, scan) {
      const key = String(projectId || "");
      if (inFlight.has(key)) return waitFor(inFlight.get(key));

      const pending = Promise.resolve().then(scan);
      inFlight.set(key, pending);
      pending.finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }).catch(() => {});
      return waitFor(pending);
    },
  };
}
