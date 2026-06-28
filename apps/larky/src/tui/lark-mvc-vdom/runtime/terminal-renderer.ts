/**
 * Terminal renderer: converts VDomNode trees to ANSI-formatted strings.
 *
 * Walks the VDomNode tree recursively, interpreting semantic HTML elements
 * and CSS classes as terminal formatting directives. Uses chalk for styling.
 */
import chalk from "chalk";
import type { VDomNode } from "@lark.js/mvc";
import type { RenderContext, TextStyle, BoxChars } from "./types.js";

/** SPLITTER character used by lark-mvc for raw HTML nodes */
const SPLITTER = "\x1e";
/** V_TEXT_NODE tag value */
const V_TEXT_NODE = 0;

/** Box-drawing character sets */
const BOX_CHARS: Record<string, BoxChars> = {
  single: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
  },
  round: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  bold: {
    topLeft: "┏",
    topRight: "┓",
    bottomLeft: "┗",
    bottomRight: "┛",
    horizontal: "━",
    vertical: "┃",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
  },
};

/** Default text style */
function defaultStyle(): TextStyle {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    color: null,
    backgroundColor: null,
  };
}

/** Default render context */
export function createRenderContext(width?: number): RenderContext {
  const termWidth = process.stdout.columns || 80;
  return {
    width: width ?? termWidth,
    styles: defaultStyle(),
    indent: 0,
  };
}

/** Parse CSS class list into a Set */
function parseClasses(classStr: string | undefined): Set<string> {
  if (!classStr) {
    return new Set();
  }
  return new Set(classStr.split(/\s+/).filter(Boolean));
}

/** Apply class-based styles to a render context, returning a new context */
function applyClassStyles(ctx: RenderContext, classes: Set<string>): RenderContext {
  const styles = { ...ctx.styles };

  if (classes.has("bold")) {
    styles.bold = true;
  }
  if (classes.has("dim")) {
    styles.dim = true;
  }
  if (classes.has("italic")) {
    styles.italic = true;
  }
  if (classes.has("underline")) {
    styles.underline = true;
  }
  if (classes.has("strikethrough")) {
    styles.strikethrough = true;
  }
  if (classes.has("inverse")) {
    styles.inverse = true;
  }

  for (const cls of classes) {
    if (cls.startsWith("text-hex-")) {
      styles.color = "#" + cls.slice(9);
    } else if (cls.startsWith("text-")) {
      styles.color = cls.slice(5);
    } else if (cls.startsWith("bg-hex-")) {
      styles.backgroundColor = "#" + cls.slice(7);
    } else if (cls.startsWith("bg-")) {
      styles.backgroundColor = cls.slice(3);
    }
  }

  return { ...ctx, styles };
}

/** Chalk color function lookup table for named colors */
const CHALK_COLORS: Record<string, (s: string) => string> = {
  black: chalk.black,
  red: chalk.red,
  green: chalk.green,
  yellow: chalk.yellow,
  blue: chalk.blue,
  magenta: chalk.magenta,
  cyan: chalk.cyan,
  white: chalk.white,
  gray: chalk.gray,
  grey: chalk.grey,
  bgBlack: chalk.bgBlack,
  bgRed: chalk.bgRed,
  bgGreen: chalk.bgGreen,
  bgYellow: chalk.bgYellow,
  bgBlue: chalk.bgBlue,
  bgMagenta: chalk.bgMagenta,
  bgCyan: chalk.bgCyan,
  bgWhite: chalk.bgWhite,
  bgGray: chalk.bgGray,
};

/** Get chalk color function by name */
function getChalkColorFn(colorName: string): ((s: string) => string) | null {
  return CHALK_COLORS[colorName] ?? null;
}

/** Apply chalk styling to a text string based on current style state */
function applyStyles(text: string, styles: TextStyle): string {
  if (!text) {
    return text;
  }
  let result = text;

  if (styles.bold) {
    result = chalk.bold(result);
  }
  if (styles.dim) {
    result = chalk.dim(result);
  }
  if (styles.italic) {
    result = chalk.italic(result);
  }
  if (styles.underline) {
    result = chalk.underline(result);
  }
  if (styles.strikethrough) {
    result = chalk.strikethrough(result);
  }
  if (styles.inverse) {
    result = chalk.inverse(result);
  }

  if (styles.color) {
    if (styles.color.startsWith("#")) {
      result = chalk.hex(styles.color)(result);
    } else {
      const colorFn = getChalkColorFn(styles.color);
      if (colorFn) {
        result = colorFn(result);
      }
    }
  }

  if (styles.backgroundColor) {
    if (styles.backgroundColor.startsWith("#")) {
      result = chalk.bgHex(styles.backgroundColor)(result);
    } else {
      const bgKey =
        "bg" + styles.backgroundColor.charAt(0).toUpperCase() + styles.backgroundColor.slice(1);
      const bgFn = getChalkColorFn(bgKey);
      if (bgFn) {
        result = bgFn(result);
      }
    }
  }

  return result;
}

/** Get padding value from class list (e.g., "pl-2" -> 2) */
function getPadding(classes: Set<string>, prefix: string): number {
  for (const cls of classes) {
    if (cls.startsWith(prefix + "-")) {
      const val = parseInt(cls.slice(prefix.length + 1), 10);
      if (!isNaN(val)) {
        return val;
      }
    }
  }
  return 0;
}

