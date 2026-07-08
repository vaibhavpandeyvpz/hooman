import os from "node:os";

/**
 * mlex.js ships prebuilt binaries only for `aarch64-apple-darwin` and its MLX
 * Metal kernels require macOS 26 (Tahoe) or newer. Loading the native addon on
 * an older macOS can abort the process (an uncatchable SIGABRT rather than a
 * JS exception), so callers guard on this *before* touching native code.
 *
 * macOS 26 corresponds to Darwin kernel major 25 (macOS 15 Sequoia was Darwin
 * 24), so a Darwin major of 25+ maps to macOS 26+.
 */
const MIN_DARWIN_MAJOR = 25;

/**
 * Returns a human-readable reason why MLX inference cannot run on the current
 * system, or `undefined` when it is supported (Apple Silicon + macOS 26+).
 */
export function mlxUnsupportedReason(): string | undefined {
  if (process.platform !== "darwin") {
    return `MLX inference requires macOS on Apple Silicon (this system is ${process.platform}).`;
  }
  if (process.arch !== "arm64") {
    return `MLX inference requires Apple Silicon (arm64); this system reports ${process.arch}.`;
  }
  const major = Number.parseInt(os.release().split(".")[0] ?? "", 10);
  if (Number.isFinite(major) && major > 0 && major < MIN_DARWIN_MAJOR) {
    return "MLX inference requires macOS 26 (Tahoe) or newer.";
  }
  return undefined;
}
