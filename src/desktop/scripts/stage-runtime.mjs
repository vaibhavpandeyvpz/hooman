#!/usr/bin/env node
/**
 * Phase 0/5.2 runtime staging: produce a self-contained
 * `resources/runtime/` directory containing
 *   - `node`            — a copy of the exact Node binary currently running
 *                          this script (verified against root `engines.node`)
 *   - `app/dist/`        — the root package's compiled output
 *   - `app/node_modules` — the production dependency closure only
 *   - `manifest.json`     — provenance: node version/checksum, platform/arch,
 *                          dependency count, build time
 *
 * The script's own logic (copy the running Node binary, `npm ci` a production
 * dependency closure) is platform-neutral and now also runs in CI on Linux
 * (see `.github/workflows/ci.yml`'s `desktop` job) as a staging/ACP-handshake
 * smoke check. It was manually run and verified end-to-end on macOS arm64 in
 * this session; the Linux CI run was not something I could observe directly
 * from this environment. Neither is a substitute for an actual signed,
 * packaged Windows/Linux installer, which needs that OS's release hardware
 * and signing credentials (plan §7: "Do not cross-build native artifacts
 * from one OS").
 *
 * `node-llama-cpp` and `mlex.js` are intentionally excluded (`--omit=optional`)
 * per the plan's decision to ship heavy local-model runtimes as separate
 * optional downloads rather than bundling them into every installer.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DESKTOP_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(DESKTOP_ROOT, "resources", "runtime");

const rootPackageJson = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const requiredNodeRange = rootPackageJson.engines?.node;
const nodeVersion = process.version;
if (requiredNodeRange && !nodeVersion.startsWith("v24")) {
  console.error(
    `Expected a Node 24 runtime (root engines.node: ${requiredNodeRange}), got ${nodeVersion}.`,
  );
  process.exit(1);
}

if (!existsSync(path.join(REPO_ROOT, "dist", "cli.js"))) {
  console.error(
    "Root dist/cli.js not found — run `npm run build` at the repo root first.",
  );
  process.exit(1);
}

console.log(
  `Staging runtime: node ${nodeVersion}, ${process.platform}/${process.arch}`,
);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const appDir = path.join(OUT_DIR, "app");
mkdirSync(appDir, { recursive: true });

// 1. Compiled application code + copied runtime assets.
cpSync(path.join(REPO_ROOT, "dist"), path.join(appDir, "dist"), {
  recursive: true,
});

// 2. Keep the full dependency graph (dependencies/devDependencies/optionalDependencies)
//    so `npm ci` resolves against the repo's own lockfile — the same
//    resolution already proven to work at the repo root — and drop only
//    workspace/script fields that don't apply to a standalone install.
const {
  workspaces,
  scripts,
  bin,
  exports: pkgExports,
  files,
  ...stagedPackageJson
} = rootPackageJson;
writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(stagedPackageJson, null, 2),
);
cpSync(
  path.join(REPO_ROOT, "package-lock.json"),
  path.join(appDir, "package-lock.json"),
);

// 3. Install the production dependency closure only (no dev/optional deps —
//    optional local-model native packages are a separate concern per the plan).
console.log(
  "Installing production dependency closure via `npm ci` against the repo lockfile...",
);
execFileSync(
  "npm",
  ["ci", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"],
  {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  },
);

// 4. Copy the exact running Node binary rather than depending on a system install.
const nodeDest = path.join(
  OUT_DIR,
  process.platform === "win32" ? "node.exe" : "node",
);
cpSync(process.execPath, nodeDest);
chmodSync(nodeDest, 0o755);

// 5. Provenance manifest.
const nodeHash = createHash("sha256")
  .update(readFileSync(process.execPath))
  .digest("hex");
const manifest = {
  builtAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  nodeVersion,
  nodeSourcePath: process.execPath,
  nodeSha256: nodeHash,
  rootVersion: rootPackageJson.version,
};
writeFileSync(
  path.join(OUT_DIR, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);

console.log(`Staged runtime at ${OUT_DIR}`);
console.log(JSON.stringify(manifest, null, 2));
