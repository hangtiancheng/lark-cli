const codeFence = "```";

export const hasBalancedFencedCodeBlocks = (content: string): boolean => {
  let fenceCount = 0;
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(codeFence, cursor);
    if (index === -1) break;
    fenceCount += 1;
    cursor = index + codeFence.length;
  }
  return fenceCount % 2 === 0;
};

export const describeViteOutputCompletenessIssue = (content: string): string | undefined =>
  hasBalancedFencedCodeBlocks(content)
    ? undefined
    : "Generated Vite project output contains an unterminated fenced code block";
