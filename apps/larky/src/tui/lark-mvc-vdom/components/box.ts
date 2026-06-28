/**
 * Box component: the main layout primitive for terminal views.
 * Maps Ink's Box props to VDomNode with semantic CSS classes.
 */
import { vdomCreate } from "@lark.js/mvc";
import type { VDomNode } from "@lark.js/mvc";

export interface BoxProps {
  /** Layout direction */
  flexDirection?: "row" | "column";
  /** Left padding (spaces) */
  paddingLeft?: number;
  /** Right padding (spaces) */
  paddingRight?: number;
  /** Top padding (newlines) */
  paddingTop?: number;
  /** Bottom padding (newlines) */
  paddingBottom?: number;
  /** Left margin (spaces) */
  marginLeft?: number;
  /** Top margin (newlines) */
  marginTop?: number;
  /** Bottom margin (newlines) */
  marginBottom?: number;
  /** Border style */
  borderStyle?: "round" | "single" | "bold" | "double";
  /** Show top border */
  borderTop?: boolean;
  /** Show bottom border */
  borderBottom?: boolean;
  /** Show left border */
  borderLeft?: boolean;
  /** Show right border */
  borderRight?: boolean;
  /** Border color (name or hex without #) */
  borderColor?: string;
  /** Show all borders */
  border?: boolean;
  /** Gap between row children (spaces) */
  gap?: number;
  /** Display mode */
  display?: "flex" | "none";
  /** Unique identifier for diff key */
  id?: string;
  /** Child nodes */
  children?: VDomNode | VDomNode[];
}

/** Create a Box VDomNode */
export function Box(props: BoxProps): VDomNode {
  const classes: string[] = [];

  if (props.flexDirection === "row") {
    classes.push("row");
  }
  if (props.paddingLeft) {
    classes.push(`pl-${String(props.paddingLeft)}`);
  }
  if (props.paddingTop) {
    classes.push(`pt-${String(props.paddingTop)}`);
  }
  if (props.paddingBottom) {
    classes.push(`pb-${String(props.paddingBottom)}`);
  }
  if (props.marginLeft) {
    classes.push(`ml-${String(props.marginLeft)}`);
  }
  if (props.marginTop) {
    classes.push(`pt-${String(props.marginTop)}`);
  }
  if (props.marginBottom) {
    classes.push(`pb-${String(props.marginBottom)}`);
  }
  if (props.border) {
    classes.push("border");
  }
  if (props.borderTop) {
    classes.push("border-top");
  }
  if (props.borderBottom) {
    classes.push("border-bottom");
  }
  if (props.borderStyle) {
    classes.push(`border-${props.borderStyle}`);
  }
  if (props.borderColor) {
    if (props.borderColor.startsWith("#")) {
      classes.push(`border-hex-${props.borderColor.slice(1)}`);
    } else {
      classes.push(`border-${props.borderColor}`);
    }
  }
  if (props.gap) {
    classes.push(`gap-${String(props.gap)}`);
  }
  if (props.display === "none") {
    return vdomCreate("div", { class: "hidden" }, []);
  }

  const classStr = classes.join(" ");
  const attrs: Record<string, unknown> = {};
  if (classStr) {
    attrs.class = classStr;
  }
  if (props.id) {
    attrs.id = props.id;
  }

  const childArray = Array.isArray(props.children)
    ? props.children
    : props.children
      ? [props.children]
      : [];

  return vdomCreate("div", Object.keys(attrs).length > 0 ? attrs : null, childArray);
}
