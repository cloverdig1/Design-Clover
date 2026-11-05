import type { VectorObject } from "../editor-types";

export type Device = "desktop" | "tablet" | "mobile";
export type ResponsiveFrame = { width: number; height: number };
export type LayoutMode = "absolute" | "flex" | "grid";
export type DimensionMode = "fixed" | "auto" | "percent" | "fill" | "hug";

export type ResponsiveOverride = Partial<Pick<VectorObject, "x" | "y" | "width" | "height" | "visible">>;

export type LayoutConfig = {
  mode: LayoutMode;
  direction?: "row" | "column";
  gap?: number;
  padding?: number;
  margin?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  columns?: number;
  widthMode?: DimensionMode;
  heightMode?: DimensionMode;
  widthPercent?: number;
  heightPercent?: number;
  anchors?: Array<"left" | "right" | "top" | "bottom" | "center-x" | "center-y">;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};

export type BreakpointSettings = Record<Device, number>;

export const DEFAULT_BREAKPOINTS: BreakpointSettings = {
  mobile: 375,
  tablet: 768,
  desktop: 1440
};

export const DEFAULT_FRAMES: Record<Device, ResponsiveFrame> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 }
};

export function getResponsiveFrame(
  device: Device,
  breakpoints: BreakpointSettings,
  customFrame?: ResponsiveFrame
): ResponsiveFrame {
  if (customFrame && Number.isFinite(customFrame.width) && Number.isFinite(customFrame.height)) {
    return {
      width: Math.max(240, Math.min(3840, Math.round(customFrame.width))),
      height: Math.max(240, Math.min(3840, Math.round(customFrame.height)))
    };
  }
  const defaults = DEFAULT_FRAMES[device];
  return { ...defaults, width: breakpoints[device] };
}

export function resolveResponsiveObject(
  object: VectorObject,
  device: Device,
  frame: ResponsiveFrame,
  baseFrame: ResponsiveFrame = DEFAULT_FRAMES.desktop
): VectorObject {
  const override = object.responsiveOverrides?.[device] || {};
  const layout = object.layout;
  const widthScale = frame.width / baseFrame.width;
  const heightScale = frame.height / baseFrame.height;
  let x = object.x * widthScale;
  let y = object.y * heightScale;
  const widthMode = layout?.widthMode || "fixed";
  const heightMode = layout?.heightMode || "fixed";
  let width = widthMode === "fixed" ? object.width : object.width * widthScale;
  let height = heightMode === "fixed" ? object.height : object.height * heightScale;
  if ((widthMode === "auto" || widthMode === "hug") && object.type === "text") {
    width = Math.max(24, (object.text?.length || 1) * (object.fontSize || 16) * 0.58);
  }
  if (heightMode === "hug" && object.type === "text") height = Math.max(object.height, (object.fontSize || 16) * 1.3);

  if (layout?.anchors?.includes("right") && !layout.anchors.includes("left")) {
    x = frame.width * (800 / baseFrame.width) - object.x * widthScale - width;
  } else if (layout?.anchors?.includes("center-x")) {
    x = (frame.width * (800 / baseFrame.width) - width) / 2;
  }
  if (layout?.anchors?.includes("bottom") && !layout.anchors.includes("top")) {
    y = frame.height * (480 / baseFrame.height) - object.y * heightScale - height;
  } else if (layout?.anchors?.includes("center-y")) {
    y = (frame.height * (480 / baseFrame.height) - height) / 2;
  }

  x = override.x ?? x;
  y = override.y ?? y;
  width = override.width ?? width;
  height = override.height ?? height;
  if (layout?.minWidth !== undefined) width = Math.max(width, layout.minWidth);
  if (layout?.maxWidth !== undefined) width = Math.min(width, layout.maxWidth);
  if (layout?.minHeight !== undefined) height = Math.max(height, layout.minHeight);
  if (layout?.maxHeight !== undefined) height = Math.min(height, layout.maxHeight);

  const scaleX = width / Math.max(1, object.width);
  const scaleY = height / Math.max(1, object.height);
  return {
    ...object,
    x,
    y,
    width,
    height,
    visible: override.visible ?? object.visible,
    ...(object.type === "path" && object.points ? {
      points: object.points.map((point) => ({
        ...point,
        x: point.x * scaleX,
        y: point.y * scaleY,
        ...(point.handleIn ? { handleIn: { x: point.handleIn.x * scaleX, y: point.handleIn.y * scaleY } } : {}),
        ...(point.handleOut ? { handleOut: { x: point.handleOut.x * scaleX, y: point.handleOut.y * scaleY } } : {})
      }))
    } : {})
  };
}

