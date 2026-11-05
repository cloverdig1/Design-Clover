import type { VectorObject } from "../editor-types";
import type { BreakpointSettings, Device, ResponsiveFrame } from "../responsive/layoutEngine";
import { DEFAULT_BREAKPOINTS } from "../responsive/layoutEngine";
import { detectStructure } from "../structure/detectStructure";
import type { DesignToken, StructureNode, StructureRole } from "../design-document";

export type WebsiteAsset = { path: string; data: Uint8Array };
export type GeneratedWebsite = {
  html: string;
  css: string;
  assets: WebsiteAsset[];
  structure: StructureNode[];
  warnings: string[];
};

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const escapeCss = (value: string) => value.replace(/[<>{};\\]/g, "");
const cssNumber = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value : fallback;
const cssColor = (value: string | undefined, fallback = "#111111") => {
  const color = value?.trim() || "";
  return /^(#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+\-/,\s]+\)|[a-z]{1,24})$/i.test(color)
    ? color
    : fallback;
};
const cssFontFamily = (value: string) => value.split(",")
  .map((family) => family.replace(/[^a-z0-9 _-]/gi, "").trim())
  .filter(Boolean)
  .map((family) => /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(family) ? family : `"${family}"`)
  .join(", ") || "Arial, sans-serif";
const cssShadow = (value: string | undefined) => value && !/url/i.test(value) && /^[a-z0-9#(),.%+\s-]+$/i.test(value) ? value : "none";
const tokenVariable = (tokenId: string) => `--dc-token-${tokenId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;

function safeImageSource(value: string): string | null {
  if (/^https?:\/\//i.test(value) || /^(?:\/|\.\/|\.\.\/)/.test(value)) return value;
  return null;
}

function safeLinkHref(value: string): string {
  const href = value.trim();
  return /^(?:https?:|mailto:|tel:)/i.test(href) || /^(?:#|\/|\.\/|\.\.\/)/.test(href) ? href : "#";
}

function cssTokenValue(token: DesignToken): string | null {
  if (token.category === "dimension") return null;
  if (token.category === "color") return cssColor(token.value);
  if (token.category === "typography") return cssFontFamily(token.value);
  if (token.category === "font-size" || token.category === "spacing" || token.category === "radius") {
    const value = Number(token.value);
    return Number.isFinite(value) ? `${value}px` : null;
  }
  if (token.category === "font-weight") {
    return /^(?:[1-9]00|normal|bold|bolder|lighter)$/i.test(token.value) ? token.value : null;
  }
  return cssShadow(token.value);
}

function dataAsset(dataUrl: string, id: string): WebsiteAsset | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp|svg\+xml));(base64|charset=[^;,]+)?[,]([\s\S]*)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const mime = match[1].toLowerCase();
    const extension = mime.includes("svg") ? "svg" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.split("/")[1];
    const encoded = match[3];
    const bytes = match[2]?.toLowerCase() === "base64"
      ? Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(encoded));
    return { path: `assets/${id}.${extension}`, data: bytes };
  } catch {
    return null;
  }
}

function pathData(object: VectorObject): string {
  if (!object.points?.length) return "";
  const points = object.points;
  const commands = [`M ${cssNumber(points[0].x)} ${cssNumber(points[0].y)}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.handleOut || current.handleIn) {
      commands.push(
        `C ${cssNumber(previous.x) + cssNumber(previous.handleOut?.x)} ${cssNumber(previous.y) + cssNumber(previous.handleOut?.y)}, ` +
        `${cssNumber(current.x) + cssNumber(current.handleIn?.x)} ${cssNumber(current.y) + cssNumber(current.handleIn?.y)}, ${cssNumber(current.x)} ${cssNumber(current.y)}`
      );
    } else commands.push(`L ${cssNumber(current.x)} ${cssNumber(current.y)}`);
  }
  if (object.closed) commands.push("Z");
  return commands.join(" ");
}

function semanticTag(role: StructureRole, object?: VectorObject): string {
  if (role === "page" || role === "element" || role === "group" || role === "icon") return "div";
  if (role === "nav" || role === "header" || role === "main" || role === "footer" || role === "section" || role === "article") return role;
  if (role === "heading") return (object?.semanticRole && /^h[1-6]$/.test(object.semanticRole) ? object.semanticRole : "h2");
  if (role === "paragraph" || role === "text") return "p";
  if (role === "button") return "button";
  if (role === "image") return "figure";
  return "div";
}

function makeDocumentHtml(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(title)} website generated with Design Clover">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div class="dc-page">
${content.split("\n").map((line) => `    ${line}`).join("\n")}
  </div>
