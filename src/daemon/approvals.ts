import { createChannelPermissionAsk } from "../core/approvals/channel-ask.js";
import { HoomanToolApprovalIntervention } from "../core/approvals/intervention.js";
import type { Manager as McpManager } from "../core/mcp/index.js";

export function createDaemonApprovalIntervention(manager: McpManager) {
  return new HoomanToolApprovalIntervention({
    ask: createChannelPermissionAsk(manager),
  });
}
