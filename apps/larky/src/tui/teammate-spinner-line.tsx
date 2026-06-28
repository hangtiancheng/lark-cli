import { Text, Box } from "ink";
import type { TeammateUIState } from "../teams/progress.js";
import { summarizeActivities, formatTokens } from "../teams/progress.js";

interface TeammateSpinnerLineProps {
  state: TeammateUIState;
  isLast: boolean;
  isSelected?: boolean;
}

export function TeammateSpinnerLine(props: TeammateSpinnerLineProps) {
  const { state, isLast, isSelected } = props;
  const pointer = isSelected ? "> " : "  ";
  let connector: string;

  if (isSelected && isLast) {
    connector = "╘═ ";
  } else if (isSelected) {
    connector = "╞═ ";
  } else if (isLast) {
    connector = "└─ ";
  } else {
    connector = "├─ ";
  }

  const { status, progress, spinnerVerb } = state;

  let statusNode: React.ReactNode;
  switch (status) {
    case "idle": {
      statusNode = <Text dimColor>idle</Text>;
      break;
    }
    case "completed": {
      statusNode = <Text color="green">completed</Text>;
      break;
    }
    case "failed": {
      statusNode = <Text color="red">failed</Text>;
      break;
    }
    case "stopped": {
      statusNode = <Text color="yellow">stopped</Text>;
      break;
    }
    case "running": {
      const summary = summarizeActivities(progress.recentActivities);
      const label = summary || spinnerVerb;
      statusNode = (
        <Text dimColor>
          {label}
          {summary ? "..." : ""}
        </Text>
      );
      break;
    }
  }

  const stats = ` · ${String(progress.toolUseCount)} tools · ${formatTokens(progress.tokenCount)} tokens`;

  return (
    <Box>
      <Text>
        {pointer}
        <Text dimColor>{connector}</Text>
        <Text color="cyan">@{state.name}</Text>
        {": "}
        {statusNode}
        <Text dimColor>{stats}</Text>
      </Text>
    </Box>
  );
}
