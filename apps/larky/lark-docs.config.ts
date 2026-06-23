/* eslint-disable @typescript-eslint/no-unsafe-call */
import { defineConfig } from "@lark.js/docs/vite";

export default defineConfig({
  docs: "docs",
  baseUrl: "/lark-cli/",
  routeMode: "history",
  title: "Lark CLI",
  description: "Lark CLI (Larky) Documentation",
  nav: [{ text: "Introduction", link: "/lark-cli/ch1/" }],
  sidebar: {
    "/lark-cli/ch1/": "auto",
    "/lark-cli/ch2/": "auto",
    "/lark-cli/ch3/": "auto",
  },
  highlight: {
    theme: "github-light",
  },
  search: { provider: "local" },
});
