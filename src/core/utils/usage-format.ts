import { millify } from "millify";

const TOKEN_MILLIFY_OPTS = {
  lowercase: true,
  precision: 2,
  space: false,
} as const;

/** Compact token-count label, e.g. `12.4k`, `1.2m`. */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return "0";
  }
  return millify(Math.round(n), TOKEN_MILLIFY_OPTS);
}

/** "$0.0451" under a dollar, "$1.23" under a hundred, whole dollars beyond. */
export function formatCostUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "$0.00";
  }
  if (amount < 1) {
    return `$${amount.toFixed(4)}`;
  }
  if (amount < 100) {
    return `$${amount.toFixed(2)}`;
  }
  return `$${Math.round(amount)}`;
}
