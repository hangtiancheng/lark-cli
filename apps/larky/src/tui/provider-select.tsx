import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProviderConfig } from "../config/config.js";
import { COLORS, ICONS } from "./styles.js";

interface ProviderSelectProps {
  providers: ProviderConfig[];
  onSelect: (provider: ProviderConfig) => void;
}

export function ProviderSelect(props: ProviderSelectProps) {
  const { providers, onSelect } = props;
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : providers.length - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < providers.length - 1 ? c + 1 : 0));
    } else if (key.return) {
      onSelect(providers[cursor]);
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
      <Text bold>{COLORS.primary("Select a provider:")}</Text>
      <Text dimColor> </Text>
      {providers.map((p, i) => (
        <Box key={p.name}>
          <Text>
            {i === cursor ? COLORS.primary(`${ICONS.prompt} `) : "  "}
            {i === cursor ? COLORS.white(p.name) : p.name}
            <Text dimColor>
              {" "}
              ({p.protocol} {ICONS.arrow} {p.model})
            </Text>
          </Text>
        </Box>
      ))}
      <Text dimColor>{"\n  ↑/↓ to navigate, Enter to select"}</Text>
    </Box>
  );
}