function resizeObject(object: VectorObject, x: number, y: number, width: number, height: number): VectorObject {
  const scaleX = width / Math.max(1, object.width);
  const scaleY = height / Math.max(1, object.height);
  return {
    ...object,
    x,
    y,
    width,
    height,
    ...(object.type === "path" && object.points ? {
      points: object.points.map((point) => ({
        ...point,
        x: point.x * scaleX,
        y: point.y * scaleY,
        ...(point.handleIn ? { handleIn: { x: point.handleIn.x * scaleX, y: point.handleIn.y * scaleY } } : {}),
        ...(point.handleOut ? { handleOut: { x: point.handleOut.x * scaleX, y: point.handleOut.y * scaleY } } : {})
      }))
    } : {})
  };
}

function stackKey(object: VectorObject): string | undefined {
  if (object.groupId) return `group:${object.groupId}`;
  if (object.groupPath?.length) return `path:${object.groupPath.join("/")}`;
  return undefined;
}

function childSize(
  object: VectorObject,
  axis: "width" | "height",
  available: number,
  containerSize: number
): number {
  const config = object.layout;
  const mode = axis === "width" ? config?.widthMode : config?.heightMode;
  const measured = axis === "width" ? object.width : object.height;
  const minimum = axis === "width" ? config?.minWidth : config?.minHeight;
  const maximum = axis === "width" ? config?.maxWidth : config?.maxHeight;
  let size = mode === "fill" ? available
    : mode === "percent" ? containerSize * (axis === "width" ? config?.widthPercent || 100 : config?.heightPercent || 100) / 100
      : mode === "hug" && object.type === "text"
        ? Math.max(24, (object.text?.length || 1) * (object.fontSize || 16) * 0.6)
        : measured;
  if (mode === "auto" && object.type === "text" && axis === "width") {
    size = Math.max(size, (object.text?.length || 1) * (object.fontSize || 16) * 0.55);
  }
  if (minimum !== undefined) size = Math.max(minimum, size);
  if (maximum !== undefined) size = Math.min(maximum, size);
  return Math.max(0, size);
}

