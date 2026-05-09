import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileTypeFromFile } from "file-type";

const execFileAsync = promisify(execFile);

export type SupportedWikiMimeType =
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "text/markdown"
  | "text/plain";

export type ConvertFileOptions = {
  filePath: string;
  mimeType?: string;
};

export type ConvertedMarkdown = {
  fileName: string;
  originalPath: string;
  mimeType: SupportedWikiMimeType;
  markdown: string;
};

const EXTENSION_MIME: Record<string, SupportedWikiMimeType> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

async function detectMimeType(
  filePath: string,
  provided?: string,
): Promise<SupportedWikiMimeType> {
  if (
    provided &&
    Object.values(EXTENSION_MIME).includes(provided as SupportedWikiMimeType)
  ) {
    return provided as SupportedWikiMimeType;
  }

  const detected = await fileTypeFromFile(filePath).catch(() => undefined);
  if (
    detected?.mime &&
    Object.values(EXTENSION_MIME).includes(
      detected.mime as SupportedWikiMimeType,
    )
  ) {
    return detected.mime as SupportedWikiMimeType;
  }

  const ext = path.extname(filePath).toLowerCase();
  const fallback = EXTENSION_MIME[ext];
  if (fallback) {
    return fallback;
  }
  throw new Error(`Unsupported file type: ${filePath}`);
}

async function convertViaPandoc(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pandoc", [
      "--from=auto",
      "--to=gfm",
      "--output=-",
      filePath,
    ]);
    return stdout;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Pandoc conversion failed for ${path.basename(filePath)}: ${msg}. ` +
        "Ensure pandoc is installed and supports this format.",
    );
  }
}

export async function convertFileToMarkdown(
  options: ConvertFileOptions,
): Promise<ConvertedMarkdown> {
  const fileName = path.basename(options.filePath);
  const mimeType = await detectMimeType(options.filePath, options.mimeType);
  let markdown = "";

  if (mimeType === "text/markdown" || mimeType === "text/plain") {
    markdown = await fs.readFile(options.filePath, "utf8");
  } else if (
    mimeType === "application/pdf" ||
    mimeType === "application/msword" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    markdown = await convertViaPandoc(options.filePath);
  } else {
    throw new Error(`Unsupported mime type: ${mimeType}`);
  }

  const finalMarkdown = normalizeText(markdown);
  if (!finalMarkdown) {
    throw new Error(`Converted markdown is empty for ${fileName}`);
  }

  return {
    fileName,
    originalPath: options.filePath,
    mimeType,
    markdown: `${finalMarkdown}\n`,
  };
}
