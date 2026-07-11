import { access } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";
import { chromium, type Browser, type Page } from "playwright";
import * as PptxGenJSModule from "pptxgenjs";
import { getCwd } from "./cwd-context.js";
import {
  isResolvedPathInsideDir,
  normalizeUserPath,
} from "./normalize-user-path.js";

export type RenderedPage = {
  buffer: Buffer;
  width: number;
  height: number;
  jpeg: boolean;
};

export type RenderHtmlOptions = {
  /** Absolute or cwd-relative HTML path. */
  path: string;
  /** Viewport width (default 1280). */
  width?: number;
  /** Viewport height for non-deck pages (default 720). */
  height?: number;
  /** Prefer JPEG for long pages (smaller); PNG for decks. */
  format?: "png" | "jpeg";
};

type PptxInstance = InstanceType<typeof import("pptxgenjs").default>;
const PptxGenJS = PptxGenJSModule.default as unknown as {
  new (): PptxInstance;
};

const PDF_PAGE_LONGEST_PT = 960;
const PPTX_SLIDE_WIDTH_IN = 13.333;

function resolveHtmlPath(raw: string): string {
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

async function withPage<T>(
  width: number,
  height: number,
  fn: (page: Page, browser: Browser) => Promise<T>,
): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    return await fn(page, browser);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * Render an HTML file to one or more screenshot buffers.
 * Elements with `[data-slide]` become one image each; otherwise a single
 * full-page screenshot.
 */
export async function renderHtmlToImages(
  options: RenderHtmlOptions,
): Promise<RenderedPage[]> {
  const htmlPath = resolveHtmlPath(options.path);
  await access(htmlPath);
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const fileUrl = pathToFileURL(htmlPath).href;

  return withPage(width, height, async (page) => {
    await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(200);

    const slideCount = await page.locator("[data-slide]").count();
    if (slideCount > 0) {
      const pages: RenderedPage[] = [];
      for (let i = 0; i < slideCount; i++) {
        const slide = page.locator("[data-slide]").nth(i);
        await slide.scrollIntoViewIfNeeded();
        const box = await slide.boundingBox();
        const buffer = Buffer.from(await slide.screenshot({ type: "png" }));
        pages.push({
          buffer,
          width: Math.round(box?.width ?? width),
          height: Math.round(box?.height ?? height),
          jpeg: false,
        });
      }
      return pages;
    }

    const format = options.format ?? "jpeg";
    const buffer = Buffer.from(
      await page.screenshot({
        type: format,
        fullPage: true,
        ...(format === "jpeg" ? { quality: 85 } : {}),
      }),
    );
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    return [
      {
        buffer,
        width: metrics.width || width,
        height: metrics.height || height,
        jpeg: format === "jpeg",
      },
    ];
  });
}

/**
 * Print HTML to a PDF via Chromium (selectable text when possible).
 */
export async function renderHtmlToPdfBuffer(
  htmlPathRaw: string,
): Promise<Buffer> {
  const htmlPath = resolveHtmlPath(htmlPathRaw);
  await access(htmlPath);
  const fileUrl = pathToFileURL(htmlPath).href;
  return withPage(1280, 720, async (page) => {
    await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(200);
    const slideCount = await page.locator("[data-slide]").count();
    if (slideCount > 0) {
      const pdf = await page.pdf({
        width: "13.333in",
        height: "7.5in",
        printBackground: true,
        preferCSSPageSize: false,
      });
      return Buffer.from(pdf);
    }
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0.5in",
        bottom: "0.5in",
        left: "0.5in",
        right: "0.5in",
      },
    });
    return Buffer.from(pdf);
  });
}

/**
 * Stitch screenshot pages into a PDF (one page per image).
 * Used when Chromium printToPDF is not preferred (e.g. deck slides).
 */
export async function buildScreenshotPdf(
  images: RenderedPage[],
): Promise<Buffer> {
  if (images.length === 0) {
    throw new Error("no pages to export");
  }
  const pdf = await PDFDocument.create();
  for (const img of images) {
    const image = img.jpeg
      ? await pdf.embedJpg(img.buffer)
      : await pdf.embedPng(img.buffer);
    const aspect = image.height > 0 ? image.width / image.height : 1;
    const [width, height] =
      aspect >= 1
        ? [PDF_PAGE_LONGEST_PT, PDF_PAGE_LONGEST_PT / aspect]
        : [PDF_PAGE_LONGEST_PT * aspect, PDF_PAGE_LONGEST_PT];
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/**
 * Screenshot-backed PPTX — one full-bleed image per slide.
 */
export async function buildScreenshotPptx(
  images: RenderedPage[],
  opts: { title?: string } = {},
): Promise<Buffer> {
  if (images.length === 0) {
    throw new Error("no slides to export");
  }
  const pptx = new PptxGenJS();
  const first = images[0];
  const aspect =
    first && first.height > 0 ? first.width / first.height : 16 / 9;
  if (Math.abs(aspect - 16 / 9) < 0.01) {
    pptx.layout = "LAYOUT_16x9";
  } else {
    const height = Number((PPTX_SLIDE_WIDTH_IN / aspect).toFixed(3));
    pptx.defineLayout({
      name: "HOOMAN_DECK",
      width: PPTX_SLIDE_WIDTH_IN,
      height,
    });
    pptx.layout = "HOOMAN_DECK";
  }
  pptx.author = "Hooman";
  if (opts.title) pptx.title = opts.title;
  pptx.subject = "Screenshot-based PPTX";
  for (const img of images) {
    const slide = pptx.addSlide();
    slide.addImage({
      data: `data:image/${img.jpeg ? "jpeg" : "png"};base64,${img.buffer.toString("base64")}`,
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
    });
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

export function defaultExportPath(
  htmlPath: string,
  ext: "pdf" | "pptx" | "fig" | "deck" | "sketch",
): string {
  const dir = dirname(htmlPath);
  return join(dir, "export", `export.${ext}`);
}

export { buildScreenshotFig, buildScreenshotDeck } from "./export-figma.js";
export { buildScreenshotSketch } from "./export-sketch.js";
