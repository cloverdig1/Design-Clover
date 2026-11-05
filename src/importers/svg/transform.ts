export type Matrix = [number, number, number, number, number, number];

export const identityMatrix: Matrix = [1, 0, 0, 1, 0, 0];

export function multiplyMatrices(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f
  ];
}

export function transformPoint(matrix: Matrix, point: { x: number; y: number }) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

export function matrixScale(matrix: Matrix) {
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
}

export function matrixRotation(matrix: Matrix) {
  return Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
}

export function parseTransform(value: string | null): Matrix {
  if (!value) return identityMatrix;
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let result = identityMatrix;
  let match: RegExpExecArray | null;
  let consumed = "";
  while ((match = expression.exec(value))) {
    consumed += match[0];
    const values = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (values.some((item) => !Number.isFinite(item))) throw new Error("SVG contains an invalid transform.");
    const [x = 0, y = 0] = values;
    let next: Matrix;
    switch (match[1]) {
      case "matrix":
        if (values.length !== 6) throw new Error("SVG matrix() transforms need six values.");
        next = values as Matrix;
        break;
      case "translate":
        next = [1, 0, 0, 1, x, y];
        break;
      case "scale":
        next = [x, 0, 0, values.length > 1 ? y : x, 0, 0];
        break;
      case "rotate": {
        const angle = x * Math.PI / 180;
        const rotation: Matrix = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
        next = values.length >= 3
          ? multiplyMatrices([1, 0, 0, 1, values[1], values[2]], multiplyMatrices(rotation, [1, 0, 0, 1, -values[1], -values[2]]))
          : rotation;
        break;
      }
      case "skewX":
        next = [1, 0, Math.tan(x * Math.PI / 180), 1, 0, 0];
        break;
      case "skewY":
        next = [1, Math.tan(x * Math.PI / 180), 0, 1, 0, 0];
        break;
      default:
        throw new Error(`Unsupported SVG transform: ${match[1]}.`);
    }
    result = multiplyMatrices(result, next);
  }
  if (value.replace(/[\s,]+/g, "").length && consumed.replace(/[\s,]+/g, "") !== value.replace(/[\s,]+/g, "")) {
    throw new Error("SVG contains an invalid transform list.");
  }
  return result;
}

export function svgLength(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const match = value.trim().match(/^([-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?)(px|pt|pc|mm|cm|in)?$/i);
  if (!match) return fallback;
  const number = Number(match[1]);
  const factor = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[match[2]?.toLowerCase() as "px" | "pt" | "pc" | "mm" | "cm" | "in"] ?? 1;
  return number * factor;
}

export function viewBoxTransform(root: Element, width: number, height: number, sourceWidth = width, sourceHeight = height): Matrix {
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const box = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0
    ? viewBox as [number, number, number, number]
    : [0, 0, sourceWidth, sourceHeight];
  const [x, y, boxWidth, boxHeight] = box;
  const preserve = (root.getAttribute("preserveAspectRatio") || "xMidYMid meet").trim().split(/\s+/);
  if (preserve[0] === "none") {
    const sx = width / boxWidth;
    const sy = height / boxHeight;
    return [sx, 0, 0, sy, -x * sx, -y * sy];
  }
  const scale = preserve.includes("slice")
    ? Math.max(width / boxWidth, height / boxHeight)
    : Math.min(width / boxWidth, height / boxHeight);
  const alignment = preserve[0] || "xMidYMid";
  const extraX = width - boxWidth * scale;
  const extraY = height - boxHeight * scale;
  const offsetX = alignment.includes("xMax") ? extraX : alignment.includes("xMid") ? extraX / 2 : 0;
  const offsetY = alignment.includes("YMax") ? extraY : alignment.includes("YMid") ? extraY / 2 : 0;
  return [scale, 0, 0, scale, offsetX - x * scale, offsetY - y * scale];
}
