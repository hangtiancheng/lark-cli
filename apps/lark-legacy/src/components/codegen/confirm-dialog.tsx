import React from "react";
import { Box, Text, useInput } from "ink";

type ConfirmDialogProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ message, onConfirm, onCancel }) => {
  useInput((input, key) => {
    if (input === "y" || input === "Y" || key.return) {
      onConfirm();
    }
    if (input === "n" || input === "N") {
      onCancel();
    }
  });

  return (
    <Box>
      <Text>{message} </Text>
      <Text dimColor>(Y/n)</Text>
    </Box>
  );
};
