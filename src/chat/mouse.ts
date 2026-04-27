import { parseMouseEvents } from "ink-use-mouse";

const STRIPPED_SGR_MOUSE_RE = /\[?<\d+;\d+;\d+[mM]/;

export const MOUSE_REPORTING_ENABLE =
  "\x1b[?1003l\x1b[?1002l\x1b[?1000h\x1b[?1006h";

export const MOUSE_REPORTING_DISABLE =
  "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";

export function isMouseInput(input: string): boolean {
  return (
    parseMouseEvents(input).length > 0 || STRIPPED_SGR_MOUSE_RE.test(input)
  );
}

export { parseMouseEvents };
