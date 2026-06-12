import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/main": "src/cli/main.ts",
    "core/app": "src/core/app.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node24",
  splitting: false,
  sourcemap: true,
});
