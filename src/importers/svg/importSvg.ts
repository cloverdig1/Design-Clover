import type { ObjectGradient, Point, VectorObject } from "../../editor-types";
import { MAX_IMPORTED_OBJECTS, type ImportResult } from "../import-types";
import { parseSvgPath, type ParsedSubpath } from "./paths";
import {
  identityMatrix,
  matrixRotation,
  matrixScale,
  multiplyMatrices,
  parseTransform,
  svgLength,
  transformPoint,
  viewBoxTransform,
  type Matrix
} from "./transform";

type Styles = Record<string, string>;
type StyleRule = { selector: string; declarations: Styles; specificity: number; order: number };
type GradientMap = Map<string, ObjectGradient>;

const inheritedProperties = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "font-family", "font-size",
  "font-weight", "font-style", "text-anchor", "letter-spacing", "text-decoration",
  "visibility", "color"
];
const ignoredContainers = new Set(["defs", "clipPath", "mask", "pattern", "marker", "symbol", "metadata", "title", "desc"]);
function parseDeclarations(value: string): Styles {
  const declarations: Styles = {};
  for (const part of value.split(";")) {
    const separator = part.indexOf(":");
    if (separator <= 0) continue;
    declarations[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim().replace(/\s*!important\s*$/i, "");
  }
  return declarations;
}

function simpleSelectorMatches(element: Element, selector: string): boolean {
  const match = selector.trim().match(/^([a-z][\w-]*|\*)?(?:#([\w-]+))?(?:\.([\w.-]+))?$/i);
  if (!match) return false;
  return (!match[1] || match[1] === "*" || element.localName.toLowerCase() === match[1].toLowerCase())
    && (!match[2] || element.id === match[2])
    && (!match[3] || match[3].split(".").every((name) => element.classList.contains(name)));
}

function collectStyleRules(root: Element, warnings: Set<string>): StyleRule[] {
  const rules: StyleRule[] = [];
  let order = 0;
  for (const style of Array.from(root.querySelectorAll("style"))) {
    const source = style.textContent || "";
    if (/@import|url\(\s*https?:/i.test(source)) continue;
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = parseDeclarations(rule[2]);
      for (const selector of rule[1].split(",")) {
        const cleaned = selector.trim();
        if (!/^([a-z][\w-]*|\*)?(?:#[\w-]+)?(?:\.[\w.-]+)?$/i.test(cleaned)) {
          warnings.add("Complex embedded CSS selectors are not supported; simple tag, id, and class rules are applied.");
          continue;
        }
        const parts = cleaned.match(/[#.]/g)?.length || 0;
        rules.push({ selector: cleaned, declarations, specificity: parts * 100 + (/[a-z]/i.test(cleaned[0] || "") ? 1 : 0), order: order++ });
      }
    }
  }
  return rules;
}

function ownStyles(element: Element, parent: Styles, rules: StyleRule[]): Styles {
  const result: Styles = {};
  for (const property of inheritedProperties) {
    if (parent[property] !== undefined) result[property] = parent[property];
  }
  const matched = rules.filter((rule) => simpleSelectorMatches(element, rule.selector))
    .sort((left, right) => left.specificity - right.specificity || left.order - right.order);
  for (const rule of matched) Object.assign(result, rule.declarations);
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (inheritedProperties.includes(name) || name === "display" || name === "opacity" || name === "transform" || name === "transform-origin" || name === "clip-path" || name === "mask" || name === "filter") {
      result[name] = attribute.value;
    }
  }
  Object.assign(result, parseDeclarations(element.getAttribute("style") || ""));
  return result;
}

function parseGradient(root: Element, id: string): ObjectGradient | undefined {
  const element = root.ownerDocument.getElementById(id);
  if (!element || (element.localName !== "linearGradient" && element.localName !== "radialGradient")) return undefined;
  const type = element.localName === "linearGradient" ? "linear" : "radial";
  const units = element.getAttribute("gradientUnits") || "objectBoundingBox";
  if (units !== "objectBoundingBox" || element.hasAttribute("gradientTransform")) return undefined;
  const stops = Array.from(element.querySelectorAll(":scope > stop")).map((stop) => {
    const styles = parseDeclarations(stop.getAttribute("style") || "");
    const offsetValue = stop.getAttribute("offset") || styles.offset || "0";
    const opacity = Math.max(0, Math.min(1, Number(stop.getAttribute("stop-opacity") || styles["stop-opacity"] || 1)));
    return {
      offset: offsetValue.endsWith("%") ? offsetValue : `${Number(offsetValue) * 100}%`,
      color: stop.getAttribute("stop-color") || styles["stop-color"] || "#000000",
      opacity
    };
  });
  if (!stops.length) return undefined;
  if (type === "linear") {
    return {
      type, stops,
      x1: element.getAttribute("x1") || "0%",
      y1: element.getAttribute("y1") || "0%",
      x2: element.getAttribute("x2") || "100%",
      y2: element.getAttribute("y2") || "0%"
    };
  }
  return {
    type, stops,
    cx: element.getAttribute("cx") || "50%",
    cy: element.getAttribute("cy") || "50%",
    r: element.getAttribute("r") || "50%",
    fx: element.getAttribute("fx") || element.getAttribute("cx") || "50%",
    fy: element.getAttribute("fy") || element.getAttribute("cy") || "50%"
  };
}

function transformSubpath(subpath: ParsedSubpath, matrix: Matrix): ParsedSubpath {
  return {
    closed: subpath.closed,
    points: subpath.points.map((point) => {
      const transformed = transformPoint(matrix, point);
      const transformedHandle = (handle: Point["handleIn"]) => handle
        ? { x: matrix[0] * handle.x + matrix[2] * handle.y, y: matrix[1] * handle.x + matrix[3] * handle.y }
        : undefined;
      return {
        ...transformed,
        ...(point.handleIn ? { handleIn: transformedHandle(point.handleIn) } : {}),
        ...(point.handleOut ? { handleOut: transformedHandle(point.handleOut) } : {}),
        ...(point.smooth ? { smooth: true } : {})
      };
    })
  };
}

function pathBounds(points: Point[]) {
  const xs: number[] = [], ys: number[] = [];
  for (const point of points) {
    xs.push(point.x, point.x + (point.handleIn?.x || 0), point.x + (point.handleOut?.x || 0));
    ys.push(point.y, point.y + (point.handleIn?.y || 0), point.y + (point.handleOut?.y || 0));
  }
  return {
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)
  };
}

function toVectorPath(
  subpath: ParsedSubpath,
  common: Omit<VectorObject, "type" | "x" | "y" | "width" | "height" | "points" | "closed">,
  matrix: Matrix
): VectorObject {
  const transformed = transformSubpath(subpath, matrix);
  const bounds = pathBounds(transformed.points);
  return {
    ...common,
    type: "path",
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    points: transformed.points.map((point) => ({
      ...point,
      x: point.x - bounds.x,
      y: point.y - bounds.y
    })),
    closed: transformed.closed
  };
}

function rectPath(x: number, y: number, width: number, height: number, rx: number, ry: number): ParsedSubpath {
  const radiusX = Math.min(Math.abs(rx || ry), width / 2);
  const radiusY = Math.min(Math.abs(ry || rx), height / 2);
  if (!radiusX || !radiusY) {
    return { closed: true, points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] };
  }
  const k = 0.5522847498307936;
  const points: Point[] = [
    { x: x + radiusX, y },
    { x: x + width - radiusX, y },
    { x: x + width, y: y + radiusY },
    { x: x + width, y: y + height - radiusY },
    { x: x + width - radiusX, y: y + height },
    { x: x + radiusX, y: y + height },
    { x, y: y + height - radiusY },
    { x, y: y + radiusY }
  ];
  points[0].handleIn = { x: -k * radiusX, y: 0 };
  points[1].handleOut = { x: k * radiusX, y: 0 };
  points[2].handleIn = { x: 0, y: -k * radiusY };
  points[3].handleOut = { x: 0, y: k * radiusY };
  points[4].handleIn = { x: k * radiusX, y: 0 };
  points[5].handleOut = { x: -k * radiusX, y: 0 };
  points[6].handleIn = { x: 0, y: k * radiusY };
  points[7].handleOut = { x: 0, y: -k * radiusY };
  return { closed: true, points };
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): ParsedSubpath {
  const k = 0.5522847498307936;
  return {
    closed: true,
    points: [
      { x: cx + rx, y: cy, handleIn: { x: 0, y: k * ry }, handleOut: { x: 0, y: -k * ry } },
      { x: cx, y: cy - ry, handleIn: { x: k * rx, y: 0 }, handleOut: { x: -k * rx, y: 0 } },
      { x: cx - rx, y: cy, handleIn: { x: 0, y: -k * ry }, handleOut: { x: 0, y: k * ry } },
      { x: cx, y: cy + ry, handleIn: { x: -k * rx, y: 0 }, handleOut: { x: k * rx, y: 0 } }
    ]
  };
}

function parsePoints(value: string): { x: number; y: number }[] {
  const numbers = value.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)?.map(Number) || [];
  if (numbers.length < 4 || numbers.length % 2 !== 0 || numbers.some((number) => !Number.isFinite(number))) return [];
  return Array.from({ length: numbers.length / 2 }, (_, index) => ({ x: numbers[index * 2], y: numbers[index * 2 + 1] }));
}

function safePaint(value: string, fallback: string, warnings: Set<string>) {
  if (!/url\(/i.test(value) || /^url\(\s*#[^)]+\s*\)$/i.test(value)) return value;
  warnings.add("External SVG paint references were blocked and replaced with a solid color.");
  return fallback;
}

function safeEmbeddedImage(href: string): string | undefined {
  const match = href.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (match) return `data:${match[1].toLowerCase()};base64,${match[2].replace(/\s/g, "")}`;
  const svgMatch = href.match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!svgMatch) return undefined;
  try {
    const bytes = Uint8Array.from(atob(svgMatch[1].replace(/\s/g, "")), (character) => character.charCodeAt(0));
    const markup = new TextDecoder().decode(bytes);
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = parsed.documentElement;
    if (parsed.querySelector("parsererror") || root.localName !== "svg" || root.querySelector("script,foreignObject,iframe,object,embed,style,link")) return undefined;
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (Array.from(element.attributes).some((attribute) =>
        /^on/i.test(attribute.name)
        || /url\(\s*(?:https?:|\/\/|javascript:|file:)/i.test(attribute.value)
        || (/^(href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith("#") && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(attribute.value))
      )) return undefined;
    }
    const safeMarkup = new XMLSerializer().serializeToString(root);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeMarkup)}`;
  } catch {
    return undefined;
  }
}

export function importSvg(markup: string, fileName: string): ImportResult {
  if (markup.length > 20 * 1024 * 1024) throw new Error("SVG files must be 20 MB or smaller.");
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (parsed.querySelector("parsererror") || root.localName !== "svg") throw new Error("The selected file is not valid SVG.");
  if (root.querySelector("script,foreignObject,iframe,object,embed")) throw new Error("This SVG contains active or embedded content and was blocked.");
  if (root.hasAttribute("viewBox")) {
    const box = root.getAttribute("viewBox")!.trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || box.some((value) => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) {
      throw new Error("SVG has invalid viewBox dimensions.");
    }
  }
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (Array.from(element.attributes).some((attribute) => /^on/i.test(attribute.name))) {
      throw new Error("This SVG contains event-handler attributes and was blocked.");
    }
  }
  const width = Math.max(1, svgLength(root.getAttribute("width"), 800));
  const height = Math.max(1, svgLength(root.getAttribute("height"), 480));
  const rootMatrix = multiplyMatrices(viewBoxTransform(root, 800, 480, width, height), parseTransform(root.getAttribute("transform")));
  const warnings = new Set<string>();
  const rules = collectStyleRules(root, warnings);
  const objects: VectorObject[] = [];
  const gradientCache: GradientMap = new Map();
  let serial = 0;
  const baseName = fileName.replace(/\.svg$/i, "");

  const visit = (element: Element, parentMatrix: Matrix, inherited: Styles, groupPath: string[], groupNames: string[], parentOpacity: number) => {
    const tag = element.localName;
    if (ignoredContainers.has(tag) || tag === "style" || tag === "script") return;
    const styles = ownStyles(element, inherited, rules);
    if ((styles.display || "").toLowerCase() === "none" || (styles.visibility || "").toLowerCase() === "collapse") return;
    if (styles["clip-path"] && styles["clip-path"] !== "none" || styles.mask && styles.mask !== "none" || styles.filter && styles.filter !== "none") {
      warnings.add("SVG clip paths, masks, and filters are not reconstructed; affected elements may look different.");
    }
    if (styles["transform-origin"] && !element.hasAttribute("transform")) {
      warnings.add("CSS transform-origin is not supported; SVG transform attributes with rotate(angle, cx, cy) are supported.");
    }
    let localTransform: Matrix;
    try {
      localTransform = parseTransform(element.getAttribute("transform") || styles.transform || null);
    } catch (error) {
      warnings.add(error instanceof Error ? error.message : "An invalid SVG transform was skipped.");
      return;
    }
    const matrix = multiplyMatrices(parentMatrix, localTransform);
    let childGroups = groupPath;
    if (tag === "g" || (tag === "svg" && element !== root)) {
      const label = element.getAttribute("aria-label") || element.querySelector(":scope > title")?.textContent?.trim() || element.id || `Group ${serial + 1}`;
      const groupId = element.id ? `svg-group-${element.id}` : `svg-group-${serial++}`;
      childGroups = [...groupPath, groupId];
      for (const child of Array.from(element.children)) visit(child, matrix, styles, childGroups, [...groupNames, label], parentOpacity * Math.max(0, Math.min(1, Number(styles.opacity || 1))));
      return;
    }
    if (tag === "svg") {
      for (const child of Array.from(element.children)) visit(child, matrix, styles, childGroups, groupNames, parentOpacity * Math.max(0, Math.min(1, Number(styles.opacity || 1))));
      return;
    }

    const opacity = Math.max(0, Math.min(1, Number(styles.opacity || 1))) * parentOpacity;
    const fillOpacity = Math.max(0, Math.min(1, Number(styles["fill-opacity"] || 1)));
    const strokeOpacity = Math.max(0, Math.min(1, Number(styles["stroke-opacity"] || 1)));
    const rawFill = styles.fill || "black";
    const rawStroke = styles.stroke || "none";
    const color = (styles.color || "black").toLowerCase();
    const fill = safePaint(rawFill === "currentColor" ? color : rawFill, "#000000", warnings);
    const stroke = safePaint(rawStroke === "currentColor" ? color : rawStroke, "none", warnings);
    let gradient: ObjectGradient | undefined;
    const gradientRef = fill.match(/^url\(\s*#([^)]+)\s*\)$/);
    if (gradientRef) {
      const id = gradientRef[1].trim();
      if (!gradientCache.has(id)) {
        const value = parseGradient(root, id);
        if (value) gradientCache.set(id, value);
        else warnings.add(`Gradient "${id}" uses unsupported units or transforms; a solid fallback was used.`);
      }
      gradient = gradientCache.get(id);
      if (!gradient) warnings.add(`Gradient "${id}" could not be resolved; a solid fallback was used.`);
    }
    const fallbackFill = gradient ? gradient.stops[gradient.stops.length - 1].color : gradientRef ? "#000000" : fill;
    const name = element.getAttribute("aria-label")
      || element.getAttribute("id")
      || element.querySelector(":scope > title")?.textContent?.trim()
      || `${baseName} / ${tag} ${serial + 1}`;
    const baseId = `svg-${Date.now()}-${serial++}`;
    const common: Omit<VectorObject, "type" | "x" | "y" | "width" | "height" | "points" | "closed"> = {
      id: baseId,
      name,
      fill: fallbackFill,
      rotation: 0,
      visible: (styles.visibility || "").toLowerCase() !== "hidden" && opacity > 0,
      ...(childGroups.length ? { groupId: childGroups[childGroups.length - 1], groupPath: childGroups, groupNames } : {}),
      ...(stroke !== "none" ? { stroke } : {}),
      ...(gradient ? { gradient } : {}),
      strokeWidth: svgLength(styles["stroke-width"] || null, 1) * matrixScale(multiplyMatrices(rootMatrix, matrix)),
      strokeOpacity,
      fillOpacity,
      opacity,
      fillRule: styles["fill-rule"] === "evenodd" ? "evenodd" : "nonzero",
      ...(styles["stroke-dasharray"] && styles["stroke-dasharray"] !== "none" ? { strokeDasharray: styles["stroke-dasharray"] } : {}),
      ...(styles["stroke-linecap"] === "butt" || styles["stroke-linecap"] === "square" ? { strokeLinecap: styles["stroke-linecap"] } : { strokeLinecap: "round" }),
      ...(styles["stroke-linejoin"] === "miter" || styles["stroke-linejoin"] === "bevel" ? { strokeLinejoin: styles["stroke-linejoin"] } : { strokeLinejoin: "round" })
    };
    const fullMatrix = multiplyMatrices(rootMatrix, matrix);
    let subpaths: ParsedSubpath[];
    if (tag === "path") {
      try {
        subpaths = parseSvgPath(element.getAttribute("d") || "");
      } catch {
        warnings.add("One or more malformed SVG paths were skipped.");
        return;
      }
    } else if (tag === "rect") {
      const x = svgLength(element.getAttribute("x"), 0), y = svgLength(element.getAttribute("y"), 0);
      const w = svgLength(element.getAttribute("width"), 0), h = svgLength(element.getAttribute("height"), 0);
      if (w <= 0 || h <= 0) return;
      subpaths = [rectPath(x, y, w, h, svgLength(element.getAttribute("rx"), 0), svgLength(element.getAttribute("ry"), 0))];
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = svgLength(element.getAttribute("cx"), 0), cy = svgLength(element.getAttribute("cy"), 0);
      const rx = svgLength(element.getAttribute(tag === "circle" ? "r" : "rx"), 0);
      const ry = tag === "circle" ? rx : svgLength(element.getAttribute("ry"), 0);
      if (rx <= 0 || ry <= 0) return;
      subpaths = [ellipsePath(cx, cy, rx, ry)];
    } else if (tag === "line") {
      const x1 = svgLength(element.getAttribute("x1"), 0), y1 = svgLength(element.getAttribute("y1"), 0);
      const x2 = svgLength(element.getAttribute("x2"), 0), y2 = svgLength(element.getAttribute("y2"), 0);
      subpaths = [{ closed: false, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] }];
    } else if (tag === "polyline" || tag === "polygon") {
      const points = parsePoints(element.getAttribute("points") || "");
      if (points.length < 2) return;
      subpaths = [{ points, closed: tag === "polygon" }];
    } else if (tag === "text") {
      const value = element.textContent?.replace(/\s+/g, " ").trim();
      if (!value) return;
      const x = svgLength(element.getAttribute("x"), 0), y = svgLength(element.getAttribute("y"), 0);
      const position = transformPoint(fullMatrix, { x, y });
      const scale = matrixScale(fullMatrix);
      const fontSize = svgLength(styles["font-size"] || null, 16) * scale;
      const rotation = matrixRotation(fullMatrix);
      const letterSpacing = svgLength(styles["letter-spacing"] || null, 0) * scale;
      const approximateWidth = Math.max(1, value.length * fontSize * 0.6 + Math.max(0, value.length - 1) * letterSpacing);
      objects.push({
        ...common,
        type: "text",
        x: position.x,
        y: position.y - fontSize,
        width: approximateWidth,
        height: fontSize * 1.25,
        fill: fallbackFill,
        rotation,
        text: value,
        fontSize,
        fontFamily: styles["font-family"] || "sans-serif",
        fontWeight: styles["font-weight"] || "normal",
        fontStyle: styles["font-style"] || "normal",
        textAnchor: styles["text-anchor"] === "middle" || styles["text-anchor"] === "end" ? styles["text-anchor"] : "start",
        letterSpacing,
        textDecoration: styles["text-decoration"] || "none"
      });
      if (element.querySelector("tspan")) warnings.add("Text with positioned or individually styled <tspan> elements was combined into a single editable text object.");
      if (element.hasAttribute("textLength") || element.hasAttribute("lengthAdjust")) warnings.add("SVG textLength/lengthAdjust formatting is not preserved.");
      return;
    } else if (tag === "image") {
      const href = element.getAttribute("href") || element.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
      const imageData = safeEmbeddedImage(href);
      if (!imageData) {
        warnings.add(href && !href.startsWith("data:") ? "External SVG images were skipped; embed the image before importing." : "Unsupported or unsafe embedded SVG images were skipped.");
        return;
      }
      const x = svgLength(element.getAttribute("x"), 0), y = svgLength(element.getAttribute("y"), 0);
      const w = svgLength(element.getAttribute("width"), 0), h = svgLength(element.getAttribute("height"), 0);
      if (w <= 0 || h <= 0) return;
      const corners = [
        transformPoint(fullMatrix, { x, y }),
        transformPoint(fullMatrix, { x: x + w, y }),
        transformPoint(fullMatrix, { x, y: y + h }),
        transformPoint(fullMatrix, { x: x + w, y: y + h })
      ];
      const minX = Math.min(...corners.map((point) => point.x)), maxX = Math.max(...corners.map((point) => point.x));
      const minY = Math.min(...corners.map((point) => point.y)), maxY = Math.max(...corners.map((point) => point.y));
      objects.push({
        ...common, type: "image", x: minX, y: minY, width: maxX - minX, height: maxY - minY,
        fill: "transparent", rotation: 0, imageData
      });
      if (Math.abs(fullMatrix[1]) > 1e-6 || Math.abs(fullMatrix[2]) > 1e-6) warnings.add("Rotated or skewed embedded images were imported using their axis-aligned bounds.");
      return;
    } else if (tag === "svg" || tag === "g") {
      return;
    } else {
      warnings.add(`Unsupported SVG element <${tag}> was skipped.`);
      return;
    }

    if (objects.length + subpaths.length > MAX_IMPORTED_OBJECTS) throw new Error(`SVG contains more than ${MAX_IMPORTED_OBJECTS} importable objects.`);
    const transformed = subpaths.map((subpath) => toVectorPath(subpath, common, fullMatrix));
    if (transformed.length > 1) {
      const subpathGroup = `${baseId}-subpaths`;
      for (const object of transformed) {
        object.groupId = subpathGroup;
        object.groupPath = [...childGroups, subpathGroup];
        object.groupNames = [...groupNames, name];
        object.name = `${name} / subpath`;
      }
    }
    objects.push(...transformed);
  };

  const baseStyles: Styles = {
    fill: "black", "fill-opacity": "1", "fill-rule": "nonzero",
    stroke: "none", "stroke-width": "1", "stroke-opacity": "1",
    opacity: "1", visibility: "visible", color: "black"
  };
  const rootStyles = ownStyles(root, baseStyles, rules);
  for (const child of Array.from(root.children)) {
    visit(child, identityMatrix, rootStyles, [], [], Math.max(0, Math.min(1, Number(rootStyles.opacity || 1))));
  }
  if (!objects.length) {
    const details = [...warnings].join(" ");
    throw new Error(`No supported editable SVG content was found.${details ? ` ${details}` : ""}`);
  }
  if (objects.length > MAX_IMPORTED_OBJECTS) throw new Error(`SVG contains more than ${MAX_IMPORTED_OBJECTS} importable objects.`);
  return { objects, warnings: [...warnings] };
}
