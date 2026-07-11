import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { modeDisplayName } from "../../core/approvals/intervention.js";
import { SWITCH_MODE_TOOL } from "../../core/state/tool-approvals.js";
import type { ApprovalDecision, ApprovalRequest } from "../types.js";
import { theme } from "../../core/theme.js";

type ApprovalPromptProps = {
  request: ApprovalRequest | null;
  onDecision: (decision: ApprovalDecision, reason?: string) => void;
};

const PLAN_PREVIEW_LINES = 12;

function PlanPreview({ preview }: { preview: string }) {
  const lines = preview.split("\n");
  const shown = lines.slice(0, PLAN_PREVIEW_LINES);
  const hidden = lines.length - shown.length;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.muted}
      paddingX={1}
      marginBottom={1}
    >
      {shown.map((line, index) => (
        <Text key={index} color={theme.muted} wrap="truncate-end">
          {line.length > 0 ? line : " "}
        </Text>
      ))}
      {hidden > 0 ? (
        <Text color={theme.muted} dimColor>
          … {hidden} more line{hidden === 1 ? "" : "s"}
        </Text>
      ) : null}
    </Box>
  );
}

function SwitchModeApprovalPrompt({
  request,
  onDecision,
}: {
  request: ApprovalRequest;
  onDecision: (decision: ApprovalDecision, reason?: string) => void;
}) {
  const targetName = modeDisplayName(request.targetMode ?? "agent");
  const currentName = modeDisplayName(request.currentMode ?? "agent");

  return (
    <Box flexDirection="column">
      <Text color={theme.warning}>
        The agent proposes switching session mode.
      </Text>
      {request.preview ? <PlanPreview preview={request.preview} /> : null}
      <SelectInput<ApprovalDecision>
        items={[
          { label: `Switch to ${targetName} mode`, value: "allow" },
          { label: `Stay in ${currentName} mode`, value: "reject" },
        ]}
        onSelect={(item) => {
          if (item.value === "reject") {
            onDecision("reject", `User chose to stay in ${currentName} mode.`);
            return;
          }
          onDecision("allow");
        }}
      />
      <Box marginTop={1}>
        <Text color={theme.muted}>up/down - choose - enter select</Text>
      </Box>
    </Box>
  );
}

export function ApprovalPrompt({ request, onDecision }: ApprovalPromptProps) {
  if (request?.toolName === SWITCH_MODE_TOOL) {
    return (
      <SwitchModeApprovalPrompt request={request} onDecision={onDecision} />
    );
  }

  return (
    <Box flexDirection="column">
      <SelectInput<ApprovalDecision>
        items={[
          { label: "Allow", value: "allow" },
          { label: "Always", value: "always" },
          { label: "Deny", value: "reject" },
        ]}
        onSelect={(item) => onDecision(item.value)}
      />
      <Box marginTop={1}>
        <Text color={theme.muted}>up/down - choose - enter select</Text>
      </Box>
    </Box>
  );
}
