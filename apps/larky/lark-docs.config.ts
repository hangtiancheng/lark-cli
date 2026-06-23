/* eslint-disable @typescript-eslint/no-unsafe-call */
import { defineConfig } from "@lark.js/docs/vite";

export default defineConfig({
  docs: "docs",
  baseUrl: "/lark-cli/",
  routeMode: "history",
  title: "Lark Homepage",
  description: "@lark.js/lark -- Documentation site generator (Homepage)",
  nav: [
    { text: "Lark CLI", link: "/lark-cli/ch1/" },
  ],
  sidebar: {
    "/lark-cli/ch1/": "auto",
    "/lark-cli/ch2/": "auto",
    "/lark-cli/ch3/": "auto",
  },
  highlight: {
    theme: "github-light",
    languages: [
      "javascript",
      "typescript",
      "html",
      "css",
      "markdown",
      "json",
      "yaml",
      "bash",
      "sql",
      "python",
      "go",
    ],
  },
  search: { provider: "local" },
});
