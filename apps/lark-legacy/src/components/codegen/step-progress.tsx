import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import type { WorkflowStep } from "../../engine/workflow/index.js";

const STEP_LABELS: Record<WorkflowStep, string> = {
  promptEnhance: "Analyzing prompt",
  router: "Routing codegen type",
  codegen: "Generating code",
  qualityCheck: "Quality check",
  projectBuild: "Building project",
  saveProject: "Saving project",
};

type StepProgressProps = {
  completedSteps: WorkflowStep[];
  currentStep?: WorkflowStep;
};

const ALL_STEPS: WorkflowStep[] = [
  "promptEnhance",
  "router",
  "codegen",
  "qualityCheck",
  "saveProject",
  "projectBuild",
];

export const StepProgress: React.FC<StepProgressProps> = ({ completedSteps, currentStep }) => (
  <Box flexDirection="column">
    {ALL_STEPS.map((step) => {
      const completed = completedSteps.includes(step);
      const active = step === currentStep;
      if (!completed && !active) return null;
      return (
        <Box key={step}>
          {completed ? (
            <Text dimColor> + {STEP_LABELS[step]}</Text>
          ) : (
            <Text>
              <Text color="white">
                <InkSpinner type="dots" />
              </Text>
              <Text dimColor> {STEP_LABELS[step]}</Text>
            </Text>
          )}
        </Box>
      );
    })}
  </Box>
);