</body>
</html>
`;
}

export function generateWebsite(
  objects: VectorObject[],
  options: {
    title?: string;
    breakpoints?: BreakpointSettings;
    viewports?: Record<Device, ResponsiveFrame>;
    structure?: StructureNode[];
    tokens?: DesignToken[];
  } = {}
): GeneratedWebsite {
  const breakpoints = { ...DEFAULT_BREAKPOINTS, ...options.breakpoints };
  const structure = options.structure?.length ? options.structure : detectStructure(objects);
  const visibleObjects = objects.filter((object) => object.visible !== false ||
    object.responsiveOverrides?.tablet?.visible === true || object.responsiveOverrides?.mobile?.visible === true);
  const objectMap = new Map(visibleObjects.map((object) => [object.id, object]));
  const assets: WebsiteAsset[] = [];
  const warnings: string[] = [];
  const assetPaths = new Map<string, string>();
  const visited = new Set<string>();

  visibleObjects.forEach((object) => {
    if (object.type !== "image" || !object.imageData) return;
    if (object.imageData.startsWith("data:")) {
      const asset = dataAsset(object.imageData, object.id.replace(/[^a-z0-9_-]/gi, "-"));
      if (asset) {
        assets.push(asset);
        assetPaths.set(object.id, `./${asset.path}`);
      } else {
        warnings.push(`Image "${object.name}" uses an unsupported or invalid data URL and was omitted.`);
      }
    } else {
      const source = safeImageSource(object.imageData);
      if (source) assetPaths.set(object.id, source);
      else warnings.push(`Image "${object.name}" uses an unsupported source URL and was omitted.`);
    }
  });

  const styles: string[] = [
    "*, *::before, *::after { box-sizing: border-box; }",
    "html { color-scheme: light; }",
    "body { margin: 0; font-family: Inter, Arial, sans-serif; color: #172019; }",
    ".dc-page { position: relative; width: min(100%, 800px); min-height: 480px; margin-inline: auto; overflow: hidden; background: #ffffff; }"
  ];

  const roleCss = new Map<string, string>();
  const addObject = (object: VectorObject, position: "absolute" | "flow", semanticRole?: StructureRole): string => {
    if (visited.has(object.id)) return "";
    visited.add(object.id);
    const cls = `dc-object-${object.id.replace(/[^a-z0-9_-]/gi, "-")}`;
    const selector = `.${cls}`;
    const fill = cssColor(object.gradient?.stops[0]?.color || object.fill);
    const tokens = options.tokens || [];
    const tokenValue = (ref: string | undefined, fallback: string) => {
      const token = tokens.find((item) => item.id === ref);
      return token ? `var(${tokenVariable(token.id)}, ${escapeCss(fallback)})` : escapeCss(fallback);
    };
    const css: string[] = [];
    if (position === "absolute") {
      css.push(`position: absolute`, `left: ${cssNumber(object.x) / 8}%`, `top: ${cssNumber(object.y) / 4.8}%`,
        `width: ${cssNumber(object.width) / 8}%`, `height: ${cssNumber(object.height) / 4.8}%`);
    } else {
      css.push(`position: relative`, `width: min(100%, ${Math.max(1, cssNumber(object.width))}px)`,
        `min-height: ${Math.max(1, cssNumber(object.height))}px`, `flex: 0 1 ${Math.max(1, cssNumber(object.width))}px`);
    }
    if (object.visible === false) css.push("display: none");
    css.push(`color: ${object.tokenRefs?.fill ? tokenValue(object.tokenRefs.fill, fill) : fill}`);
    if (object.type === "rect" || object.type === "ellipse") {
      css.push(`background: ${object.tokenRefs?.fill ? tokenValue(object.tokenRefs.fill, fill) : fill}`);
      if (object.stroke && object.strokeWidth) css.push(`border: ${cssNumber(object.strokeWidth)}px solid ${cssColor(object.stroke)}`);
      if (object.type === "ellipse") css.push("border-radius: 50%");
      else if (object.cornerRadius) css.push(`border-radius: ${object.tokenRefs?.cornerRadius ? tokenValue(object.tokenRefs.cornerRadius, `${object.cornerRadius}px`) : `${object.cornerRadius}px`}`);
    }
    if (object.opacity !== undefined) css.push(`opacity: ${Math.max(0, Math.min(1, cssNumber(object.opacity, 1)))}`);
    if (object.shadow && !object.tokenRefs?.shadow) css.push(`box-shadow: ${cssShadow(object.shadow)}`);
    if (object.rotation) css.push(`transform: rotate(${cssNumber(object.rotation)}deg)`);
    if (object.type === "text") {
      css.push(`font-size: ${object.tokenRefs?.fontSize ? tokenValue(object.tokenRefs.fontSize, `${cssNumber(object.fontSize, 16)}px`) : `${cssNumber(object.fontSize, 16)}px`}`,
        `font-family: ${object.tokenRefs?.fontFamily ? tokenValue(object.tokenRefs.fontFamily, cssFontFamily(object.fontFamily || "Arial, sans-serif")) : cssFontFamily(object.fontFamily || "Arial, sans-serif")}`,
        `font-weight: ${/^(?:[1-9]00|normal|bold|bolder|lighter)$/i.test(object.fontWeight || "400") ? object.fontWeight || "400" : "400"}`,
        `font-style: ${/^(?:normal|italic|oblique)$/i.test(object.fontStyle || "normal") ? object.fontStyle || "normal" : "normal"}`,
        `letter-spacing: ${cssNumber(object.letterSpacing)}px`,
        `text-align: ${object.textAnchor === "middle" ? "center" : object.textAnchor === "end" ? "right" : "left"}`);
      if (object.textDecoration) css.push(`text-decoration: ${/^(?:none|underline|overline|line-through)$/i.test(object.textDecoration) ? object.textDecoration : "none"}`);
    }
    if (object.type === "image") css.push("object-fit: contain", "display: block", "max-width: 100%");
    if (object.layout?.mode === "flex") css.push("display: flex",
      `flex-direction: ${/^(?:row|row-reverse|column|column-reverse)$/.test(object.layout.direction || "") ? object.layout.direction : "row"}`,
      `gap: ${object.tokenRefs?.gap ? tokenValue(object.tokenRefs.gap, `${cssNumber(object.layout.gap)}px`) : `${cssNumber(object.layout.gap)}px`}`,
      `padding: ${cssNumber(object.layout.padding)}px`,
      `margin: ${cssNumber(object.layout.margin)}px`,
      `align-items: ${/^(?:start|center|end|stretch|baseline)$/.test(object.layout.align || "") ? object.layout.align : "stretch"}`,
      `justify-content: ${/^(?:start|center|end|space-between|space-around|space-evenly)$/.test(object.layout.justify || "") ? object.layout.justify : "start"}`);
    if (object.layout?.mode === "grid") css.push("display: grid",
      `grid-template-columns: repeat(${Math.max(1, Math.floor(cssNumber(object.layout.columns, 2)))}, minmax(0, 1fr))`,
      `gap: ${object.tokenRefs?.gap ? tokenValue(object.tokenRefs.gap, `${cssNumber(object.layout.gap)}px`) : `${cssNumber(object.layout.gap)}px`}`,
      `padding: ${cssNumber(object.layout.padding)}px`);
    if (object.layout?.widthMode === "fill") css.push("width: 100%");
    else if (object.layout?.widthMode === "hug" || object.layout?.widthMode === "auto") css.push("width: max-content");
    else if (object.layout?.widthMode === "percent") css.push(`width: ${Math.max(0, Math.min(1000, cssNumber(object.layout.widthPercent, 100)))}%`);
    if (object.layout?.heightMode === "fill") css.push("height: 100%");
    else if (object.layout?.heightMode === "hug" || object.layout?.heightMode === "auto") css.push("height: auto");
    else if (object.layout?.heightMode === "percent") css.push(`height: ${Math.max(0, Math.min(1000, cssNumber(object.layout.heightPercent, 100)))}%`);
    if (object.layout?.minWidth !== undefined) css.push(`min-width: ${cssNumber(object.layout.minWidth)}px`);
    if (object.layout?.maxWidth !== undefined) css.push(`max-width: ${cssNumber(object.layout.maxWidth)}px`);
    if (object.layout?.minHeight !== undefined) css.push(`min-height: ${cssNumber(object.layout.minHeight)}px`);
    if (object.layout?.maxHeight !== undefined) css.push(`max-height: ${cssNumber(object.layout.maxHeight)}px`);
    if (object.tokenRefs?.shadow) css.push(`box-shadow: ${tokenValue(object.tokenRefs.shadow, cssShadow(object.shadow))}`);
    styles.push(`${selector} { ${css.join("; ")}; }`);
    roleCss.set(object.id, selector);
    const classes = [cls, object.componentDefinitionId ? `dc-component-${object.componentDefinitionId.replace(/[^a-z0-9_-]/gi, "-")}` : ""].filter(Boolean).join(" ");
    const accessibleName = escapeHtml(object.name);
    if (object.type === "image") {
      const src = assetPaths.get(object.id);
      return src
        ? `<img class="${classes}" src="${escapeHtml(src)}" alt="${escapeHtml(object.alt || object.name)}" loading="lazy">`
        : `<div class="${classes}" role="img" aria-label="${accessibleName}"></div>`;
    }
    if (object.type === "path") {
      const d = pathData(object);
      return `<svg class="${classes}" viewBox="0 0 ${Math.max(1, cssNumber(object.width))} ${Math.max(1, cssNumber(object.height))}" role="img" aria-label="${accessibleName}" xmlns="http://www.w3.org/2000/svg"><path d="${escapeHtml(d)}" fill="${object.closed ? fill : "none"}" stroke="${cssColor(object.stroke, "none")}" stroke-width="${cssNumber(object.strokeWidth)}" fill-rule="${object.fillRule === "evenodd" ? "evenodd" : "nonzero"}"/></svg>`;
    }
    const text = object.type === "text" ? escapeHtml(object.text || "") : "";
    const objectRole = semanticRole || (object.semanticRole === "button"
      ? "button"
      : object.semanticRole === "link"
        ? "element"
        : objectRoleForText(object));
    const tag = object.type === "text"
      ? (objectRole === "button" ? "button" : object.semanticRole === "link" ? "a" : semanticTag(objectRole, object))
      : "div";
    const accessibility = tag === "button"
      ? ` type="button" aria-label="${accessibleName}"`
      : tag === "a"
        ? ` href="${escapeHtml(safeLinkHref(object.href || "#"))}" aria-label="${accessibleName}"`
        : "";
    return `<${tag} class="${classes}"${accessibility}>${text}</${tag}>`;
  };

  const renderNode = (node: StructureNode, position: "absolute" | "flow" = "absolute"): string => {
    const descendants = collectNodeObjects(node, objectMap);
    if (!descendants.length) return "";
    const childIds = new Set(node.children.flatMap((child) => collectNodeObjects(child, objectMap).map((object) => object.id)));
    const direct = descendants.filter((object) => !childIds.has(object.id));
    if (!node.children.length) {
      return direct.map((object) => addObject(object, position, node.role)).filter(Boolean).join("\n");
    }
    const id = `dc-structure-${node.id.replace(/[^a-z0-9_-]/gi, "-")}`;
    const selector = `.${id}`;
    const members = descendants;
    const minX = Math.min(...members.map((object) => cssNumber(object.x)));
    const minY = Math.min(...members.map((object) => cssNumber(object.y)));
    const maxX = Math.max(...members.map((object) => cssNumber(object.x) + cssNumber(object.width)));
    const maxY = Math.max(...members.map((object) => cssNumber(object.y) + cssNumber(object.height)));
    const layoutChildren = node.children.length > 1 && (node.layout?.mode === "flex" || node.layout?.mode === "grid" ||
      node.role === "header" || node.role === "nav" ||
      node.children.every((child) => child.objectIds.some((objectId) => objectMap.has(objectId))));
    const box: string[] = position === "absolute" && layoutChildren
      ? [`position: absolute`, `left: ${minX / 8}%`, `top: ${minY / 4.8}%`, `width: ${Math.max(1, maxX - minX) / 8}%`, `height: ${Math.max(1, maxY - minY) / 4.8}%`]
      : ["position: static"];
    if (layoutChildren) {
      const layout = node.layout;
      if (layout?.mode === "grid") {
        box.push("display: grid", `grid-template-columns: repeat(${Math.max(1, Math.floor(cssNumber(layout.columns, node.children.length)))}, minmax(0, 1fr))`,
          `gap: ${cssNumber(layout.gap)}px`, `padding: ${cssNumber(layout.padding)}px`);
      } else {
        box.push("display: flex",
          `flex-direction: ${/^(?:row|row-reverse|column|column-reverse)$/.test(layout?.direction || "") ? layout?.direction : "row"}`,
          `align-items: ${/^(?:start|center|end|stretch|baseline)$/.test(layout?.align || "") ? layout?.align : "center"}`,
          `justify-content: ${/^(?:start|center|end|space-between|space-around|space-evenly)$/.test(layout?.justify || "") ? layout?.justify : (node.role === "header" || node.role === "nav" ? "space-between" : "start")}`);
      }
      const widths = node.children.flatMap((child) => collectNodeObjects(child, objectMap)).map((object) => cssNumber(object.width));
      const average = widths.length ? widths.reduce((sum, width) => sum + width, 0) / widths.length : 0;
      if (layout?.mode !== "grid") box.push(`gap: ${cssNumber(layout?.gap, Math.max(0, Math.min(48, average * 0.1)))}px`);
      if (layout?.padding) box.push(`padding: ${cssNumber(layout.padding)}px`);
      if (layout?.margin) box.push(`margin: ${cssNumber(layout.margin)}px`);
    }
    styles.push(`${selector} { ${box.join("; ")}; }`);
    const childContent = node.children.map((child) => renderNode(child, layoutChildren ? "flow" : "absolute")).filter(Boolean).join("\n");
    const ownContent = direct.map((object) => addObject(object, layoutChildren ? "flow" : "absolute")).filter(Boolean).join("\n");
    const tag = semanticTag(node.role);
    const confidence = node.confidence;
    const metadata = typeof confidence === "number" ? ` data-detection-confidence="${confidence.toFixed(2)}"` : "";
    return `<${tag} class="${id}"${metadata} aria-label="${escapeHtml(node.name)}">\n${ownContent}\n${childContent}\n</${tag}>`;
  };

  const content = structure.map((node) => renderNode(node)).filter(Boolean).join("\n");
  visibleObjects.filter((object) => !visited.has(object.id)).forEach((object) => {
    const markup = addObject(object, "absolute");
    if (markup) roleCss.set(object.id, roleCss.get(object.id) || "");
  });

  const responsiveRules: string[] = [];
  const priorVisibility = new Map(visibleObjects.map((object) => [object.id, object.visible !== false]));
  (["tablet", "mobile"] as Device[])
    .sort((first, second) => breakpoints[second] - breakpoints[first])
    .forEach((device) => {
    const maxWidth = breakpoints[device];
    const responsiveFrame = options.viewports?.[device] || { width: maxWidth, height: device === "mobile" ? 812 : 1024 };
    const logicalWidth = 800 * responsiveFrame.width / 1440;
    const logicalHeight = 480 * responsiveFrame.height / 900;
    const objectRules = visibleObjects.flatMap((object) => {
      const override = object.responsiveOverrides?.[device] || {};
      const selector = roleCss.get(object.id);
      if (!selector) return [];
      const properties = [
        override.x !== undefined ? `left: ${cssNumber(override.x) / logicalWidth * 100}%` : "",
        override.y !== undefined ? `top: ${cssNumber(override.y) / logicalHeight * 100}%` : "",
        override.width !== undefined ? `width: ${cssNumber(override.width) / logicalWidth * 100}%` : "",
        override.height !== undefined ? `height: ${cssNumber(override.height) / logicalHeight * 100}%` : ""
      ].filter(Boolean);
      const visible = override.visible ?? object.visible !== false;
      if (visible !== priorVisibility.get(object.id)) properties.push(visible ? "display: block" : "display: none");
      priorVisibility.set(object.id, visible);
      return properties.length ? [`  ${selector} { ${properties.join("; ")}; }`] : [];
    });
    responsiveRules.push(`@media (max-width: ${Math.max(1, cssNumber(maxWidth, DEFAULT_BREAKPOINTS[device]))}px) {\n  .dc-page { min-height: 100vh; }\n${objectRules.join("\n")}\n}`);
  });
  if (options.tokens?.length) {
    const declarations = options.tokens.flatMap((token) => {
      const value = cssTokenValue(token);
      if (!value && token.category !== "dimension") warnings.push(`Token "${token.name}" has an invalid value and was omitted from generated CSS.`);
      return value ? [`  ${tokenVariable(token.id)}: ${value};`] : [];
    }).join("\n");
    styles.unshift(`:root {\n${declarations}\n}`);
  }
  styles.push(...responsiveRules);
  return {
    html: makeDocumentHtml(options.title || "Design Clover Website", content || "<main></main>"),
    css: `${styles.join("\n\n")}\n`,
    assets,
    structure,
    warnings
  };
}

function objectRoleForText(object: VectorObject): StructureRole {
  if ((object.fontSize || 16) >= 28) return "heading";
  return "paragraph";
}

function collectNodeObjects(node: StructureNode, objects: Map<string, VectorObject>): VectorObject[] {
  const ids = new Set<string>(node.objectIds);
  node.children.forEach((child) => collectNodeObjects(child, objects).forEach((object) => ids.add(object.id)));
  return [...ids].map((id) => objects.get(id)).filter((object): object is VectorObject => !!object);
}
