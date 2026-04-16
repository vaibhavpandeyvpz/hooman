import path from "node:path";
import type {
  DocumentFormat,
  ImageFormat,
  VideoFormat,
} from "@strands-agents/sdk";

// Extension → SDK media format. Values must match the unions the Strands SDK
// exposes so ImageBlock / VideoBlock / DocumentBlock construct cleanly. Each
// provider adapter (OpenAI, Anthropic, Bedrock, Google, Ollama) converts these
// into its native shape or gracefully drops unsupported ones with a warning —
// the paired TextBlock metadata still reaches the model either way.
const IMAGE_EXT_FORMATS: Record<string, ImageFormat> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".gif": "gif",
  ".webp": "webp",
};

const VIDEO_EXT_FORMATS: Record<string, VideoFormat> = {
  ".mp4": "mp4",
  ".mov": "mov",
  ".mkv": "mkv",
  ".webm": "webm",
  ".flv": "flv",
  ".mpeg": "mpeg",
  ".mpg": "mpg",
  ".wmv": "wmv",
  ".3gp": "3gp",
};

const DOCUMENT_EXT_FORMATS: Record<string, DocumentFormat> = {
  ".pdf": "pdf",
  ".csv": "csv",
  ".doc": "doc",
  ".docx": "docx",
  ".xls": "xls",
  ".xlsx": "xlsx",
  ".html": "html",
  ".htm": "html",
  ".txt": "txt",
  ".md": "md",
  ".json": "json",
  ".xml": "xml",
};

export function detectImageFormat(filePath: string): ImageFormat | undefined {
  return IMAGE_EXT_FORMATS[path.extname(filePath).toLowerCase()];
}

export function detectVideoFormat(filePath: string): VideoFormat | undefined {
  return VIDEO_EXT_FORMATS[path.extname(filePath).toLowerCase()];
}

export function detectDocumentFormat(
  filePath: string,
): DocumentFormat | undefined {
  return DOCUMENT_EXT_FORMATS[path.extname(filePath).toLowerCase()];
}