function applyStack(container: VectorObject, children: VectorObject[]): VectorObject[] {
  const layout = container.layout;
  if (!layout || layout.mode === "absolute" || !children.length) return children;
  const padding = Math.max(0, layout.padding || 0);
  const gap = Math.max(0, layout.gap || 0);
  const horizontal = layout.mode === "flex" && layout.direction !== "column";
  const columns = layout.mode === "grid" ? Math.max(1, Math.min(12, layout.columns || 2)) : horizontal ? children.length : 1;
  const rows = Math.ceil(children.length / columns);
  const cellWidth = (container.width - padding * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (container.height - padding * 2 - gap * (rows - 1)) / rows;

  if (layout.mode === "grid") {
    return children.map((child, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const width = childSize(child, "width", cellWidth, cellWidth);
      const height = childSize(child, "height", cellHeight, cellHeight);
      const x = container.x + padding + column * (cellWidth + gap) +
        (layout.align === "center" ? (cellWidth - width) / 2 : layout.align === "end" ? cellWidth - width : 0);
      const y = container.y + padding + row * (cellHeight + gap) +
        (layout.align === "center" ? (cellHeight - height) / 2 : layout.align === "end" ? cellHeight - height : 0);
      return resizeObject(child, x, y, width, height);
    });
  }

  const mainAvailable = horizontal ? container.width - padding * 2 : container.height - padding * 2;
  const crossAvailable = horizontal ? container.height - padding * 2 : container.width - padding * 2;
  const mainAxis = horizontal ? "width" : "height";
  const crossAxis = horizontal ? "height" : "width";
  const mainGaps = gap * Math.max(0, children.length - 1);
  const fillCount = children.filter((child) => (horizontal ? child.layout?.widthMode : child.layout?.heightMode) === "fill").length;
  const fixedTotal = children.reduce((sum, child) => {
    const fill = (horizontal ? child.layout?.widthMode : child.layout?.heightMode) === "fill";
    return sum + (fill ? 0 : childSize(child, mainAxis, mainAvailable, mainAvailable));
  }, 0);
  const fillSize = fillCount ? Math.max(0, (mainAvailable - mainGaps - fixedTotal) / fillCount) : 0;
  const mainSizes = children.map((child) => (horizontal ? child.layout?.widthMode : child.layout?.heightMode) === "fill"
    ? childSize(child, mainAxis, fillSize, mainAvailable)
    : childSize(child, mainAxis, mainAvailable, mainAvailable));
  const occupied = mainSizes.reduce((sum, size) => sum + size, 0) + mainGaps;
  const leftover = Math.max(0, mainAvailable - occupied);
  const leading = layout.justify === "center" ? leftover / 2
    : layout.justify === "end" ? leftover
      : layout.justify === "space-around" ? leftover / Math.max(1, children.length * 2) : 0;
  const distributedGap = layout.justify === "space-between" && children.length > 1
    ? gap + leftover / (children.length - 1)
    : layout.justify === "space-around" ? gap + leftover / children.length : gap;
  let cursor = (horizontal ? container.x : container.y) + padding + leading;

  return children.map((child, index) => {
    const mainSize = mainSizes[index];
    let crossSize = childSize(child, crossAxis, crossAvailable, crossAvailable);
    if (layout.align === "stretch" && (horizontal ? child.layout?.heightMode : child.layout?.widthMode) !== "fixed") crossSize = crossAvailable;
    const crossOffset = layout.align === "center" ? (crossAvailable - crossSize) / 2
      : layout.align === "end" ? crossAvailable - crossSize : 0;
    const x = horizontal ? cursor : container.x + padding + crossOffset;
    const y = horizontal ? container.y + padding + crossOffset : cursor;
    cursor += mainSize + distributedGap;
    return resizeObject(
      child,
      x,
      y,
      horizontal ? mainSize : crossSize,
      horizontal ? crossSize : mainSize
    );
  });
}

export function resolveResponsiveObjects(
  objects: VectorObject[],
  device: Device,
  frame: ResponsiveFrame
): VectorObject[] {
  const resolved = objects.map((object) => resolveResponsiveObject(object, device, frame));
  const result = new Map(resolved.map((object) => [object.id, object]));
  const groups = new Map<string, VectorObject[]>();
  resolved.forEach((object) => {
    const key = stackKey(object);
    if (key) groups.set(key, [...(groups.get(key) || []), object]);
  });
  for (const members of groups.values()) {
    const container = members.find((object) => object.layout && object.layout.mode !== "absolute");
    if (!container) continue;
    const children = members.filter((object) => object.id !== container.id && object.visible !== false);
    applyStack(container, children).forEach((object) => result.set(object.id, object));
  }
  return resolved.map((object) => result.get(object.id) || object);
}

export type LayoutWarning = {
  code: "overflow" | "overlap" | "outside";
  objectIds: string[];
  message: string;
};

export function validateResponsiveLayout(
  objects: VectorObject[],
  device: Device,
  frame: ResponsiveFrame
): LayoutWarning[] {
  const logicalWidth = 800 * frame.width / DEFAULT_FRAMES.desktop.width;
  const logicalHeight = 480 * frame.height / DEFAULT_FRAMES.desktop.height;
  const visible = resolveResponsiveObjects(objects, device, frame)
    .filter((object) => object.visible !== false);
  const warnings: LayoutWarning[] = [];

  visible.forEach((object) => {
    if (object.x < 0 || object.y < 0 || object.x + object.width > logicalWidth || object.y + object.height > logicalHeight) {
      warnings.push({
        code: "outside",
        objectIds: [object.id],
        message: `${object.name} extends beyond the visible artboard.`
      });
    }
    if ((object.type === "text" && object.width < Math.max(24, (object.text?.length || 1) * (object.fontSize || 16) * 0.3)) ||
        (object.type === "image" && (object.width > logicalWidth || object.height > logicalHeight))) {
      warnings.push({
        code: "overflow",
        objectIds: [object.id],
        message: `${object.name} may overflow or clip at this viewport.`
      });
    }
  });

  for (let first = 0; first < visible.length; first += 1) {
    for (let second = first + 1; second < visible.length; second += 1) {
      const a = visible[first];
      const b = visible[second];
      const intersectionWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const intersectionHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const intersection = intersectionWidth > 0 && intersectionHeight > 0;
      const ratio = intersection ? (intersectionWidth * intersectionHeight) / Math.min(a.width * a.height, b.width * b.height) : 0;
      const firstGroup = stackKey(a);
      if (ratio > 0.8 && !(firstGroup && firstGroup === stackKey(b))) {
        warnings.push({
          code: "overlap",
          objectIds: [a.id, b.id],
          message: `${a.name} and ${b.name} substantially overlap.`
        });
      }
    }
  }
  return warnings;
}
