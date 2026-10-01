#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  createLedgerBackup,
  LedgerError,
  OrchestratorLedger,
  executeLedgerCommand,
} from "../nuyoah/taskboard/orchestrator-ledger.mjs";

const INPUT_LIMIT = 1024 * 1024;
const READ_ONLY_COMMANDS = new Set(["open.list", "request.get", "ownership.check", "database.inspect"]);

async function readCommand(input = process.stdin) {
  input.setEncoding("utf8");
  let source = "";
  for await (const chunk of input) {
    source += chunk;
    if (source.length > INPUT_LIMIT) {
      throw new LedgerError("INPUT_TOO_LARGE", "stdin JSON command cannot exceed 1 MiB");
    }
  }
  if (!source.trim()) throw new LedgerError("EMPTY_INPUT", "stdin must contain one JSON command");
  try {
    return JSON.parse(source);
  } catch {
    throw new LedgerError("INVALID_JSON", "stdin must contain one valid JSON command");
  }
}

export async function runCli({
  databasePath = process.env.NUYOAH_ORCHESTRATOR_DB,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  let ledger;
  try {
    if (!databasePath) {
      throw new LedgerError(
        "DB_PATH_REQUIRED",
        "Set NUYOAH_ORCHESTRATOR_DB to the orchestrator.sqlite3 file before running this command",
      );
    }
    const command = await readCommand(input);
    const commandName = typeof command?.command === "string" ? command.command : "";
    if (commandName === "backup.create") {
      const result = await createLedgerBackup(databasePath, command);
      output.write(`${JSON.stringify({ ok: true, ...result })}\n`);
      return 0;
    }
    ledger = new OrchestratorLedger(databasePath, commandName === "migrate"
      ? { migrate: true }
      : READ_ONLY_COMMANDS.has(commandName)
        ? { readOnly: true, allowUnsupportedSchema: true }
        : {});
    const result = executeLedgerCommand(ledger, command);
    output.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  } catch (error) {
    const known = error instanceof LedgerError;
    output.write(`${JSON.stringify({
      ok: false,
      error: {
        code: known ? error.code : "DB_OPERATION_FAILED",
        message: known
          ? error.message
          : "The orchestrator ledger operation failed; verify that the database is writable and retry",
        ...(known && error.details !== undefined ? { details: error.details } : {}),
      },
    })}\n`);
    return 1;
  } finally {
    ledger?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli();
}
