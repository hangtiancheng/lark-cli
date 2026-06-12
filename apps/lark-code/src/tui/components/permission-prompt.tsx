// PermissionPrompt: keyboard-driven permission response modal
import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";

import { theme, truncate } from "../theme.js";

export interface PermissionPromptProps {
  readonly toolName: string;
  readonly paramsPreview: string;
  readonly toolUseId: string;
  readonly onRespond: (decision: string) => void;
  readonly visible: boolean;
}

// Full-screen permission overlay with keyboard shortcuts
export function PermissionPrompt({
  toolName,
  paramsPreview,
  onRespond,
  visible,
}: PermissionPromptProps): React.JSX.Element | null {
  const handleInput = useCallback(
    (input: string) => {
      if (!visible) return;
      if (input === "a") onRespond("allow_once");
      else if (input === "d") onRespond("deny_once");
      else if (input === "A") onRespond("always_allow");
      else if (input === "D") onRespond("always_deny");
    },
    [onRespond, visible],
  );

  useInput((input) => {
    handleInput(input);
  });

  if (!visible) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={theme.warning}
      paddingX={2}
      paddingY={1}
    >
      <Box>
        <Text color={theme.warning} bold>
          PERMISSION REQUIRED
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.accent} bold>
          {toolName}
        </Text>
      </Box>
      {paramsPreview ? (
        <Box marginTop={1}>
          <Text color={theme.textDim}>{truncate(paramsPreview, 70)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.text}>
          <Text color={theme.accentBright} bold>
            [a]
          </Text>
          <Text color={theme.text}>llow once </Text>
          <Text color={theme.accentBright} bold>
            [d]
          </Text>
          <Text color={theme.text}>eny </Text>
          <Text color={theme.accentBright} bold>
            [A]
          </Text>
          <Text color={theme.text}>lways allow </Text>
          <Text color={theme.accentBright} bold>
            [D]
          </Text>
          <Text color={theme.text}>lways deny</Text>
        </Text>
      </Box>
    </Box>
  );
}
