import { useEffect, useRef, useState } from "react";
import { randomVerb } from "./verbs.js";
import InkSpinner from "ink-spinner";
import { Text } from "ink";

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

interface SpinnerProps {
  label?: string;
  inputTokens?: number;
  outputTokens?: number;
}

function Spinner(props: SpinnerProps) {
  const { label, inputTokens = 0, outputTokens = 0 } = props;
  const [elapsed, setElapsed] = useState(0);
  const verbRef = useRef(label ?? randomVerb());

  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor(performance.now() - start) / 1000);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const parts: string[] = [];
  if (inputTokens > 0) {
    parts.push(`${formatTokens(inputTokens)}↓ ${formatTokens(outputTokens)}↑`);
  }

  if (elapsed > 0) {
    parts.push(`${String(elapsed)}s`);
  }
  const detail = parts.length > 0 ? ` (${parts.join(" · ")})` : "";

  return (
    <Text>
      <Text color="magenta">
        <InkSpinner type="dots" />
      </Text>{" "}
      <Text dimColor>
        {verbRef.current}
        {detail}
      </Text>
    </Text>
  );
}

export default Spinner;
