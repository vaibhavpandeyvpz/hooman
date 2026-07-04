import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AskUserBackend } from "../core/tools/ask-user.js";

/**
 * Whether an interactive terminal is available to answer `ask_user`
 * questions. When it isn't, skip registering the backend so the tool reports
 * "no user available" instead of hanging on stdin.
 */
export function canPromptForQuestion(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/** Readline-based `ask_user` backend for one-shot `exec` runs. */
export function createExecAskUserBackend(): AskUserBackend {
  return {
    ask: async (request) => {
      const rl = createInterface({ input: stdin, output: stdout });
      const onAbort = () => {
        rl.close();
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        stdout.write(`\n${request.question}\n`);
        request.options.forEach((option, index) => {
          stdout.write(`  ${index + 1}. ${option}\n`);
        });
        stdout.write(
          `Enter a number, type your own answer, or press enter to dismiss.\n`,
        );
        const answer = (await rl.question("> ")).trim();
        if (!answer) {
          return { kind: "dismissed" };
        }
        const index = Number.parseInt(answer, 10);
        if (
          Number.isInteger(index) &&
          index >= 1 &&
          index <= request.options.length &&
          String(index) === answer
        ) {
          return { kind: "answered", answer: request.options[index - 1]! };
        }
        return { kind: "answered", answer };
      } catch {
        // readline closed mid-question (cancelled turn or stdin ended).
        return { kind: "dismissed" };
      } finally {
        request.signal?.removeEventListener("abort", onAbort);
        rl.close();
      }
    },
  };
}
