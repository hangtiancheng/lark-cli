// BaseTool interface and ToolResult type
import type { z } from "zod";

export interface ToolResult {
  content: string;
  isError: boolean;
  /**
   * "runtime_error" | "timeout" | "schema_error" | "permission_denied"
   */
  errorType: string | null; // "runtime_error" | "timeout" | "schema_error" | "permission_denied"
}

// Create a successful ToolResult
export function toolSuccess(content: string): ToolResult {
  return { content, isError: false, errorType: null };
}

// Create a failed ToolResult
export function toolError(content: string, errorType = "runtime_error"): ToolResult {
  return { content, isError: true, errorType };
}

export interface BaseTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly paramsModel?: z.ZodType;

  // Execute tool invocation, return result or error
  invoke(params: Record<string, unknown>): Promise<ToolResult>;
}
