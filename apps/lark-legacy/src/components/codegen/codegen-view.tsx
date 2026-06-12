import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import InkSpinner from "ink-spinner";
import { loadEnv } from "../../engine/codegen-config.js";
import {
  buildAiModelRegistryConfigFromEnv,
  createAiModelRegistry,
  createLangChainCodegenRouter,
  assertSafePrompt,
} from "../../engine/ai/index.js";
import type { CodegenRouter } from "../../engine/ai/index.js";
import {
  createCodegenWorkflow,
  createLangChainCodeGenerator,
  createLangChainQualityChecker,
} from "../../engine/workflow/index.js";
import type { CodegenWorkflow } from "../../engine/workflow/index.js";
import { createMetricsService, formatSummary } from "../../engine/observability/index.js";
import type { MetricsService } from "../../engine/observability/index.js";
import { buildViteProject } from "../../engine/project/project-builder.js";
import { useCodegenWorkflow } from "../../hooks/use-codegen-workflow.js";
import { useConfirmOutput } from "../../hooks/use-confirm-output.js";
import { usePreviewServer } from "../../hooks/use-preview-server.js";
import { StepProgress } from "./step-progress.js";
import { CodePreview } from "./code-preview.js";
import { ConfirmDialog } from "./confirm-dialog.js";

type CodegenPhase =
  | "init"
  | "generating"
  | "confirm-save"
  | "saving"
  | "saved"
  | "confirm-build"
  | "building"
  | "build-failed"
  | "build-success"
  | "confirm-preview"
  | "previewing"
  | "done"
  | "error";

type CodegenViewProps = {
  prompt: string;
  onFinish: () => void;
};

type CodegenInitResult = {
  workflow: CodegenWorkflow;
  router: CodegenRouter;
  metrics: MetricsService;
};

function initCodegen(): CodegenInitResult {
  const env = loadEnv();
  const registryConfig = buildAiModelRegistryConfigFromEnv(env);
  const registry = createAiModelRegistry(registryConfig);
  const codeGenerator = createLangChainCodeGenerator(registry);
  const qualityChecker = createLangChainQualityChecker(registry);
  const metrics = createMetricsService();
  const workflow = createCodegenWorkflow({ codeGenerator, qualityChecker, metrics });
  const router = createLangChainCodegenRouter(registry);
  return { workflow, router, metrics };
}

