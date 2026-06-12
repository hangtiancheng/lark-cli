export const CodegenType = {
  VANILLA_HTML: "VANILLA_HTML",
  MULTI_FILES: "MULTI_FILES",
  VITE_PROJECT: "VITE_PROJECT",
} as const;

export type CodegenType = (typeof CodegenType)[keyof typeof CodegenType];
