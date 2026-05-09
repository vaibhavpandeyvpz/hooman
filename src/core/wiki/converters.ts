import path from "node:path";
import { convert } from "@opendataloader/pdf";
import mammoth from "mammoth";

export type SupportedWikiMimeType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function detectMimeType(
  filePath: string,
  provided?: string,
): SupportedWikiMimeType {
  if (
    provided &&
    Object.values(EXTENSION_MIME).includes(provided as SupportedWikiMimeType)
  ) {
    return provided as SupportedWikiMimeType;
  }

  const ext = path.extname(filePath).toLowerCase();
  const fallback = EXTENSION_MIME[ext];
  if (fallback) {
    return fallback;
  }
  throw new Error(
    `Unsupported file type: ${filePath}. Wiki indexing accepts only .pdf and .docx.`,
  );
}

type MammothMarkdownResult = {
  value: string;
  messages: Array<{ type: string; message: string }>;
};

async function convertDocxToMarkdown(
  filePath: string,
  fileName: string,
): Promise<string> {
  try {
    const { value, messages } = await (
      mammoth as unknown as {
        convertToMarkdown: (input: {
          path: string;
        }) => Promise<MammothMarkdownResult>;
      }
    ).convertToMarkdown({ path: filePath });
    const errors = messages.filter((m) => m.type === "error");
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join("; "));
    }
    return value;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`DOCX conversion failed for ${fileName}: ${msg}`);
  }
}

async function convertPdfToMarkdown(
  filePath: string,
  fileName: string,
): Promise<string> {
  try {
    const markdown = await convert(filePath, {
      format: "markdown",
      toStdout: true,
      quiet: true,
    });
    return markdown;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PDF conversion failed for ${fileName}: ${msg}. ` +
        "OpenDataLoader PDF needs Java 11+ on your PATH (`java -version`).",
    );
  }
}

export async function convertFileToMarkdown(
  options: ConvertFileOptions,
): Promise<ConvertedMarkdown> {
  const fileName = path.basename(options.filePath);
  const mimeType = detectMimeType(options.filePath, options.mimeType);
  let markdown: string;

  if (mimeType === "application/pdf") {
    markdown = await convertPdfToMarkdown(options.filePath, fileName);
  } else {
    markdown = await convertDocxToMarkdown(options.filePath, fileName);
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
