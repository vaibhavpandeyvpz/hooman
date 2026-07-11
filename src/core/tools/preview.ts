import { access } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import {
  createOsBrowserPreviewBackend,
  getBrowserPreviewBackend,
  setBrowserPreviewBackend,
} from "../utils/browser.js";
import { getCwd } from "../utils/cwd-context.js";
import {
  isResolvedPathInsideDir,
  normalizeUserPath,
} from "../utils/normalize-user-path.js";
import { designArtifactsPath } from "../utils/paths.js";
import {
  createPreviewServer,
  getPreviewServer,
  stopPreviewServer,
} from "../utils/preview-server.js";

export const PREVIEW_DESIGN_TOOL_NAME = "preview_design";
export const STOP_DESIGN_PREVIEW_TOOL_NAME = "stop_design_preview";

const previewPathSchema = z
  .string()
  .min(1)
  .describe(
    "Path to the HTML entry (usually .hooman/design/<slug>/index.html).",
  );

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function resolveLocalHtmlPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    if (trimmed.toLowerCase().startsWith("file:")) {
      try {
        return fileURLToPath(trimmed);
      } catch {
        return null;
      }
    }
    return null;
  }
  return normalizeUserPath(trimmed);
}

/**
 * Prefer `.hooman/design/<slug>/` as the serve root when the HTML lives there.
 */
export function previewRootForHtmlFile(htmlPath: string): string {
  const resolved = resolve(htmlPath);
  const designRoot = designArtifactsPath();
  if (isResolvedPathInsideDir(resolved, designRoot)) {
    const rel = relative(designRoot, resolved);
    const slug = rel.split(sep)[0];
    if (slug && slug !== ".." && slug !== ".") {
      return resolve(designRoot, slug);
    }
  }
  return resolve(resolved, "..");
}

export function createDesignPreviewTools() {
  return [
    tool({
      name: PREVIEW_DESIGN_TOOL_NAME,
      description:
        "Start a localhost hot-reload preview for an HTML design artifact and open it in the browser (VS Code Simple Browser when available, otherwise the system browser). Serves the artifact folder on a random port. Auto-approved for paths under .hooman/design/.",
      inputSchema: z.object({
        path: previewPathSchema,
      }),
      callback: async (
        input: { path: string },
        context?: ToolContext,
      ): Promise<JSONValue> => {
        try {
          const localPath = resolveLocalHtmlPath(input.path);
          if (!localPath) {
            return toJsonValue({
              status: "error",
              message: "Provide a local HTML path under the session cwd.",
            });
          }
          const cwd = getCwd();
          if (!isResolvedPathInsideDir(localPath, cwd)) {
            return toJsonValue({
              status: "error",
              message: `Preview path must stay under the session working directory (${cwd}).`,
            });
          }
          await access(localPath);

          const root = previewRootForHtmlFile(localPath);
          const server =
            getPreviewServer(root) ?? (await createPreviewServer(root, 0));

          const url = server.urlFor(localPath);
          const agent = context?.agent;
          const backend =
            getBrowserPreviewBackend(agent) ?? createOsBrowserPreviewBackend();
          if (agent && !getBrowserPreviewBackend(agent)) {
            setBrowserPreviewBackend(agent, backend);
          }
          await backend.open(url);

          return toJsonValue({
            status: "ok",
            url,
            path: localPath,
            previewRoot: server.rootDir,
            port: server.port,
            hint: "Hot reload is on — save HTML/CSS under the artifact folder and the browser refreshes. Call stop_design_preview with the same path when finished.",
          });
        } catch (error) {
          return toJsonValue({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }),
    tool({
      name: STOP_DESIGN_PREVIEW_TOOL_NAME,
      description:
        "Stop a design preview server started by preview_design for the given HTML path. Auto-approved.",
      inputSchema: z.object({
        path: previewPathSchema,
      }),
      callback: async (input: { path: string }): Promise<JSONValue> => {
        try {
          const localPath = resolveLocalHtmlPath(input.path);
          if (!localPath) {
            return toJsonValue({
              status: "error",
              message: "Provide a local HTML path under the session cwd.",
            });
          }
          const root = previewRootForHtmlFile(localPath);
          const existing = getPreviewServer(root);
          if (!existing) {
            return toJsonValue({
              status: "error",
              message: `No active design preview for ${localPath}. Call preview_design first.`,
            });
          }
          const port = existing.port;
          const stopped = await stopPreviewServer(root);
          return toJsonValue({
            status: "ok",
            path: localPath,
            previewRoot: root,
            port,
            stopped,
          });
        } catch (error) {
          return toJsonValue({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }),
  ];
}
