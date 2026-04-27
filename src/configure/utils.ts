import { basename, dirname } from "node:path";
import { z } from "zod";
import type { McpTransport } from "../core/mcp/types.js";
import type { SkillListEntry } from "../core/skills/registry.js";
import type { Notice } from "./types.js";

const StringArraySchema = z.array(z.string());
const StringRecordSchema = z.record(z.string(), z.string());

export const DEFAULT_INSTRUCTIONS = `# Instructions

You are Hooman.
`;

export function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

const MASKED_PARAM_KEYS = new Set(["apikey", "clientconfig"]);

export function maskSensitiveParamsForDisplay(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveParamsForDisplay(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, itemValue] of Object.entries(input)) {
    if (MASKED_PARAM_KEYS.has(key.toLowerCase())) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = maskSensitiveParamsForDisplay(itemValue);
  }
  return output;
}

export function truncate(text: string, max: number = 88): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function folderNameForSkill(skill: SkillListEntry): string {
  return basename(dirname(skill.path));
}

export function parseObjectRecord(
  input: string,
  label: string,
): Record<string, unknown> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseStringArray(input: string, label: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  return StringArraySchema.parse(JSON.parse(trimmed), {
    error: () => `${label} must be a JSON string array.`,
  });
}

export function parseStringRecord(
  input: string,
  label: string,
): Record<string, string> | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  return StringRecordSchema.parse(JSON.parse(trimmed), {
    error: () => `${label} must be a JSON object with string values.`,
  });
}

export function parseNumber(
  input: string,
  label: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const value = Number(input.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${label} must be >= ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${label} must be <= ${options.max}.`);
  }
  return value;
}

export function normalizeOptional(input: string): string | undefined {
  const trimmed = input.trim();
  return trimmed ? trimmed : undefined;
}

export function transportSummary(transport: McpTransport): string {
  switch (transport.type) {
    case "stdio":
      return `${transport.type} • ${transport.command}`;
    case "streamable-http":
    case "sse":
      return `${transport.type} • ${transport.url}`;
    default:
      return String(transport);
  }
}

export function noticeColor(kind: Notice["kind"]): string {
  switch (kind) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "info":
    default:
      return "cyan";
  }
}
