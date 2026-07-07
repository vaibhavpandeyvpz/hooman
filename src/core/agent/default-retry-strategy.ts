import {
  DefaultModelRetryStrategy,
  ExponentialBackoff,
  ModelThrottledError,
  type AfterModelCallEvent,
} from "@strands-agents/sdk";
import type { RetryDecision } from "@strands-agents/sdk";
import { emitModelRetryProgress } from "./retry-progress.js";
import {
  APIConnectionError as OpenAIConnectionError,
  APIConnectionTimeoutError as OpenAIConnectionTimeoutError,
  InternalServerError as OpenAIInternalServerError,
  RateLimitError as OpenAIRateLimitError,
} from "openai";
import {
  APIConnectionError as AnthropicConnectionError,
  APIConnectionTimeoutError as AnthropicConnectionTimeoutError,
  InternalServerError as AnthropicInternalServerError,
  RateLimitError as AnthropicRateLimitError,
  RetryableError as AnthropicRetryableError,
} from "@anthropic-ai/sdk";
import {
  InternalServerException as BedrockInternalServerException,
  ModelNotReadyException as BedrockModelNotReadyException,
  ModelStreamErrorException as BedrockModelStreamErrorException,
  ModelTimeoutException as BedrockModelTimeoutException,
  ServiceUnavailableException as BedrockServiceUnavailableException,
  ThrottlingException as BedrockThrottlingException,
} from "@aws-sdk/client-bedrock-runtime";

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_BACKOFF = new ExponentialBackoff({
  baseMs: 30_000,
  maxMs: 300_000,
  jitter: "none",
});

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const RETRYABLE_MESSAGE_FRAGMENTS = [
  "connection error",
  "connection reset",
  "connection refused",
  "fetch failed",
  "gateway timeout",
  "network",
  "overloaded",
  "rate limit",
  "service unavailable",
  "socket hang up",
  "temporarily unavailable",
  "timed out",
  "timeout",
  "too many requests",
  "bad gateway",
] as const;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function errorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  if (error.stack && error.stack.trim().length > 0) {
    return error.stack;
  }
  return error.message || undefined;
}

function numericField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function hasAbortName(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

type RetryableErrorLike = Error & {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  cause?: unknown;
};

function isKnownProviderRetryableError(error: Error): boolean {
  return (
    error instanceof ModelThrottledError ||
    error instanceof OpenAIRateLimitError ||
    error instanceof OpenAIInternalServerError ||
    error instanceof OpenAIConnectionError ||
    error instanceof OpenAIConnectionTimeoutError ||
    error instanceof AnthropicRateLimitError ||
    error instanceof AnthropicInternalServerError ||
    error instanceof AnthropicConnectionError ||
    error instanceof AnthropicConnectionTimeoutError ||
    error instanceof AnthropicRetryableError ||
    error instanceof BedrockThrottlingException ||
    error instanceof BedrockInternalServerException ||
    error instanceof BedrockServiceUnavailableException ||
    error instanceof BedrockModelTimeoutException ||
    error instanceof BedrockModelStreamErrorException ||
    error instanceof BedrockModelNotReadyException
  );
}

function isRetryableHttpStatus(status: number | undefined): boolean {
  if (status === undefined) {
    return false;
  }
  if (RETRYABLE_HTTP_STATUSES.has(status)) {
    return true;
  }
  return status >= 500 && status < 600;
}

function isRetryableSystemCode(code: string | undefined): boolean {
  return code !== undefined && RETRYABLE_ERROR_CODES.has(code.toUpperCase());
}

function isRetryableMessage(error: RetryableErrorLike): boolean {
  const haystack = `${error.name} ${error.message} ${String(error.cause ?? "")}`
    .toLowerCase()
    .trim();
  return RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) =>
    haystack.includes(fragment),
  );
}

function isTransientModelError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (hasAbortName(error)) {
    return false;
  }
  if (isKnownProviderRetryableError(error)) {
    return true;
  }
  const data = error as RetryableErrorLike;
  const status = numericField(data.status) ?? numericField(data.statusCode);
  if (status !== undefined) {
    if (isRetryableHttpStatus(status)) {
      return true;
    }
    if (status >= 400 && status < 500) {
      return false;
    }
  }
  const code = stringField(data.code);
  if (isRetryableSystemCode(code)) {
    return true;
  }
  return isRetryableMessage(data);
}

export class HoomanDefaultModelRetryStrategy extends DefaultModelRetryStrategy {
  override readonly name = "hooman:default-model-retry-strategy";

  constructor() {
    super({
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
    });
  }

  protected override isRetryable(error: Error): boolean {
    return super.isRetryable(error) || isTransientModelError(error);
  }

  override async retryModel(event: AfterModelCallEvent): Promise<void> {
    if (event.attemptCount === 1) {
      this.onFirstModelAttempt();
    }
    if (event.retry || event.error === undefined) {
      return;
    }
    const decision = await this.computeRetryDecision(event);
    if (!decision.retry) {
      return;
    }
    await sleepWithProgress(event, decision);
    event.retry = true;
  }
}

async function sleepWithProgress(
  event: AfterModelCallEvent,
  decision: Extract<RetryDecision, { retry: true }>,
): Promise<void> {
  const waitMs = Math.max(0, Math.round(decision.waitMs));
  const maxAttempts = DEFAULT_MAX_ATTEMPTS;
  const nextAttempt = event.attemptCount + 1;
  const error = errorMessage(event.error);
  const detail = errorDetail(event.error);
  const sessionValue = event.agent.appState.get("sessionId");
  const sessionId = typeof sessionValue === "string" ? sessionValue : undefined;

  let remainingMs = waitMs;
  while (remainingMs > 0) {
    const retryInSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    emitModelRetryProgress({
      status: "countdown",
      sessionId,
      attempt: event.attemptCount,
      nextAttempt,
      maxAttempts,
      waitMs,
      retryInSeconds,
      error,
      errorDetail: detail,
    });
    const slice = Math.min(remainingMs, 1000);
    await new Promise((resolve) => globalThis.setTimeout(resolve, slice));
    remainingMs -= slice;
  }

  emitModelRetryProgress({
    status: "retrying",
    sessionId,
    attempt: event.attemptCount,
    nextAttempt,
    maxAttempts,
    waitMs,
    retryInSeconds: 0,
    error,
    errorDetail: detail,
  });
}
