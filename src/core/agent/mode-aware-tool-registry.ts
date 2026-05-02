import type { Tool } from "@strands-agents/sdk";
import { ToolRegistry } from "../../../node_modules/@strands-agents/sdk/dist/src/registry/tool-registry.js";
import { isToolVisible } from "../state/tool-approvals.js";
import type { SessionMode } from "../state/session-mode.js";

export class ModeAwareToolRegistry extends ToolRegistry {
  private mode: SessionMode = "default";

  constructor(tools?: Tool[]) {
    super(tools);
  }

  setSessionMode(mode: SessionMode): void {
    this.mode = mode;
  }

  override list(): Tool[] {
    return super.list().filter((t: Tool) => isToolVisible(this.mode, t.name));
  }

  override get(name: string): Tool | undefined {
    if (!isToolVisible(this.mode, name)) {
      return undefined;
    }
    return super.get(name);
  }
}
