import React from "react";
import { Box, Text } from "ink";

type CodePreviewProps = {
  files: readonly { filename: string; content: string }[];
  outputDir: string;
};

export const CodePreview: React.FC<CodePreviewProps> = ({ files, outputDir }) => (
  <Box flexDirection="column">
    <Text>
      Generated <Text color="white">{files.length}</Text> file(s)
      <Text dimColor> {outputDir}</Text>
    </Text>
    <Box flexDirection="column" marginLeft={2}>
      {files.map((file) => (
        <Text key={file.filename} dimColor>
          {file.filename}
        </Text>
      ))}
    </Box>
  </Box>
);
