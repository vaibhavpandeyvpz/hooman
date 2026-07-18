#!/usr/bin/env node
/**
 * Verifies a staged runtime (`resources/runtime/`) in isolation: spawns the
 * staged Node binary against the staged `app/dist/cli.js acp`, with `PATH`
 * and `NODE_PATH` reset so it cannot silently fall back to this repo's dev
 * `node_modules` or system Node. Performs a real `initialize` -> `session/new`
 * -> `session/close` round trip against a throwaway project directory —
 * enough to prove the staged binary + dependency closure speaks ACP
 * correctly without any network calls or model provider credentials.
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = path.join(DESKTOP_ROOT, "resources", "runtime");
const nodeBin = path.join(
  RUNTIME_DIR,
  process.platform === "win32" ? "node.exe" : "node",
);
const cliEntry = path.join(RUNTIME_DIR, "app", "dist", "cli.js");

if (!existsSync(nodeBin) || !existsSync(cliEntry)) {
  console.error(
    `Staged runtime not found at ${RUNTIME_DIR}. Run \`npm run desktop:stage-runtime\` first.`,
  );
  process.exit(1);
}

const manifest = JSON.parse(
  readFileSync(path.join(RUNTIME_DIR, "manifest.json"), "utf8"),
);
console.log("Verifying staged runtime:", manifest);

const projectDir = mkdtempSync(
  path.join(tmpdir(), "hooman-desktop-runtime-check-"),
);

const child = spawn(nodeBin, [cliEntry, "acp"], {
  cwd: projectDir,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    PATH: "/usr/bin:/bin", // deliberately excludes nvm/system node & the repo's own node_modules/.bin
    HOME: process.env.HOME,
    HOOMAN_HOME: mkdtempSync(
      path.join(tmpdir(), "hooman-desktop-runtime-home-"),
    ),
  },
});

let nextId = 1;
const pending = new Map();
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) =>
  process.stderr.write(`[staged acp] ${chunk}`),
);

const rl = readline.createInterface({ input: child.stdout });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (
    message.id !== undefined &&
    message.method === undefined &&
    pending.has(message.id)
  ) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (
    message.id !== undefined &&
    message.method === "session/request_permission"
  ) {
    const optionId = message.params.options[0].optionId;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "selected", optionId } } })}\n`,
    );
  }
});

let failed = false;
try {
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: "hooman-desktop-runtime-check", version: "0.1.0" },
  });
  console.log("initialize ->", JSON.stringify(init).slice(0, 200));

  const session = await request("session/new", {
    cwd: projectDir,
    mcpServers: [],
  });
  console.log("session/new -> sessionId:", session.sessionId);

  await request("session/close", { sessionId: session.sessionId });
  console.log("session/close -> ok");

  console.log("\nStaged runtime is self-contained and speaks ACP correctly.");
} catch (error) {
  failed = true;
  console.error("Staged runtime verification failed:", error);
} finally {
  child.kill();
  rmSync(projectDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
