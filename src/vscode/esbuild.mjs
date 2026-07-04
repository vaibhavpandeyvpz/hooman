// Bundles the extension host (src/extension.ts + its relative imports) into a
// single out/extension.js. `vscode` and other Node built-ins stay external;
// everything else (including @agentclientprotocol/sdk and its zod dependency)
// gets inlined so the packaged .vsix ships without a node_modules directory.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** Mirrors the `esbuild-problem-matchers#onEnd` pattern from VS Code's own
 * extension samples, so `.vscode/tasks.json` can track watch build state. */
const watchLogPlugin = {
  name: "watch-log",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(
          `> ${location ? `${location.file}:${location.line}:${location.column}: ` : ""}error: ${text}`,
        );
      }
      console.log("[watch] build finished");
    });
  },
};

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "silent",
  plugins: [watchLogPlugin],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
