import { Box, Text } from "ink";
import { TeammateSpinnerLine } from "./teammate-spinner-line.js";
import type { TeammateUIState } from "../teams/progress.js";
import { formatTokens } from "../teams/progress.js";

interface TeammateSpinnerTreeProps {
  teammates: TeammateUIState[];
  leaderVerb?: string;
  leaderTokens?: number;
}
export function TeammateSpinnerTree(props: TeammateSpinnerTreeProps) {
  const { teammates, leaderVerb, leaderTokens } = props;
  if (teammates.length === 0) {
    return null;
  }

  const tokenSuffix =
    leaderTokens != null && leaderTokens > 0 ? ` · ${formatTokens(leaderTokens)} tokens` : "";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color="cyan">{`  ┌─ team-lead: ${leaderVerb ?? "thinking"}…`}</Text>
        <Text dimColor>{tokenSuffix}</Text>
      </Text>
      {teammates.map((tm, i) => (
        <TeammateSpinnerLine key={tm.name} state={tm} isLast={i === teammates.length - 1} />
      ))}
    </Box>
  );
}
