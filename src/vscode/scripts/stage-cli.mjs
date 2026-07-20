import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(extensionDir, "../..");
const runtimeDir = join(extensionDir, "runtime");

const rootPackage = JSON.parse(
  await readFile(join(rootDir, "package.json"), "utf8"),
);
const extensionPackage = JSON.parse(
  await readFile(join(extensionDir, "package.json"), "utf8"),
);
if (rootPackage.version !== extensionPackage.version) {
  throw new Error(
    `Root CLI version ${rootPackage.version} does not match extension version ${extensionPackage.version}.`,
  );
}

await rm(runtimeDir, { recursive: true, force: true });
await mkdir(runtimeDir, { recursive: true });
await Promise.all([
  cp(join(rootDir, "dist"), join(runtimeDir, "dist"), { recursive: true }),
  cp(join(rootDir, "node_modules"), join(runtimeDir, "node_modules"), {
    recursive: true,
  }),
  cp(join(rootDir, "package.json"), join(runtimeDir, "package.json")),
]);

console.log(`Staged Hooman CLI ${rootPackage.version} in ${runtimeDir}`);