export const CodegenView: React.FC<CodegenViewProps> = ({ prompt, onFinish }) => {
  const [initResult, setInitResult] = useState<CodegenInitResult | null>(null);
  const [initError, setInitError] = useState<string>();

  useEffect(() => {
    try {
      setInitResult(initCodegen());
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  if (initError) {
    return (
      <Box flexDirection="column">
        <Text color="red">! {initError}</Text>
        <Text dimColor>Press any key to return to chat...</Text>
      </Box>
    );
  }

  if (!initResult) {
    return (
      <Text>
        <Text color="green">
          <InkSpinner type="dots" />
        </Text>
        <Text dimColor> Initializing codegen...</Text>
      </Text>
    );
  }

  return (
    <CodegenRunner
      prompt={prompt}
      onFinish={onFinish}
      workflow={initResult.workflow}
      router={initResult.router}
      metrics={initResult.metrics}
    />
  );
};

type CodegenRunnerProps = {
  prompt: string;
  onFinish: () => void;
  workflow: CodegenWorkflow;
  router: CodegenRouter;
  metrics: MetricsService;
};

const CodegenRunner: React.FC<CodegenRunnerProps> = ({
  prompt,
  onFinish,
  workflow,
  router,
  metrics,
}) => {
  const [codegenPhase, setCodegenPhase] = useState<CodegenPhase>("init");
  const [buildLogs, setBuildLogs] = useState("");
  const [buildAttempts, setBuildAttempts] = useState(0);
  const [backgroundMode, setBackgroundMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const startedRef = useRef(false);

  const workflowHook = useCodegenWorkflow(workflow);
  const { targetDir, confirm, cancel } = useConfirmOutput();
  const { previewState, previewUrl, start: startPreview } = usePreviewServer();

  useInput((input, key) => {
    if (key.ctrl && input === "b") {
      setBackgroundMode((prev) => !prev);
    }
  });

  const startGeneration = useCallback(
    async (userPrompt: string) => {
      try {
        assertSafePrompt(userPrompt);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setCodegenPhase("error");
        return;
      }
      setCodegenPhase("generating");
      try {
        const codegenType = await router.routeCodegenType(userPrompt);
        const projectName = `project_${Date.now()}`;
        await workflowHook.run({
          codegenType,
          projectName,
          userPrompt,
          history: workflowHook.state.history,
        });
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setCodegenPhase("error");
      }
    },
    [router, workflowHook],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startGeneration(prompt);
  }, []);

  useEffect(() => {
    if (workflowHook.state.phase === "confirming" && codegenPhase === "generating") {
      setCodegenPhase("confirm-save");
    }
    if (workflowHook.state.phase === "error" && codegenPhase === "generating") {
      setCodegenPhase("error");
    }
  }, [workflowHook.state.phase, codegenPhase]);

  const handleConfirmSave = useCallback(async () => {
    const { state } = workflowHook;
    if (!state.outputDir) return;
    setCodegenPhase("saving");
    const dest = `./${`project_${Date.now()}`}`;
    await confirm(state.outputDir, dest);
    setCodegenPhase("confirm-build");
  }, [workflowHook, confirm]);

  const handleCancelSave = useCallback(() => {
    cancel();
    onFinish();
  }, [cancel, onFinish]);

  const handleBuild = useCallback(async () => {
    if (!targetDir) return;
    setCodegenPhase("building");
    setBuildAttempts((prev) => prev + 1);
    const result = await buildViteProject(targetDir);
    setBuildLogs(result.logs);
    if (result.success) {
      setCodegenPhase("confirm-preview");
    } else {
      setCodegenPhase("build-failed");
    }
  }, [targetDir]);

  const handleSkipBuild = useCallback(() => {
    setCodegenPhase("done");
  }, []);

  const handleRetryBuild = useCallback(async () => {
    if (buildAttempts >= 2) {
      setCodegenPhase("done");
      return;
    }
    await handleBuild();
  }, [buildAttempts, handleBuild]);

  const handlePreview = useCallback(async () => {
    if (!targetDir) return;
    setCodegenPhase("previewing");
    await startPreview(targetDir);
    setCodegenPhase("done");
  }, [targetDir, startPreview]);

  const handleSkipPreview = useCallback(() => {
    setCodegenPhase("done");
  }, []);

  const { state } = workflowHook;

  if (codegenPhase === "error") {
    return (
      <Box flexDirection="column">
        <Text color="red">! {errorMessage ?? state.errorMessage ?? "Unknown error"}</Text>
        <Text dimColor>Returning to chat...</Text>
      </Box>
    );
  }

  if (codegenPhase === "generating") {
    return (
      <Box flexDirection="column">
        <Text color="green">Creating app: {prompt}</Text>
        {backgroundMode ? (
          <Text dimColor>Running in background... (Ctrl+B to foreground)</Text>
        ) : (
          <>
            <StepProgress completedSteps={state.completedSteps} currentStep={state.currentStep} />
            {state.streamedCode.length > 0 && (
              <Text dimColor>
                {state.streamedCode.length > 300
                  ? `...${state.streamedCode.slice(-300)}`
                  : state.streamedCode}
              </Text>
            )}
          </>
        )}
      </Box>
    );
  }

  if (codegenPhase === "confirm-save") {
    return (
      <Box flexDirection="column">
        {state.parsedProject && state.outputDir && (
          <CodePreview files={state.parsedProject.files} outputDir={state.outputDir} />
        )}
        <ConfirmDialog
          message="Save project files?"
          onConfirm={() => void handleConfirmSave()}
          onCancel={handleCancelSave}
        />
      </Box>
    );
  }

  if (codegenPhase === "saving") {
    return (
      <Text>
        <Text color="green">
          <InkSpinner type="dots" />
        </Text>
        <Text dimColor> Saving...</Text>
      </Text>
    );
  }

  if (codegenPhase === "confirm-build") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">+ </Text>Saved to <Text dimColor>{targetDir}</Text>
        </Text>
        <ConfirmDialog
          message="Build the project?"
          onConfirm={() => void handleBuild()}
          onCancel={handleSkipBuild}
        />
      </Box>
    );
  }

  if (codegenPhase === "building") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">
            <InkSpinner type="dots" />
          </Text>
          <Text dimColor> Building project (attempt {buildAttempts})...</Text>
        </Text>
      </Box>
    );
  }

  if (codegenPhase === "build-failed") {
    return (
      <Box flexDirection="column">
        <Text color="red">! Build failed</Text>
        {buildLogs.length > 0 && (
          <Text dimColor>{buildLogs.length > 500 ? `...${buildLogs.slice(-500)}` : buildLogs}</Text>
        )}
        {buildAttempts < 2 ? (
          <ConfirmDialog
            message="Retry build?"
            onConfirm={() => void handleRetryBuild()}
            onCancel={handleSkipPreview}
          />
        ) : (
          <Box flexDirection="column">
            <Text dimColor>Max build attempts reached.</Text>
            <Text dimColor>Project saved to {targetDir}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (codegenPhase === "confirm-preview") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">+ </Text>Build succeeded
        </Text>
        <ConfirmDialog
          message="Start local preview?"
          onConfirm={() => void handlePreview()}
          onCancel={handleSkipPreview}
        />
      </Box>
    );
  }

  if (codegenPhase === "previewing") {
    return (
      <Text>
        <Text color="green">
          <InkSpinner type="dots" />
        </Text>
        <Text dimColor> Starting preview server...</Text>
      </Text>
    );
  }

  if (codegenPhase === "done") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">+ </Text>Project saved to <Text dimColor>{targetDir}</Text>
        </Text>
        {previewState === "running" && previewUrl && (
          <Text>
            <Text dimColor> Local: </Text>
            <Text color="green">{previewUrl}</Text>
          </Text>
        )}
        <Text dimColor>{formatSummary(metrics.summary())}</Text>
      </Box>
    );
  }

  return null;
};
