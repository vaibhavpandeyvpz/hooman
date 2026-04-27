/**
 * Copy bundled runtime assets next to compiled output under dist/.
 * Run after emitting JS so fileURLToPath-relative markdown lookups still work.
 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");

const assets = [
  {
    label: "static prompts",
    src: join(root, "src/core/prompts/static"),
    dest: join(root, "dist/core/prompts/static"),
  },
  {
    label: "harness prompts",
    src: join(root, "src/core/prompts/harness"),
    dest: join(root, "dist/core/prompts/harness"),
  },
  {
    label: "agent prompts",
    src: join(root, "src/core/prompts/agents"),
    dest: join(root, "dist/core/prompts/agents"),
  },
  {
    label: "built-in skills",
    src: join(root, "src/core/skills/built-in"),
    dest: join(root, "dist/core/skills/built-in"),
  },
];

for (const asset of assets) {
  await mkdir(dirname(asset.dest), { recursive: true });
  await cp(asset.src, asset.dest, { recursive: true });
  console.log(`Copied ${asset.label}: ${asset.src} -> ${asset.dest}`);
}
