import { useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { EXIT_PLAN_MODE_TOOL } from "../../core/state/tool-approvals.js";
import type { ApprovalDecision, ApprovalRequest } from "../types.js";

type ApprovalPromptProps = {
  request: ApprovalRequest | null;
  onDecision: (decision: ApprovalDecision, reason?: string) => void;
};

const PLAN_PREVIEW_LINES = 12;

type PlanChoice = "allow" | "reject" | "reject_note";

function PlanPreview({ preview }: { preview: string }) {
  const lines = preview.split("\n");
  const shown = lines.slice(0, PLAN_PREVIEW_LINES);
  const hidden = lines.length - shown.length;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      {shown.map((line, index) => (
        <Text key={index} color="gray" wrap="truncate-end">
          {line.length > 0 ? line : " "}
        </Text>
      ))}
      {hidden > 0 ? (
        <Text color="gray" dimColor>
          … {hidden} more line{hidden === 1 ? "" : "s"}
        </Text>
      ) : null}
    </Box>
  );
}

function ExitPlanApprovalPrompt({
  request,
  onDecision,
}: {
  request: ApprovalRequest;
  onDecision: (decision: ApprovalDecision, reason?: string) => void;
}) {
  const [noteMode, setNoteMode] = useState(false);
  const [note, setNote] = useState("");

  if (noteMode) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          Keep planning — tell the agent what to refine:
        </Text>
        <Box marginTop={1}>
          <Text color="gray">{"> "}</Text>
          <TextInput
            value={note}
            onChange={setNote}
            onSubmit={(value) =>
              onDecision(
                "reject",
                value.trim()
                  ? value.trim()
                  : "User chose to keep refining the plan.",
              )
            }
            placeholder="e.g. add a rollback step and cover the daemon path"
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">enter submit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="yellow">
        The agent proposes leaving plan mode to start implementing.
      </Text>
      {request.preview ? <PlanPreview preview={request.preview} /> : null}
      <SelectInput<PlanChoice>
        items={[
          { label: "Start implementing", value: "allow" },
          { label: "Keep planning", value: "reject" },
          { label: "Keep planning with a note…", value: "reject_note" },
        ]}
        onSelect={(item) => {
          if (item.value === "reject_note") {
            setNoteMode(true);
            return;
          }
          if (item.value === "reject") {
            onDecision("reject", "User chose to keep refining the plan.");
            return;
          }
          onDecision("allow");
        }}
      />
      <Box marginTop={1}>
        <Text color="gray">up/down - choose - enter select</Text>
      </Box>
    </Box>
  );
}

export function ApprovalPrompt({ request, onDecision }: ApprovalPromptProps) {
  if (request?.toolName === EXIT_PLAN_MODE_TOOL) {
    return <ExitPlanApprovalPrompt request={request} onDecision={onDecision} />;
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
        <Text color="gray">up/down - choose - enter select</Text>
      </Box>
    </Box>
  );
}
