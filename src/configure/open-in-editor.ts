import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import tty from "node:tty";

/**
 * Open a real file in VISUAL / EDITOR (or a sensible platform default),
 * block until the editor exits, then return the updated contents.
 *
 * This temporarily releases TTY raw mode so Ink can coexist with full-screen
 * terminal editors like vim / nano.
 */
export function openFileInEditor(
  filePath: string,
  initialContent: string,
): string {
  mkdirSync(dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, initialContent, "utf8");
  }

  const restore = releaseStdinForSubprocess();
  try {
    const { command, args, options } = resolveEditorSpawn(filePath);
    const result = spawnSync(command, args, options);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0 && result.status !== null) {
      throw new Error(`Editor exited with code ${result.status}`);
    }
    return readFileSync(filePath, "utf8");
  } finally {
    restore();
  }
}

function releaseStdinForSubprocess(): () => void {
  if (!process.stdin.isTTY) {
    return () => {};
  }
  const stdin = process.stdin as tty.ReadStream;
  const wasRaw = stdin.isRaw;
  if (wasRaw) {
    stdin.setRawMode(false);
  }
  stdin.pause();
  return () => {
    stdin.resume();
    if (wasRaw) {
      stdin.setRawMode(true);
    }
  };
}

function resolveEditorSpawn(filePath: string): {
  command: string;
  args: string[];
  options: { stdio: "inherit"; shell?: boolean };
} {
  const spec = (process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (!spec) {
    if (process.platform === "win32") {
      return {
        command: "notepad",
        args: [filePath],
        options: { stdio: "inherit" },
      };
    }
    return {
      command: "vi",
      args: [filePath],
      options: { stdio: "inherit" },
    };
  }

  if (process.platform === "win32") {
    return {
      command: `${spec} "${filePath.replace(/"/g, '\\"')}"`,
      args: [],
      options: { stdio: "inherit", shell: true },
    };
  }

  const parts = tokenizeEditorSpec(spec);
  if (parts.length === 0) {
    return {
      command: "vi",
      args: [filePath],
      options: { stdio: "inherit" },
    };
  }

  return {
    command: parts[0]!,
    args: [...parts.slice(1), filePath],
    options: { stdio: "inherit" },
  };
}

/** Split VISUAL/EDITOR on spaces with basic quoted-token support. */
function tokenizeEditorSpec(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) {
        quote = null;
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c as '"' | "'";
      continue;
    }
    if (/\s/.test(c)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur.length > 0) {
    out.push(cur);
  }
  return out;
}
