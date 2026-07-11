import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";
import { getCwd } from "../utils/cwd-context.js";
import {
  buildScreenshotDeck,
  buildScreenshotFig,
  buildScreenshotPdf,
  buildScreenshotPptx,
  buildScreenshotSketch,
  defaultExportPath,
  renderHtmlToImages,
  renderHtmlToPdfBuffer,
  type RenderedPage,
} from "../utils/export-design.js";
import {
  isResolvedPathInsideDir,
  normalizeUserPath,
} from "../utils/normalize-user-path.js";

export const EXPORT_DESIGN_TOOL_NAME = "export_design";

const EXPORT_FORMATS = [
  "pdf",
  "images-to-pdf",
  "images",
  "pptx",
  "figma",
  "figma-deck",
  "sketch",
] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const DELIVERY_FORMATS =
  "pdf / images-to-pdf / pptx / figma / figma-deck / sketch" as const;

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function resolveHtml(raw: string): string {
  const cwd = getCwd();
  const resolved = isAbsolute(raw.trim())
    ? raw.trim()
    : normalizeUserPath(raw.trim());
  if (!isResolvedPathInsideDir(resolved, cwd)) {
    throw new Error(
      `HTML path must stay under the session working directory (${cwd}).`,
    );
  }
  return resolved;
}

function resolveOutPath(
  htmlPath: string,
  out: string | undefined,
  format: ExportFormat,
): string {
  const cwd = getCwd();
  if (out?.trim()) {
    const target = isAbsolute(out.trim())
      ? out.trim()
      : normalizeUserPath(out.trim());
    if (!isResolvedPathInsideDir(target, cwd)) {
      throw new Error(
        `Output path must stay under the session working directory (${cwd}).`,
      );
    }
    return target;
  }
  if (format === "images") {
    // Visual QA default: reviews/ next to the HTML entry.
    return join(dirname(htmlPath), "reviews");
  }
  const ext =
    format === "pptx"
      ? "pptx"
      : format === "figma"
        ? "fig"
        : format === "figma-deck"
          ? "deck"
          : format === "sketch"
            ? "sketch"
            : "pdf";
  const target = defaultExportPath(htmlPath, ext);
  if (!isResolvedPathInsideDir(target, cwd)) {
    throw new Error(
      `Output path must stay under the session working directory (${cwd}).`,
    );
  }
  return target;
}

function playwrightHint(message: string): string {
  if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
    return `${message} Install Chromium with: npx playwright install chromium`;
  }
  return message;
}

function imageFileName(index: number, total: number, jpeg: boolean): string {
  const ext = jpeg ? "jpg" : "png";
  if (total <= 1) {
    return `shot-01.${ext}`;
  }
  return `slide-${String(index + 1).padStart(2, "0")}.${ext}`;
}

async function writeImagePages(
  outDir: string,
  images: RenderedPage[],
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img) {
      continue;
    }
    const filePath = join(outDir, imageFileName(i, images.length, img.jpeg));
    await writeFile(filePath, img.buffer);
    written.push(filePath);
  }
  return written;
}

export function createExportTools() {
  return [
    tool({
      name: EXPORT_DESIGN_TOOL_NAME,
      description: `Export or capture an HTML design artifact. Formats: images (screenshots under reviews/ by default — use for visual QA, then call launch_subagent with kind design-review, every returned path, and binary:true reads), pdf (Chromium print), images-to-pdf (pages → PDF), pptx (PowerPoint-ready .pptx), figma / figma-deck / sketch (Figma-ready .fig / .deck or Sketch-ready .sketch). Delivery formats (${DELIVERY_FORMATS}) only after visual QA (images + launch_subagent kind design-review, Must-fix empty or round cap reached).`,
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe("Path to the HTML entry file (usually index.html)."),
        format: z
          .enum(EXPORT_FORMATS)
          .describe(
            "images = page screenshots (visual QA); pdf = Chromium print; images-to-pdf = pages → PDF; pptx = PowerPoint-ready .pptx; figma / figma-deck = Figma-ready .fig / .deck; sketch = Sketch-ready .sketch.",
          ),
        out: z
          .string()
          .optional()
          .describe(
            "Optional output path under the session cwd (.pdf / .pptx / .fig / .deck / .sketch file, or directory for images; images default to <html-dir>/reviews).",
          ),
        title: z
          .string()
          .optional()
          .describe(
            "Optional presentation title (pptx / figma / figma-deck / sketch).",
          ),
      }),
      callback: async (input: {
        path: string;
        format: ExportFormat;
        out?: string;
        title?: string;
      }): Promise<JSONValue> => {
        try {
          const htmlPath = resolveHtml(input.path);
          const outPath = resolveOutPath(htmlPath, input.out, input.format);

          if (input.format === "pdf") {
            await mkdir(dirname(outPath), { recursive: true });
            const buffer = await renderHtmlToPdfBuffer(htmlPath);
            await writeFile(outPath, buffer);
            return toJsonValue({
              status: "ok",
              format: input.format,
              path: outPath,
              bytes: buffer.byteLength,
            });
          }

          if (input.format === "images-to-pdf") {
            await mkdir(dirname(outPath), { recursive: true });
            const images = await renderHtmlToImages({
              path: htmlPath,
              format: "png",
            });
            const buffer = await buildScreenshotPdf(images);
            await writeFile(outPath, buffer);
            return toJsonValue({
              status: "ok",
              format: input.format,
              path: outPath,
              bytes: buffer.byteLength,
              pages: images.length,
            });
          }

          if (input.format === "images") {
            const images = await renderHtmlToImages({
              path: htmlPath,
              format: "png",
            });
            const pages = await writeImagePages(outPath, images);
            return toJsonValue({
              status: "ok",
              format: input.format,
              path: outPath,
              pages,
              nextTool: "launch_subagent",
              nextKind: "design-review",
              nextQueryTemplate: `Visually review this design artifact. Entry: ${htmlPath}. Read EVERY screenshot below with read_file binary:true before judging layout. Flag overflow, overlap, clipping, cramped cards, and footer/chrome collisions as Must-fix.\n\nScreenshots:\n${pages.map((p) => `- ${p}`).join("\n")}`,
              hint: `Capture is not review. Your next tool call must be launch_subagent with kind design-review using nextQueryTemplate (or equivalent). Do not export_design with ${DELIVERY_FORMATS} or mark work complete until that review returns and Must-fix are addressed.`,
            });
          }

          if (
            input.format === "figma" ||
            input.format === "figma-deck" ||
            input.format === "sketch" ||
            input.format === "pptx"
          ) {
            await mkdir(dirname(outPath), { recursive: true });
            const images = await renderHtmlToImages({
              path: htmlPath,
              format: "png",
            });
            const buffer =
              input.format === "figma"
                ? await buildScreenshotFig(images, { title: input.title })
                : input.format === "figma-deck"
                  ? await buildScreenshotDeck(images, { title: input.title })
                  : input.format === "sketch"
                    ? buildScreenshotSketch(images, { title: input.title })
                    : await buildScreenshotPptx(images, {
                        title: input.title,
                      });
            await writeFile(outPath, buffer);
            return toJsonValue({
              status: "ok",
              format: input.format,
              path: outPath,
              bytes: buffer.byteLength,
              slides: images.length,
            });
          }

          return toJsonValue({
            status: "error",
            message: `Unsupported format: ${String(input.format)}`,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return toJsonValue({
            status: "error",
            message: playwrightHint(message),
          });
        }
      },
    }),
  ];
}
