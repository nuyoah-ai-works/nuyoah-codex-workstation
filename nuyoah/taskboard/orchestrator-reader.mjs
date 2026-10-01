import { existsSync } from "node:fs";

import { OrchestratorLedger } from "./orchestrator-ledger.mjs";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function unavailableBody({ configured, snapshot }) {
  if (!configured) {
    return {
      status: "unconfigured",
      reconnect: false,
      snapshotAt: null,
      schemaVersion: null,
      schemaStatus: "unconfigured",
      requests: null,
      message: "尚未连接总管账本。",
    };
  }
  return {
    status: "reconnecting",
    reconnect: true,
    snapshotAt: snapshot?.snapshotAt ?? null,
    schemaVersion: snapshot?.schemaVersion ?? null,
    schemaStatus: snapshot?.schemaStatus ?? "unavailable",
    requests: snapshot?.requests ?? null,
    message: snapshot
      ? "总管账本暂时无法读取，当前显示上次可信结果。"
      : "总管账本暂时无法读取。请检查账本连接后重试。",
  };
}

export function validOrchestratorRequestId(value) {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export class OrchestratorRequestReader {
  constructor({ databasePath } = {}) {
    this.databasePath = typeof databasePath === "string" && databasePath.trim()
      ? databasePath.trim()
      : null;
    this.lastListSnapshot = null;
    this.lastDetailSnapshots = new Map();
  }

  #read(callback) {
    if (!this.databasePath || !existsSync(this.databasePath)) {
      throw new Error("Ledger database is unavailable");
    }
    const ledger = new OrchestratorLedger(this.databasePath, {
      readOnly: true,
      allowUnsupportedSchema: true,
    });
    try {
      return {
        value: ledger.schemaCompatibility === "unsupported_newer_schema"
          || ledger.schemaCompatibility === "unsupported_older_schema"
          ? null
          : callback(ledger),
        schemaVersion: ledger.schemaVersion,
        schemaCompatibility: ledger.schemaCompatibility,
      };
    } finally {
      ledger.close();
    }
  }

  list() {
    if (!this.databasePath) {
      return { statusCode: 503, body: unavailableBody({ configured: false }) };
    }
    try {
      const snapshotAt = new Date().toISOString();
      const result = this.#read((ledger) => ledger.listRequests());
      if (result.schemaCompatibility === "unsupported_newer_schema"
        || result.schemaCompatibility === "unsupported_older_schema") {
        return {
          statusCode: 409,
          body: {
            status: result.schemaCompatibility,
            reconnect: false,
            snapshotAt: null,
            schemaVersion: result.schemaVersion,
            schemaStatus: result.schemaCompatibility,
            requests: null,
            message: result.schemaCompatibility === "unsupported_newer_schema"
              ? "委托账本版本高于当前工作站。已停止读取，未迁移或修改数据。"
              : "委托账本版本过旧且无法安全读取。已停止读取，未修改数据。",
          },
        };
      }
      const schemaStatus = result.schemaCompatibility;
      const body = {
        status: "connected",
        reconnect: false,
        snapshotAt,
        schemaVersion: result.schemaVersion,
        schemaStatus,
        requests: result.value,
        ...(schemaStatus === "read_only_degraded"
          ? { message: "当前是旧版委托账本，仅显示基础任务状态；血缘、路由和候选状态不可用。" }
          : {}),
      };
      this.lastListSnapshot = body;
      return { statusCode: 200, body };
    } catch {
      return {
        statusCode: 503,
        body: unavailableBody({ configured: true, snapshot: this.lastListSnapshot }),
      };
    }
  }

  detail(requestId) {
    if (!this.databasePath) {
      return {
        statusCode: 503,
        body: {
          ...unavailableBody({ configured: false }),
          request: null,
        },
      };
    }
    try {
      const snapshotAt = new Date().toISOString();
      const result = this.#read((ledger) => ledger.getRequest(requestId, { includeEvents: true }));
      if (result.schemaCompatibility === "unsupported_newer_schema"
        || result.schemaCompatibility === "unsupported_older_schema") {
        return {
          statusCode: 409,
          body: {
            status: result.schemaCompatibility,
            reconnect: false,
            snapshotAt: null,
            schemaVersion: result.schemaVersion,
            schemaStatus: result.schemaCompatibility,
            request: null,
            message: "当前工作站不支持这个委托账本版本；没有读取或修改记录。",
          },
        };
      }
      if (!result.value) {
        return {
          statusCode: 404,
          body: { error: { code: "REQUEST_NOT_FOUND", message: "委托记录不存在或已被移除。" } },
        };
      }
      const schemaStatus = result.schemaCompatibility;
      const body = {
        status: "connected",
        reconnect: false,
        snapshotAt,
        schemaVersion: result.schemaVersion,
        schemaStatus,
        request: result.value,
        ...(schemaStatus === "read_only_degraded"
          ? { message: "当前是旧版委托账本，详情只包含基础状态。" }
          : {}),
      };
      this.lastDetailSnapshots.set(requestId, body);
      return { statusCode: 200, body };
    } catch {
      const snapshot = this.lastDetailSnapshots.get(requestId);
      return {
        statusCode: 503,
        body: {
          ...unavailableBody({
            configured: true,
            snapshot: snapshot ? {
              snapshotAt: snapshot.snapshotAt,
              requests: null,
              schemaVersion: snapshot.schemaVersion,
              schemaStatus: snapshot.schemaStatus,
            } : null,
          }),
          request: snapshot?.request ?? null,
        },
      };
    }
  }
}
