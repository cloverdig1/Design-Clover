import type { Point } from "../../editor-types";

export type ParsedSubpath = { points: Point[]; closed: boolean };

export function parseSvgPath(data: string): ParsedSubpath[] {
  const tokenPattern = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const tokens = data.match(tokenPattern) || [];
  if (data.replace(tokenPattern, "").replace(/[\s,]/g, "")) throw new Error("SVG path contains unsupported syntax.");
  const paths: ParsedSubpath[] = [];
  let points: Point[] = [];
  let closed = false;
  let command = "";
  let index = 0;
  let x = 0, y = 0, startX = 0, startY = 0;
  let previousCommand = "";
  let previousCubic: { x: number; y: number } | null = null;
  let previousQuadratic: { x: number; y: number } | null = null;
  const isCommand = (token: string) => /^[A-Za-z]$/.test(token);
  const read = () => {
    if (index >= tokens.length || isCommand(tokens[index])) throw new Error("SVG path command is missing a parameter.");
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new Error("SVG path contains a non-finite coordinate.");
    return value;
  };
  const finish = () => {
    if (points.length) paths.push({ points, closed });
    points = [];
    closed = false;
  };
  const addLine = (nx: number, ny: number) => {
    x = nx; y = ny;
    points.push({ x, y });
    previousCubic = null;
    previousQuadratic = null;
  };
  const addCubic = (c1: { x: number; y: number }, c2: { x: number; y: number }, end: { x: number; y: number }) => {
    const from = points[points.length - 1];
    if (!from) throw new Error("SVG path must begin with a moveto command.");
    from.handleOut = { x: c1.x - x, y: c1.y - y };
    x = end.x; y = end.y;
    points.push({ x, y, handleIn: { x: c2.x - x, y: c2.y - y } });
    previousCubic = c2;
    previousQuadratic = null;
  };
  const addArc = (rxValue: number, ryValue: number, rotation: number, large: boolean, sweep: boolean, end: { x: number; y: number }) => {
    let rx = Math.abs(rxValue), ry = Math.abs(ryValue);
    if (!rx || !ry || (x === end.x && y === end.y)) {
      if (x !== end.x || y !== end.y) addLine(end.x, end.y);
      return;
    }
    const radians = rotation * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const dx = (x - end.x) / 2, dy = (y - end.y) / 2;
    const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
    const radiusScale = xp * xp / (rx * rx) + yp * yp / (ry * ry);
    if (radiusScale > 1) {
      const correction = Math.sqrt(radiusScale);
      rx *= correction;
      ry *= correction;
    }
    const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
    const denominator = Math.max(1e-12, rx * rx * yp * yp + ry * ry * xp * xp);
    const factor = (large === sweep ? -1 : 1) * Math.sqrt(numerator / denominator);
    const cxp = factor * rx * yp / ry, cyp = factor * -ry * xp / rx;
    const cx = cos * cxp - sin * cyp + (x + end.x) / 2;
    const cy = sin * cxp + cos * cyp + (y + end.y) / 2;
    const angleBetween = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry;
    const vx = (-xp - cxp) / rx, vy = (-yp - cyp) / ry;
    const theta = Math.atan2(uy, ux);
    let delta = angleBetween(ux, uy, vx, vy);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
    const pointAt = (angle: number) => ({
      x: cx + rx * Math.cos(angle) * cos - ry * Math.sin(angle) * sin,
      y: cy + rx * Math.cos(angle) * sin + ry * Math.sin(angle) * cos
    });
    const derivativeAt = (angle: number) => ({
      x: -rx * Math.sin(angle) * cos - ry * Math.cos(angle) * sin,
      y: -rx * Math.sin(angle) * sin + ry * Math.cos(angle) * cos
    });
    for (let part = 0; part < count; part++) {
      const a0 = theta + delta * part / count;
      const a1 = theta + delta * (part + 1) / count;
      const alpha = 4 / 3 * Math.tan((a1 - a0) / 4);
      const p0 = pointAt(a0), p1 = pointAt(a1);
      const d0 = derivativeAt(a0), d1 = derivativeAt(a1);
      addCubic(
        { x: p0.x + alpha * d0.x, y: p0.y + alpha * d0.y },
        { x: p1.x - alpha * d1.x, y: p1.y - alpha * d1.y },
        part === count - 1 ? end : p1
      );
    }
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    if (!command) throw new Error("SVG path does not start with a command.");
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const px = (value: number) => relative ? x + value : value;
    const py = (value: number) => relative ? y + value : value;

    if (upper === "Z") {
      closed = true;
      x = startX; y = startY;
      command = "";
      previousCubic = null; previousQuadratic = null;
      previousCommand = upper;
      continue;
    }
    if (upper === "M") {
      const nx = px(read()), ny = py(read());
      finish();
      x = nx; y = ny; startX = x; startY = y;
      points.push({ x, y });
      command = relative ? "l" : "L";
    } else if (upper === "L") {
      addLine(px(read()), py(read()));
    } else if (upper === "H") {
      addLine(px(read()), y);
    } else if (upper === "V") {
      addLine(x, py(read()));
    } else if (upper === "C") {
      addCubic(
        { x: px(read()), y: py(read()) },
        { x: px(read()), y: py(read()) },
        { x: px(read()), y: py(read()) }
      );
    } else if (upper === "S") {
      const c1 = (previousCommand === "C" || previousCommand === "S") && previousCubic
        ? { x: 2 * x - previousCubic.x, y: 2 * y - previousCubic.y }
        : { x, y };
      addCubic(c1, { x: px(read()), y: py(read()) }, { x: px(read()), y: py(read()) });
    } else if (upper === "Q" || upper === "T") {
      const control = upper === "Q"
        ? { x: px(read()), y: py(read()) }
        : (previousCommand === "Q" || previousCommand === "T") && previousQuadratic
          ? { x: 2 * x - previousQuadratic.x, y: 2 * y - previousQuadratic.y }
          : { x, y };
      const end = { x: px(read()), y: py(read()) };
      addCubic(
        { x: x + (2 / 3) * (control.x - x), y: y + (2 / 3) * (control.y - y) },
        { x: end.x + (2 / 3) * (control.x - end.x), y: end.y + (2 / 3) * (control.y - end.y) },
        end
      );
      previousQuadratic = control;
    } else if (upper === "A") {
      const rx = read(), ry = read(), rotation = read();
      const large = read() !== 0, sweep = read() !== 0;
      addArc(rx, ry, rotation, large, sweep, { x: px(read()), y: py(read()) });
    } else {
      throw new Error(`Unsupported SVG path command: ${command}.`);
    }
    previousCommand = upper;
  }
  finish();
  return paths;
}