/** Get gap value from class list (e.g., "gap-2" -> 2) */
function getGap(classes: Set<string>): number {
  for (const cls of classes) {
    if (cls.startsWith("gap-")) {
      const val = parseInt(cls.slice(4), 10);
      if (!isNaN(val)) {
        return val;
      }
    }
  }
  return 0;
}

/** Get border color from class list */
function getBorderColor(classes: Set<string>): string {
  const borderModifiers = [
    "border-top",
    "border-bottom",
    "border-left",
    "border-right",
    "border-round",
    "border-single",
    "border-bold",
    "border-double",
  ];
  for (const cls of classes) {
    if (cls.startsWith("border-") && !borderModifiers.includes(cls)) {
      const color = cls.slice(7);
      if (color.startsWith("hex-")) {
        return "#" + color.slice(4);
      }
      return color;
    }
  }
  return "gray";
}

/** Get border style from class list */
function getBorderStyle(classes: Set<string>): string {
  if (classes.has("border-round")) {
    return "round";
  }
  if (classes.has("border-bold")) {
    return "bold";
  }
  if (classes.has("border-double")) {
    return "double";
  }
  return "single";
}

/** Render a border line */
function renderBorderLine(
  contentWidth: number,
  type: "top" | "bottom",
  style: string,
  color: string,
): string {
  const chars = BOX_CHARS[style] ?? BOX_CHARS.single;
  const line = chars.horizontal.repeat(Math.max(0, contentWidth));
  const border =
    type === "top"
      ? chars.topLeft + line + chars.topRight
      : chars.bottomLeft + line + chars.bottomRight;

  if (color.startsWith("#")) {
    return chalk.hex(color)(border);
  }
  const colorFn = getChalkColorFn(color);
  if (colorFn) {
    return colorFn(border);
  }
  return border;
}

/** Strip ANSI escape codes from a string to measure visible length */
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, "");
}

/** Visible length of a string (excluding ANSI codes) */
function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/** Render a VDomNode tree to an ANSI string */
export function renderToANSI(vnode: VDomNode, ctx?: RenderContext): string {
  const renderCtx = ctx ?? createRenderContext();
  return renderNode(vnode, renderCtx);
}

/** Internal recursive renderer */
function renderNode(vnode: VDomNode, ctx: RenderContext): string {
  if (vnode.tag === V_TEXT_NODE) {
    return applyStyles(vnode.html, ctx.styles);
  }

  if (typeof vnode.tag === "string" && vnode.tag === SPLITTER) {
    const text = vnode.html.replace(/<[^>]*>/g, "");
    return applyStyles(text, ctx.styles);
  }

  if (typeof vnode.tag !== "string") {
    return "";
  }

  const tag = vnode.tag;
  const attrsMap = vnode.attrsMap ?? {};
  const classStr = typeof attrsMap.class === "string" ? attrsMap.class : undefined;
  const classes = parseClasses(classStr);
  const newCtx = applyClassStyles(ctx, classes);

  if (vnode.selfClose) {
    if (tag === "br") {
      return "\n";
    }
    if (tag === "hr") {
      const width = ctx.width;
      return "─".repeat(width) + "\n";
    }
    return "";
  }

  const children = vnode.children ?? [];
  const isRow = classes.has("row");
  const gap = getGap(classes);

  let childOutput: string;

  if (isRow) {
    const rendered = children.map((c) => renderNode(c, newCtx));
    childOutput = rendered.join(" ".repeat(gap));
  } else {
    const rendered = children.map((c) => renderNode(c, newCtx));
    childOutput = rendered.join("");
  }

  const paddingLeft = getPadding(classes, "pl") + getPadding(classes, "ml");
  const paddingTop = getPadding(classes, "pt");
  const paddingBottom = getPadding(classes, "pb");

  const hasBorderTop = classes.has("border-top") || classes.has("border");
  const hasBorderBottom = classes.has("border-bottom") || classes.has("border");
  const borderStyle = getBorderStyle(classes);
  const borderColor = getBorderColor(classes);

  let output = "";

  output += "\n".repeat(paddingTop);

  if (hasBorderTop) {
    const contentLines = childOutput.split("\n").filter((l) => l.length > 0);
    const maxContentWidth =
      contentLines.length > 0 ? Math.max(...contentLines.map((l) => visibleLength(l))) : 0;
    const borderWidth = Math.min(maxContentWidth + paddingLeft * 2, ctx.width - 2);
    output += renderBorderLine(borderWidth, "top", borderStyle, borderColor) + "\n";
  }

  const indent = " ".repeat(paddingLeft + ctx.indent * 2);
  const lines = childOutput.split("\n");
  for (const line of lines) {
    if (line.length > 0) {
      output += indent + line + "\n";
    }
  }

  if (hasBorderBottom) {
    const contentLines = childOutput.split("\n").filter((l) => l.length > 0);
    const maxContentWidth =
      contentLines.length > 0 ? Math.max(...contentLines.map((l) => visibleLength(l))) : 0;
    const borderWidth = Math.min(maxContentWidth + paddingLeft * 2, ctx.width - 2);
    output += renderBorderLine(borderWidth, "bottom", borderStyle, borderColor) + "\n";
  }

  output += "\n".repeat(paddingBottom);

  if (tag === "p") {
    output += "\n";
  }

  if (classes.has("truncate")) {
    const outputLines = output.split("\n");
    output = outputLines
      .map((line) => {
        if (visibleLength(line) > ctx.width) {
          return stripAnsi(line).slice(0, ctx.width - 1) + "…";
        }
        return line;
      })
      .join("\n");
  }

  return output;
}
