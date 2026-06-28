/**
 * Text component: inline text with styling.
 * Maps Ink's Text props to VDomNode with semantic CSS classes.
 */
import { vdomCreate } from "@lark.js/mvc";
import type { VDomNode } from "@lark.js/mvc";

export interface TextProps {
  /** Foreground color name (e.g., "red", "cyan") or hex without # */
  color?: string;
  /** Background color name or hex without # */
  backgroundColor?: string;
  /** Bold text */
  bold?: boolean;
  /** Dim text */
  dimColor?: boolean;
  /** Italic text */
  italic?: boolean;
  /** Underline text */
  underline?: boolean;
  /** Strikethrough text */
  strikethrough?: boolean;
  /** Inverse colors */
  inverse?: boolean;
  /** Text wrapping mode */
  wrap?: "wrap" | "truncate" | "truncate-end" | "truncate-middle" | "truncate-start";
  /** Unique identifier for diff key */
  id?: string;
  /** Child content: string or VDomNode(s) */
  children?: string | VDomNode | (string | VDomNode)[];
}

/** Create a Text VDomNode */
export function Text(props: TextProps): VDomNode {
  const classes: string[] = [];

  // Text styling
  if (props.bold) {
    classes.push("bold");
  }
  if (props.dimColor) {
    classes.push("dim");
  }
  if (props.italic) {
    classes.push("italic");
  }
  if (props.underline) {
    classes.push("underline");
  }
  if (props.strikethrough) {
    classes.push("strikethrough");
  }
  if (props.inverse) {
    classes.push("inverse");
  }

  // Color
  if (props.color) {
    if (props.color.startsWith("#")) {
      classes.push(`text-hex-${props.color.slice(1)}`);
    } else {
      classes.push(`text-${props.color}`);
    }
  }

  // Background color
  if (props.backgroundColor) {
    if (props.backgroundColor.startsWith("#")) {
      classes.push(`bg-hex-${props.backgroundColor.slice(1)}`);
    } else {
      classes.push(`bg-${props.backgroundColor}`);
    }
  }

  // Wrap
  if (props.wrap === "truncate" || props.wrap === "truncate-end") {
    classes.push("truncate");
  }

  const classStr = classes.join(" ");
  const attrs: Record<string, unknown> = {};
  if (classStr) {
    attrs.class = classStr;
  }
  if (props.id) {
    attrs.id = props.id;
  }
  const attrsOrNull = Object.keys(attrs).length > 0 ? attrs : null;

  // Build children array
  if (typeof props.children === "string") {
    return vdomCreate("span", attrsOrNull, [vdomCreate(0, props.children)]);
  }

  if (Array.isArray(props.children)) {
    const vdomChildren: VDomNode[] = props.children.map((c) => {
      if (typeof c === "string") {
        return vdomCreate(0, c);
      }
      return c;
    });
    return vdomCreate("span", attrsOrNull, vdomChildren);
  }

  if (props.children) {
    return vdomCreate("span", attrsOrNull, [props.children]);
  }

  return vdomCreate("span", attrsOrNull, []);
}
