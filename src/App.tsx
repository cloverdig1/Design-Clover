import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ChangeEvent as ReactChangeEvent } from "react";
import {
  MousePointer2, Hand, Square, Circle, Type, Image as ImageIcon,
  Layers, Code2, Play, Pause, SkipBack, SkipForward, ChevronDown,
  ChevronRight, Plus, Minus, Settings2, Monitor, Smartphone, Tablet,
  Grid3X3, Undo2, Redo2, Upload, Eye, MoreHorizontal, Search, Move,
  RotateCw, Maximize2, PanelLeftClose, PanelRightClose, Sparkles,
  Film, Clock, Zap, Palette, Box, Diamond, Check, X, Trash2,
  Copy, Lock, Unlock, EyeOff, Group, Ungroup, AlignLeft, AlignCenter,
  AlignRight, BringToFront, SendToBack, Save, FolderOpen, Ruler, Magnet
} from "lucide-react";
import "./App.css";
import SplashScreen, { type RecentProject } from "./SplashScreen";
import { parseProjectFile, serializeProjectFile } from "./project-file";

type Mode = "Design" | "Prototype" | "Animate" | "Code";
type Tool = "select" | "direct" | "pen" | "pan" | "rect" | "ellipse" | "text";
type VectorType = "rect" | "ellipse" | "text" | "path";
type AnimationPreset = "bounce" | "drive" | "spin" | "pulse" | "slide-in" | "shake";

type VectorObject = {
  id: string;
  name: string;
  type: VectorType;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  rotation: number;
  text?: string;
  fontSize?: number;
  visible?: boolean;
  locked?: boolean;
  groupId?: string;
  points?: Point[];
  closed?: boolean;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  cornerRadius?: number;
};

type Keyframe = {
  frame: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
  outX?: number;
  outY?: number;
  inX?: number;
  inY?: number;
};

type AnimatedTransform = {
  x: number;
  y: number;
  rotation: number;
  scale: number;
};

function easeProgress(progress: number, easing: Keyframe["easing"]) {
  if (easing === "ease-in") return progress * progress;
  if (easing === "ease-out") return 1 - (1 - progress) * (1 - progress);
  if (easing === "ease-in-out") {
    return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  }
  return progress;
}

type Point = {
  x: number;
  y: number;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
  smooth?: boolean;
};

function buildVectorPath(points: Point[], x: number, y: number, closed = false) {
  if (!points.length) return "";
  const commands = [`M ${x + points[0].x} ${y + points[0].y}`];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous.handleOut || current.handleIn) {
      const p1 = previous.handleOut
        ? { x: x + previous.x + previous.handleOut.x, y: y + previous.y + previous.handleOut.y }
        : { x: x + previous.x, y: y + previous.y };
      const p2 = current.handleIn
        ? { x: x + current.x + current.handleIn.x, y: y + current.y + current.handleIn.y }
        : { x: x + current.x, y: y + current.y };
      commands.push(`C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${x + current.x} ${y + current.y}`);
    } else {
      commands.push(`L ${x + current.x} ${y + current.y}`);
    }
  }
  if (closed && points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (last.handleOut || first.handleIn) {
      const p1 = last.handleOut
        ? { x: x + last.x + last.handleOut.x, y: y + last.y + last.handleOut.y }
        : { x: x + last.x, y: y + last.y };
      const p2 = first.handleIn
        ? { x: x + first.x + first.handleIn.x, y: y + first.y + first.handleIn.y }
        : { x: x + first.x, y: y + first.y };
      commands.push(`C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${x + first.x} ${y + first.y}`);
    }
    commands.push("Z");
  }
  return commands.join(" ");
}

function getSegmentControls(start: Keyframe, end: Keyframe) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    p1: {
      x: start.x + (start.outX ?? dx / 3),
      y: start.y + (start.outY ?? dy / 3)
    },
    p2: {
      x: end.x + (end.inX ?? -dx / 3),
      y: end.y + (end.inY ?? -dy / 3)
    }
  };
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

function getMotionPath(frames: Keyframe[]) {
  const sorted = [...frames].sort((a, b) => a.frame - b.frame);
  if (sorted.length < 2) return "";
  return sorted.slice(0, -1).map((start, index) => {
    const end = sorted[index + 1];
    const { p1, p2 } = getSegmentControls(start, end);
    return `${index === 0 ? `M ${start.x} ${start.y}` : ""} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${end.x} ${end.y}`;
  }).join(" ");
}

function getActiveSegment(frames: Keyframe[], frame: number) {
  const sorted = [...frames].sort((a, b) => a.frame - b.frame);
  if (sorted.length < 2) return null;
  let index = sorted.findIndex((key) => key.frame > frame) - 1;
  if (index < 0) index = 0;
  if (index >= sorted.length - 1) index = sorted.length - 2;
  return { start: sorted[index], end: sorted[index + 1] };
}

function getAnimatedTransform(
  item: VectorObject,
  frame: number,
  frames: Keyframe[]
): AnimatedTransform {
  if (!frames.length) {
    return { x: item.x, y: item.y, rotation: item.rotation, scale: 1 };
  }

  const sorted = [...frames].sort((a, b) => a.frame - b.frame);
  const previous = [...sorted].reverse().find((key) => key.frame <= frame);
  const next = sorted.find((key) => key.frame >= frame);

  if (!previous) {
    const first = sorted[0];
    return { x: first.x, y: first.y, rotation: first.rotation, scale: first.scale };
  }

  if (!next || previous.frame === next.frame) {
    return {
      x: previous.x,
      y: previous.y,
      rotation: previous.rotation,
      scale: previous.scale
    };
  }

  const rawProgress = (frame - previous.frame) / (next.frame - previous.frame);
  const progress = easeProgress(rawProgress, previous.easing);
  const { p1, p2 } = getSegmentControls(previous, next);
  const position = cubicPoint(
    { x: previous.x, y: previous.y },
    p1,
    p2,
    { x: next.x, y: next.y },
    progress
  );

  return {
    x: position.x,
    y: position.y,
    rotation: previous.rotation + (next.rotation - previous.rotation) * progress,
    scale: previous.scale + (next.scale - previous.scale) * progress
  };
}

const starterObjects: VectorObject[] = [
  {
    id: "clover-rect",
    name: "Sample Rectangle",
    type: "rect",
    x: 48,
    y: 355,
    width: 125,
    height: 65,
    fill: "#39d98a",
    rotation: 0
  },
  {
    id: "clover-circle",
    name: "Sample Ellipse",
    type: "ellipse",
    x: 205,
    y: 355,
    width: 65,
    height: 65,
    fill: "#8b75ff",
    rotation: 0
  },
  {
    id: "clover-text",
    name: "Sample Text",
    type: "text",
    x: 310,
    y: 355,
    width: 180,
    height: 42,
    fill: "#e8eee9",
    rotation: 0,
    text: "Edit me",
    fontSize: 27
  }
];


function parseSimpleSvgPath(data: string): { points: Point[]; closed: boolean } | null {
  // Converts SVG line, cubic and quadratic commands into the editor's editable Bezier points.
  // Arc commands are safely approximated with sampled points rather than discarded.
  const tokens = data.match(/[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  const points: Point[] = [];
  let command = "", index = 0, x = 0, y = 0, startX = 0, startY = 0, closed = false;
  let previousControl: { x: number; y: number } | null = null;
  let previousCommand = "";
  const isCommand = (token: string) => /^[A-Za-z]$/.test(token);
  const read = () => {
    if (index >= tokens.length || isCommand(tokens[index])) throw new Error("Missing SVG path parameter");
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new Error("Invalid SVG path parameter");
    return value;
  };
  const current = () => points[points.length - 1];
  const addLine = (nx: number, ny: number) => { x = nx; y = ny; points.push({ x, y }); previousControl = null; };
  const addCubic = (c1: { x: number; y: number }, c2: { x: number; y: number }, end: { x: number; y: number }) => {
    const from = current();
    if (!from) return;
    from.handleOut = { x: c1.x - x, y: c1.y - y };
    x = end.x; y = end.y;
    points.push({ x, y, handleIn: { x: c2.x - x, y: c2.y - y } });
    previousControl = c2;
  };
  try {
    while (index < tokens.length) {
      if (isCommand(tokens[index])) command = tokens[index++];
      if (!command) return null;
      const relative = command === command.toLowerCase();
      const upper = command.toUpperCase();
      const px = (v: number) => relative ? x + v : v;
      const py = (v: number) => relative ? y + v : v;
      if (upper === "Z") {
        closed = true; x = startX; y = startY; command = ""; previousControl = null; previousCommand = upper; continue;
      }
      if (upper === "M") {
        const nx = px(read()), ny = py(read());
        if (points.length) return null; // Multiple subpaths need separate editor objects.
        x = nx; y = ny; startX = x; startY = y; points.push({ x, y });
        command = relative ? "l" : "L"; previousControl = null; previousCommand = upper; continue;
      }
      if (upper === "L") addLine(px(read()), py(read()));
      else if (upper === "H") addLine(px(read()), y);
      else if (upper === "V") addLine(x, py(read()));
      else if (upper === "C") {
        const c1 = { x: px(read()), y: py(read()) };
        const c2 = { x: px(read()), y: py(read()) };
        const end = { x: px(read()), y: py(read()) };
        addCubic(c1, c2, end);
      } else if (upper === "S") {
        const c1 = (previousCommand === "C" || previousCommand === "S") && previousControl
          ? { x: 2 * x - previousControl.x, y: 2 * y - previousControl.y }
          : { x, y };
        const c2 = { x: px(read()), y: py(read()) };
        const end = { x: px(read()), y: py(read()) };
        addCubic(c1, c2, end);
      } else if (upper === "Q" || upper === "T") {
        const q = upper === "Q"
          ? { x: px(read()), y: py(read()) }
          : (previousCommand === "Q" || previousCommand === "T") && previousControl
            ? { x: 2 * x - previousControl.x, y: 2 * y - previousControl.y }
            : { x, y };
        const end = { x: px(read()), y: py(read()) };
        const c1 = { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) };
        const c2 = { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) };
        addCubic(c1, c2, end); previousControl = q;
      } else if (upper === "A") {
        let rx = Math.abs(read()), ry = Math.abs(read());
        const rotation = read() * Math.PI / 180;
        const largeArc = read() !== 0, sweep = read() !== 0;
        const end = { x: px(read()), y: py(read()) };
        // SVG endpoint-to-center arc conversion, then flatten to short editable segments.
        if (rx === 0 || ry === 0 || (end.x === x && end.y === y)) { addLine(end.x, end.y); }
        else {
          const cos = Math.cos(rotation), sin = Math.sin(rotation);
          const dx = (x - end.x) / 2, dy = (y - end.y) / 2;
          const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
          const radiusScale = xp * xp / (rx * rx) + yp * yp / (ry * ry);
          if (radiusScale > 1) { const correction = Math.sqrt(radiusScale); rx *= correction; ry *= correction; }
          const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
          const denominator = Math.max(1e-12, rx * rx * yp * yp + ry * ry * xp * xp);
          const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(numerator / denominator);
          const cxp = factor * rx * yp / ry, cyp = factor * -ry * xp / rx;
          const cx = cos * cxp - sin * cyp + (x + end.x) / 2;
          const cy = sin * cxp + cos * cyp + (y + end.y) / 2;
          const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
          const ux = (xp - cxp) / rx, uy = (yp - cyp) / ry, vx = (-xp - cxp) / rx, vy = (-yp - cyp) / ry;
          let theta = Math.atan2(uy, ux), delta = angle(ux, uy, vx, vy);
          if (!sweep && delta > 0) delta -= 2 * Math.PI;
          if (sweep && delta < 0) delta += 2 * Math.PI;
          const segments = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 18)));
          for (let i = 1; i <= segments; i++) {
            const a = theta + delta * i / segments;
            const nx = cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin;
            const ny = cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos;
            addLine(i === segments ? end.x : nx, i === segments ? end.y : ny);
          }
        }
      } else return null;
      previousCommand = upper;
    }
  } catch { return null; }
  return points.length ? { points, closed } : null;
}

function importSvgMarkup(markup: string, fileName: string): VectorObject[] {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") throw new Error("The selected file is not valid SVG.");
  if (doc.querySelector("script, foreignObject, iframe, object, embed")) throw new Error("This SVG contains active or embedded content and was blocked.");
  const root = doc.documentElement;
  const vb = (root.getAttribute("viewBox") || `0 0 ${Number(root.getAttribute("width")) || 800} ${Number(root.getAttribute("height")) || 480}`).trim().split(/[ ,]+/).map(Number);
  if (vb.length !== 4 || vb.some(value => !Number.isFinite(value)) || vb[2] <= 0 || vb[3] <= 0) throw new Error("SVG has invalid dimensions or viewBox.");
  const [vx, vy, vw, vh] = vb;
  const scale = Math.min(800 / vw, 480 / vh);
  const offsetX = (800 - vw * scale) / 2 - vx * scale;
  const offsetY = (480 - vh * scale) / 2 - vy * scale;
  const result: VectorObject[] = [];
  const nodes = Array.from(root.querySelectorAll("rect,circle,ellipse,text,path"));
  nodes.forEach((node, index) => {
    if (node.closest("defs,clipPath,mask,pattern,marker,symbol") || node.hasAttribute("transform")) return;
    for (const attr of Array.from(node.attributes)) if (/^on/i.test(attr.name) || /javascript:|https?:|data:/i.test(attr.value) && /href/i.test(attr.name)) return;
    const style = node.getAttribute("style") || "";
    const styleValue = (key: string) => style.match(new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`, "i"))?.[1]?.trim();
    const fill = node.getAttribute("fill") || styleValue("fill") || "#000000";
    const stroke = node.getAttribute("stroke") || styleValue("stroke") || "none";
    const strokeWidth = Number(node.getAttribute("stroke-width") || styleValue("stroke-width") || 1);
    const opacity = Number(node.getAttribute("opacity") || styleValue("opacity") || 1);
    const common = { id: `svg-${Date.now()}-${index}`, name: `${fileName.replace(/\.svg$/i, "")} / ${node.localName} ${index + 1}`, fill, rotation: 0, ...(stroke !== "none" ? { stroke, strokeWidth: strokeWidth * scale } : {}) };
    const n = (key: string, fallback = 0) => Number(node.getAttribute(key) || fallback);
    let object: VectorObject | null = null;
    if (node.localName === "rect") {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height"); if (w <= 0 || h <= 0) return;
      object = { ...common, type: "rect", x: x * scale + offsetX, y: y * scale + offsetY, width: w * scale, height: h * scale, fill, cornerRadius: n("rx") * scale };
    } else if (node.localName === "circle" || node.localName === "ellipse") {
      const cx = n("cx"), cy = n("cy"), rx = node.localName === "circle" ? n("r") : n("rx"), ry = node.localName === "circle" ? rx : n("ry"); if (rx <= 0 || ry <= 0) return;
      object = { ...common, type: "ellipse", x: (cx - rx) * scale + offsetX, y: (cy - ry) * scale + offsetY, width: 2 * rx * scale, height: 2 * ry * scale, fill };
    } else if (node.localName === "text") {
      const value = node.textContent?.trim(); if (!value) return;
      const size = n("font-size", 16) * scale;
      object = { ...common, type: "text", x: n("x") * scale + offsetX, y: n("y") * scale + offsetY - size, width: Math.max(40, value.length * size * .6), height: size * 1.3, fill, text: value, fontSize: size };
    } else if (node.localName === "path") {
      const parsed = parseSimpleSvgPath(node.getAttribute("d") || ""); if (!parsed) return;
      const xs = parsed.points.map(point => point.x), ys = parsed.points.map(point => point.y);
      const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
      object = { ...common, type: "path", x: minX * scale + offsetX, y: minY * scale + offsetY, width: Math.max(1, (maxX-minX)*scale), height: Math.max(1, (maxY-minY)*scale), fill: parsed.closed ? fill : "none", points: parsed.points.map(point => ({ x: (point.x-minX)*scale, y: (point.y-minY)*scale })), closed: parsed.closed, ...(stroke !== "none" ? { stroke, strokeWidth: strokeWidth * scale } : {}) };
    }
    if (object && opacity > 0) result.push(object);
  });
  if (!result.length) throw new Error("No supported editable SVG elements were found. Supported: rectangles, circles, ellipses, text, and paths using M/L/H/V/C/S/Q/T/A/Z commands. Multiple path subpaths are not yet supported.");
  return result;
}

function readLocalProject(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem("design-clover-project-v1");
    return raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("design-clover-recent-projects-v1") || "[]") as RecentProject[];
      if (stored.length) return stored;
      const local = readLocalProject();
      if (local && Array.isArray(local.objects)) {
        return [{
          id: `local-${String(local.name || "Untitled Project")}`,
          name: typeof local.name === "string" ? local.name : "Untitled Project",
          updatedAt: new Date().toISOString(),
          snapshot: {
            name: typeof local.name === "string" ? local.name : "Untitled Project",
            objects: local.objects as unknown[],
            keyframes: local.keyframes && typeof local.keyframes === "object" ? local.keyframes as Record<string, unknown[]> : {},
            device: typeof local.device === "string" ? local.device : "desktop"
          }
        }];
      }
      return [];
    } catch { return []; }
  });
  const [mode, setMode] = useState<Mode>("Design");
  const [tool, setTool] = useState<Tool>("select");
  const [objects, setObjects] = useState<VectorObject[]>(() => {
    const saved = readLocalProject();
    return Array.isArray(saved?.objects) ? saved.objects as VectorObject[] : starterObjects;
  });
  const [selected, setSelected] = useState("clover-rect");
  const [selectedIds, setSelectedIds] = useState<string[]>(["clover-rect"]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [easing, setEasing] = useState<Keyframe["easing"]>("ease-in-out");
  const [selectedPreset, setSelectedPreset] = useState<AnimationPreset>("bounce");
  const [zoom, setZoom] = useState(75);
  const [device, setDevice] = useState(() => { const saved = readLocalProject(); return ["desktop", "tablet", "mobile"].includes(String(saved?.device)) ? String(saved?.device) : "desktop"; });
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showCode, setShowCode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [keyframes, setKeyframes] = useState<Record<string, Keyframe[]>>(() => { const saved = readLocalProject(); return saved?.keyframes && typeof saved.keyframes === "object" ? saved.keyframes as Record<string, Keyframe[]> : {}; });
  const [dragging, setDragging] = useState<string | null>(null);
  const [draftPath, setDraftPath] = useState<Point[]>([]);
  const [penDragIndex, setPenDragIndex] = useState<number | null>(null);
  const [pathHandleDrag, setPathHandleDrag] = useState<{ index: number; kind: "in" | "out" } | null>(null);
  const [draggingAnchor, setDraggingAnchor] = useState<number | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<"out" | "in" | null>(null);
  const handleFrameRef = useRef<number | null>(null);
  const [showMotionPath, setShowMotionPath] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showRulers, setShowRulers] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [snapToGuides, setSnapToGuides] = useState(true);
  const [leftWidth, setLeftWidth] = useState(235);
  const [rightWidth, setRightWidth] = useState(260);
  const [projectName, setProjectName] = useState(() => typeof readLocalProject()?.name === "string" ? String(readLocalProject()?.name) : "Untitled Project");
  const [saveStatus, setSaveStatus] = useState("Saved locally");
  const rememberRecentProject = useCallback((snapshot: { name: string; objects: VectorObject[]; keyframes: Record<string, Keyframe[]>; device: string }) => {
    const project: RecentProject = {
      id: `${snapshot.name}-${Date.now()}`,
      name: snapshot.name || "Untitled Project",
      updatedAt: new Date().toISOString(),
      snapshot: { name: snapshot.name || "Untitled Project", objects: snapshot.objects, keyframes: snapshot.keyframes, device: snapshot.device }
    };
    setRecentProjects((current) => {
      const next = [project, ...current.filter((item) => item.name !== project.name)].slice(0, 8);
      try { localStorage.setItem("design-clover-recent-projects-v1", JSON.stringify(next)); } catch { /* Storage may be full. */ }
      return next;
    });
  }, []);

  const startNewProject = () => {
    const freshObjects = starterObjects.map((item) => ({ ...item }));
    setObjects(freshObjects);
    setKeyframes({});
    setDevice("desktop");
    setProjectName("Untitled Project");
    setSelected("clover-rect");
    setSelectedIds(["clover-rect"]);
    setFrame(0);
    setPlaying(false);
    setTool("select");
    setMode("Design");
    setSaveStatus("New project");
    historyRef.current = [freshObjects];
    historyIndexRef.current = 0;
    setHistoryVersion((value) => value + 1);
    rememberRecentProject({ name: "Untitled Project", objects: freshObjects, keyframes: {}, device: "desktop" });
    setShowSplash(false);
  };

  const reopenRecentProject = (project: RecentProject) => {
    const snapshot = project.snapshot;
    if (!snapshot || !Array.isArray(snapshot.objects)) return;
    setObjects(snapshot.objects as VectorObject[]);
    setKeyframes(snapshot.keyframes && typeof snapshot.keyframes === "object" ? snapshot.keyframes as Record<string, Keyframe[]> : {});
    setDevice(["desktop", "tablet", "mobile"].includes(snapshot.device) ? snapshot.device : "desktop");
    setProjectName(snapshot.name || project.name);
    setSelected("");
    setSelectedIds([]);
    setFrame(0);
    setPlaying(false);
    historyRef.current = [snapshot.objects as VectorObject[]];
    historyIndexRef.current = 0;
    setHistoryVersion((value) => value + 1);
    setSaveStatus("Recent project opened");
    setShowSplash(false);
  };

  const [projectInputKey, setProjectInputKey] = useState(0);
  const [svgInputKey, setSvgInputKey] = useState(0);
  const [, setHistoryVersion] = useState(0);
  const historyRef = useRef<VectorObject[][]>([objects]);
  const historyIndexRef = useRef(0);
  const skipHistoryRef = useRef(false);
  const resizePanelRef = useRef<"left" | "right" | null>(null);
  const panDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragSelectionRef = useRef<string[]>([]);
  const dragStartPointRef = useRef({ x: 0, y: 0 });
  const dragOriginsRef = useRef<Record<string, { x: number; y: number }>>({});
  const dragKeyframesRef = useRef<Record<string, Keyframe[]>>({});

  useEffect(() => {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    const history = historyRef.current;
    if (history[historyIndexRef.current] === objects) return;
    const next = history.slice(0, historyIndexRef.current + 1);
    next.push(objects);
    if (next.length > 80) next.shift();
    historyRef.current = next;
    historyIndexRef.current = next.length - 1;
    setHistoryVersion((value) => value + 1);
  }, [objects]);

  useEffect(() => {
    try {
      localStorage.setItem("design-clover-project-v1", JSON.stringify({
        version: 1, name: projectName, objects, keyframes, device
      }));
      setSaveStatus("Saved locally");
    } catch (error) {
      setSaveStatus("Local save unavailable");
    }
  }, [objects, keyframes, device, projectName]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!resizePanelRef.current) return;
      if (resizePanelRef.current === "left") setLeftWidth(Math.max(175, Math.min(360, event.clientX)));
      else setRightWidth(Math.max(190, Math.min(390, window.innerWidth - event.clientX)));
    };
    const stop = () => { resizePanelRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, []);

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    skipHistoryRef.current = true;
    setObjects(historyRef.current[historyIndexRef.current]);
    setHistoryVersion((value) => value + 1);
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    skipHistoryRef.current = true;
    setObjects(historyRef.current[historyIndexRef.current]);
    setHistoryVersion((value) => value + 1);
  };

  const saveProjectFile = () => {
    const contents = serializeProjectFile({ name: projectName, objects, keyframes, device });
    const blob = new Blob([contents], { type: "application/vnd.design-clover.project" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${projectName.trim().replace(/[^a-z0-9-_]+/gi, "-") || "design-clover-project"}.dc`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveStatus("Design Clover file exported");
  };

  const openProjectContents = useCallback((contents: string, fileName: string) => {
    try {
      const parsed = parseProjectFile(contents, fileName);
      setObjects(parsed.objects as VectorObject[]);
      setKeyframes(parsed.keyframes && typeof parsed.keyframes === "object" ? parsed.keyframes as Record<string, Keyframe[]> : {});
      setDevice(["desktop", "tablet", "mobile"].includes(String(parsed.device)) ? String(parsed.device) : "desktop");
      setProjectName(typeof parsed.name === "string" ? parsed.name : "Imported Project");
      setSelected("");
      setSelectedIds([]);
      historyRef.current = [parsed.objects as VectorObject[]];
      historyIndexRef.current = 0;
      setSaveStatus("Project opened");
      rememberRecentProject({
        name: typeof parsed.name === "string" ? parsed.name : "Imported Project",
        objects: parsed.objects as VectorObject[],
        keyframes: parsed.keyframes && typeof parsed.keyframes === "object" ? parsed.keyframes as Record<string, Keyframe[]> : {},
        device: ["desktop", "tablet", "mobile"].includes(String(parsed.device)) ? String(parsed.device) : "desktop"
      });
      setShowSplash(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The file could not be read.";
      window.alert(`Could not open "${fileName}". ${message}`);
    }
  }, [rememberRecentProject]);

  const openProjectFile = (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      openProjectContents(String(reader.result), file.name);
      setProjectInputKey((value) => value + 1);
    };
    reader.onerror = () => {
      window.alert(`Could not read "${file.name}".`);
      setProjectInputKey((value) => value + 1);
    };
    reader.readAsText(file);
  };

  useEffect(() => window.designClover?.onOpenProjectFile((file) => {
    if (file.error) {
      window.alert(`Could not open "${file.fileName}". ${file.error}`);
      return;
    }
    if (file.contents !== undefined) openProjectContents(file.contents, file.fileName);
  }), [openProjectContents]);

  const openSvgFile = (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = importSvgMarkup(String(reader.result || ""), file.name);
        const merged = [...objects, ...imported];
        setObjects(merged);
        setSelected(imported[imported.length - 1].id);
        setSelectedIds([imported[imported.length - 1].id]);
        setTool("select");
        setShowSplash(false);
        setSaveStatus(`Imported ${imported.length} SVG elements`);
        setSvgInputKey(value => value + 1);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not import this SVG file.");
        setSvgInputKey(value => value + 1);
      }
    };
    reader.onerror = () => window.alert("Could not read the selected SVG file.");
    reader.readAsText(file);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo();
      } else if (command && event.key.toLowerCase() === "s") {
        event.preventDefault(); saveProjectFile();
      } else if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault(); deleteSelected();
      } else if (!typing && event.key === "Escape") {
        setDraftPath([]); setTool("select");
      } else if (!typing && (event.key === "+" || event.key === "=")) {
        setZoom((value) => Math.min(200, value + 10));
      } else if (!typing && event.key === "-") {
        setZoom((value) => Math.max(20, value - 10));
      } else if (!typing && event.key === "1") {
        setZoom(100);
      } else if (!typing && event.key.toLowerCase() === "v") setTool("select");
      else if (!typing && event.key.toLowerCase() === "h") setTool("pan");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const selectedObject = objects.find((item) => item.id === selected);

  const filteredObjects = useMemo(
    () => objects.filter((item) =>
      item.name.toLowerCase().includes(search.toLowerCase())
    ),
    [objects, search]
  );

  const selectedKeys = selected ? keyframes[selected] || [] : [];
  const activeSegment = useMemo(
    () => getActiveSegment(selectedKeys, frame),
    [selectedKeys, frame]
  );

  const animatedObjects = useMemo(
    () => objects.map((item) => ({
      ...item,
      animated: getAnimatedTransform(item, frame, keyframes[item.id] || [])
    })),
    [objects, frame, keyframes]
  );

  useEffect(() => {
    if (!playing) return;

    const timer = window.setInterval(() => {
      setFrame((current) => {
        if (current >= 120) {
          setPlaying(false);
          return 120;
        }
        return current + 1;
      });
    }, 1000 / 30);

    return () => window.clearInterval(timer);
  }, [playing]);

  const updateObject = (id: string, patch: Partial<VectorObject>) => {
    setObjects((current) =>
      current.map((item) => item.id === id ? { ...item, ...patch } : item)
    );
  };

  const toggleObjectSelection = (id: string, additive = false) => {
    const item = objects.find((object) => object.id === id);
    if (!item) return;
    if (!additive && item.groupId) {
      const groupMembers = objects.filter((object) => object.groupId === item.groupId).map((object) => object.id);
      setSelectedIds(groupMembers);
      setSelected(id);
      return;
    }
    if (additive) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id];
      setSelectedIds(next);
      setSelected(next[next.length - 1] || "");
    } else {
      setSelected(id);
      setSelectedIds([id]);
    }
  };

  const groupSelected = () => {
    if (selectedIds.length < 2) return;
    const groupId = `group-${Date.now()}`;
    setObjects((current) => current.map((item) =>
      selectedIds.includes(item.id) ? { ...item, groupId } : item
    ));
  };

  const ungroupSelected = () => {
    const groupIds = new Set(objects.filter((item) => selectedIds.includes(item.id) && item.groupId).map((item) => item.groupId));
    if (!groupIds.size) return;
    setObjects((current) => current.map((item) => groupIds.has(item.groupId) ? { ...item, groupId: undefined } : item));
  };

  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    const copies = objects.filter((item) => selectedIds.includes(item.id)).map((item, index) => ({
      ...item,
      id: `${item.type}-${Date.now()}-${index}`,
      name: `${item.name} copy`,
      x: item.x + 24,
      y: item.y + 24,
      groupId: undefined
    }));
    setObjects((current) => [...current, ...copies]);
    setSelected(copies[copies.length - 1]?.id || "");
    setSelectedIds(copies.map((item) => item.id));
  };

  const toggleVisibility = (id: string) => {
    const item = objects.find((object) => object.id === id);
    if (item) updateObject(id, { visible: item.visible === false });
  };

  const toggleLock = (id: string) => {
    const item = objects.find((object) => object.id === id);
    if (item) updateObject(id, { locked: !item.locked });
  };

  const moveLayer = (id: string, direction: "front" | "back") => {
    setObjects((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index < 0) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (direction === "front") next.push(item);
      else next.unshift(item);
      return next;
    });
  };

  const alignSelected = (alignment: "left" | "center" | "right") => {
    const chosen = objects.filter((item) => selectedIds.includes(item.id));
    if (chosen.length < 2) return;
    const left = Math.min(...chosen.map((item) => item.x));
    const right = Math.max(...chosen.map((item) => item.x + item.width));
    const center = (left + right) / 2;
    setObjects((current) => current.map((item) => {
      if (!selectedIds.includes(item.id)) return item;
      const x = alignment === "left" ? left
        : alignment === "right" ? right - item.width
        : center - item.width / 2;
      return { ...item, x };
    }));
  };

  const addObject = (type: VectorType, x = 330, y = 230) => {
    const id = `${type}-${Date.now()}`;
    const count = objects.length + 1;

    const newObject: VectorObject = {
      id,
      name: type === "rect"
        ? `Rectangle ${count}`
        : type === "ellipse"
          ? `Ellipse ${count}`
          : `Text ${count}`,
      type,
      x,
      y,
      width: type === "text" ? 190 : type === "ellipse" ? 80 : 130,
      height: type === "text" ? 42 : type === "ellipse" ? 80 : 85,
      fill: type === "text" ? "#e8eee9" : "#39d98a",
      rotation: 0,
      ...(type === "text" ? { text: "New text", fontSize: 28 } : {})
    };

    setObjects((current) => [...current, newObject]);
    setSelected(id);
    setTool("select");
  };

  const getSvgPoint = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };

    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(800, ((event.clientX - rect.left) / rect.width) * 800)),
      y: Math.max(0, Math.min(480, ((event.clientY - rect.top) / rect.height) * 480))
    };
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = getSvgPoint(event);

    if (tool === "pan") {
      const area = svgRef.current?.closest(".canvas-area") as HTMLDivElement | null;
      if (area) panDragRef.current = { x: event.clientX, y: event.clientY, left: area.scrollLeft, top: area.scrollTop };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === "pen") {
      if (draftPath.length >= 3 && Math.hypot(point.x - draftPath[0].x, point.y - draftPath[0].y) < 14) {
        const xs = draftPath.map(p => p.x), ys = draftPath.map(p => p.y);
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const maxX = Math.max(...xs), maxY = Math.max(...ys);
        const id = `path-${Date.now()}`;
        const localPoints = draftPath.map(p => ({
          x: p.x - minX, y: p.y - minY,
          ...(p.handleIn ? { handleIn: p.handleIn } : {}),
          ...(p.handleOut ? { handleOut: p.handleOut } : {}),
          ...(p.smooth ? { smooth: true } : {})
        }));
        setObjects(current => [...current, { id, name: `Path ${current.length + 1}`, type: "path", x: minX, y: minY, width: Math.max(1, maxX-minX), height: Math.max(1, maxY-minY), fill: "#39d98a", stroke: "#e8eee9", strokeWidth: 2, rotation: 0, points: localPoints, closed: true }]);
        setSelected(id); setSelectedIds([id]); setDraftPath([]); setTool("direct");
      } else {
        setDraftPath(current => [...current, point]);
        setPenDragIndex(draftPath.length);
        svgRef.current?.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (tool === "rect" || tool === "ellipse" || tool === "text") {
      addObject(tool, point.x, point.y);
      return;
    }

    if ((tool === "select" || tool === "direct") && event.target === event.currentTarget) {
      setSelected("");
      setSelectedIds([]);
    }
  };

  const handleObjectPointerDown = (
    event: ReactPointerEvent<SVGElement>,
    item: VectorObject & { animated: AnimatedTransform }
  ) => {
    if (tool === "pan") {
      event.stopPropagation();
      const area = svgRef.current?.closest(".canvas-area") as HTMLDivElement | null;
      if (area) panDragRef.current = { x: event.clientX, y: event.clientY, left: area.scrollLeft, top: area.scrollTop };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    event.stopPropagation();
    if (item.locked) {
      toggleObjectSelection(item.id, event.shiftKey || event.ctrlKey || event.metaKey);
      return;
    }

    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const nextSelection = additive
      ? (selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id])
      : item.groupId
        ? objects.filter((object) => object.groupId === item.groupId).map((object) => object.id)
        : [item.id];

    if (additive) {
      setSelectedIds(nextSelection);
      setSelected(nextSelection.includes(item.id) ? item.id : (nextSelection[nextSelection.length - 1] || ""));
      if (!nextSelection.length) return;
    } else {
      setSelected(item.id);
      setSelectedIds(nextSelection);
    }

    if (tool !== "select") return;

    const point = getSvgPoint(event);
    svgRef.current?.setPointerCapture(event.pointerId);
    setDragging(item.id);
    dragSelectionRef.current = nextSelection;
    dragStartPointRef.current = point;
    dragOriginsRef.current = Object.fromEntries(
      objects.filter((object) => nextSelection.includes(object.id)).map((object) => [object.id, { x: object.x, y: object.y }])
    );
    dragKeyframesRef.current = keyframes;
    dragOffset.current = {
      x: point.x - item.animated.x,
      y: point.y - item.animated.y
    };
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panDragRef.current) {
      const area = svgRef.current?.closest(".canvas-area") as HTMLDivElement | null;
      if (area) {
        area.scrollLeft = panDragRef.current.left - (event.clientX - panDragRef.current.x);
        area.scrollTop = panDragRef.current.top - (event.clientY - panDragRef.current.y);
      }
      return;
    }
    const point = getSvgPoint(event);

    if (penDragIndex !== null && tool === "pen") {
      setDraftPath(current => current.map((p, i) => i === penDragIndex
        ? { ...p, handleOut: { x: point.x - p.x, y: point.y - p.y }, handleIn: { x: p.x - point.x, y: p.y - point.y }, smooth: true }
        : p));
      return;
    }
    if (pathHandleDrag && selected) {
      const item = objects.find(object => object.id === selected);
      if (item?.type === "path" && item.points) {
        const handle = { x: point.x - item.x - item.points[pathHandleDrag.index].x, y: point.y - item.y - item.points[pathHandleDrag.index].y };
        updateObject(item.id, { points: item.points.map((p, i) => i === pathHandleDrag.index
          ? { ...p, [pathHandleDrag.kind === "in" ? "handleIn" : "handleOut"]: handle }
          : p) });
      }
      return;
    }
    if (draggingAnchor !== null && selected) {
      setObjects(current => current.map(item => item.id === selected && item.type === "path" && item.points
        ? { ...item, points: item.points.map((p, i) => i === draggingAnchor ? { x: point.x - item.x, y: point.y - item.y } : p) }
        : item));
      return;
    }
    if (draggingHandle && selected && handleFrameRef.current !== null) {
      const handleType = draggingHandle;
      const targetFrame = handleFrameRef.current;
      setKeyframes((current) => {
        const frames = current[selected] || [];
        const segment = getActiveSegment(frames, targetFrame === frame ? frame : targetFrame);
        if (!segment) return current;
        const keyFrame = handleType === "out" ? segment.start.frame : segment.end.frame;
        const anchor = handleType === "out" ? segment.start : segment.end;
        const updated = frames.map((key) => key.frame === keyFrame
          ? {
              ...key,
              ...(handleType === "out"
                ? { outX: point.x - anchor.x, outY: point.y - anchor.y }
                : { inX: point.x - anchor.x, inY: point.y - anchor.y })
            }
          : key
        );
        return { ...current, [selected]: updated };
      });
      return;
    }

    if (!dragging) return;

    let deltaX = Math.round(point.x - dragStartPointRef.current.x);
    let deltaY = Math.round(point.y - dragStartPointRef.current.y);
    const movingIds = dragSelectionRef.current.length ? dragSelectionRef.current : [dragging];
    if (snapToGuides) {
      const moving = objects.filter((item) => movingIds.includes(item.id));
      if (moving.length) {
        const left = Math.min(...moving.map((item) => item.x));
        const right = Math.max(...moving.map((item) => item.x + item.width));
        const top = Math.min(...moving.map((item) => item.y));
        const bottom = Math.max(...moving.map((item) => item.y + item.height));
        const centerX = (left + right) / 2 + deltaX;
        const centerY = (top + bottom) / 2 + deltaY;
        if (Math.abs(centerX - 400) <= 8) deltaX += 400 - centerX;
        if (Math.abs(centerY - 240) <= 8) deltaY += 240 - centerY;
      }
    }

    setObjects((current) => current.map((item) => {
      if (!movingIds.includes(item.id)) return item;
      const origin = dragOriginsRef.current[item.id] || { x: item.x, y: item.y };
      return { ...item, x: origin.x + deltaX, y: origin.y + deltaY };
    }));

    const animatedMovingIds = movingIds.filter((id) => (keyframes[id] || []).length > 0);
    if (animatedMovingIds.length > 0) {
      setKeyframes((current) => {
        const next = { ...current };
        animatedMovingIds.forEach((id) => {
          const object = objects.find((item) => item.id === id);
          if (!object) return;
          const frames = current[id] || [];
          const originalFrames = dragKeyframesRef.current[id] || [];
          const currentTransform = getAnimatedTransform(object, frame, originalFrames);
          const editedKey: Keyframe = {
            frame,
            x: currentTransform.x + deltaX,
            y: currentTransform.y + deltaY,
            rotation: currentTransform.rotation,
            scale: currentTransform.scale,
            easing
          };
          next[id] = [
            ...frames.filter((key) => key.frame !== frame),
            editedKey
          ].sort((a, b) => a.frame - b.frame);
        });
        return next;
      });
    }
  };

  const handleCanvasPointerUp = () => {
    panDragRef.current = null;
    setPenDragIndex(null);
    setPathHandleDrag(null);
    setDragging(null);
    setDraggingAnchor(null);
    dragSelectionRef.current = [];
    dragOriginsRef.current = {};
    dragKeyframesRef.current = {};
    setDraggingHandle(null);
    handleFrameRef.current = null;
  };

  const startHandleDrag = (
    event: ReactPointerEvent<SVGCircleElement>,
    handle: "out" | "in",
    targetFrame: number
  ) => {
    event.stopPropagation();
    setDraggingHandle(handle);
    handleFrameRef.current = targetFrame;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const deleteSelected = () => {
    if (!selected) return;

    const deleting = new Set(selectedIds.length ? selectedIds : [selected]);
    setObjects((current) => current.filter((item) => !deleting.has(item.id)));
    setKeyframes((current) => {
      const next = { ...current };
      deleting.forEach((id) => delete next[id]);
      return next;
    });
    setSelected("");
    setSelectedIds([]);
  };

  const applyAnimationPreset = () => {
    if (!selectedObject) return;

    const { x, y, rotation } = selectedObject;
    const makeKey = (
      keyFrame: number,
      offsetX = 0,
      offsetY = 0,
      keyRotation = rotation,
      scale = 1,
      keyEasing: Keyframe["easing"] = "ease-in-out"
    ): Keyframe => ({
      frame: keyFrame,
      x: x + offsetX,
      y: y + offsetY,
      rotation: keyRotation,
      scale,
      easing: keyEasing
    });

    let generated: Keyframe[];
    switch (selectedPreset) {
      case "bounce":
        generated = [
          makeKey(0, 0, 0, rotation, 1, "ease-out"),
          makeKey(15, 0, -82, rotation, 1, "ease-in"),
          makeKey(30, 0, 0, rotation, 1, "ease-out"),
          makeKey(45, 0, -48, rotation, 1, "ease-in"),
          makeKey(60, 0, 0, rotation, 1, "ease-out"),
          makeKey(72, 0, -25, rotation, 1, "ease-in"),
          makeKey(84, 0, 0, rotation, 1, "ease-in-out"),
          makeKey(120)
        ];
        break;
      case "drive":
        generated = [
          makeKey(0, 0, 0, rotation, 1, "ease-in-out"),
          makeKey(120, 300, 0, rotation, 1, "ease-in-out")
        ];
        break;
      case "spin":
        generated = [
          makeKey(0, 0, 0, rotation, 1, "linear"),
          makeKey(120, 0, 0, rotation + 360, 1, "linear")
        ];
        break;
      case "pulse":
        generated = [
          makeKey(0, 0, 0, rotation, 1, "ease-in-out"),
          makeKey(30, 0, 0, rotation, 1.22, "ease-in-out"),
          makeKey(60, 0, 0, rotation, 1, "ease-in-out"),
          makeKey(90, 0, 0, rotation, 1.22, "ease-in-out"),
          makeKey(120, 0, 0, rotation, 1, "ease-in-out")
        ];
        break;
      case "slide-in":
        generated = [
          makeKey(0, -260, 0, rotation, 1, "ease-out"),
          makeKey(60, 0, 0, rotation, 1, "ease-in-out"),
          makeKey(120, 0, 0, rotation, 1, "ease-in-out")
        ];
        break;
      case "shake":
        generated = [
          makeKey(0, 0, 0, rotation, 1, "linear"),
          makeKey(10, -12, 0, rotation - 4, 1, "linear"),
          makeKey(20, 12, 0, rotation + 4, 1, "linear"),
          makeKey(30, -10, 0, rotation - 3, 1, "linear"),
          makeKey(40, 10, 0, rotation + 3, 1, "ease-out"),
          makeKey(50, 0, 0, rotation, 1, "ease-in-out"),
          makeKey(120)
        ];
        break;
    }

    setPlaying(false);
    setFrame(0);
    setKeyframes((current) => ({ ...current, [selectedObject.id]: generated }));
    setShowMotionPath(true);
  };

  const addKeyframe = () => {
    if (!selectedObject) return;

    const next: Keyframe = {
      frame,
      x: selectedObject.x,
      y: selectedObject.y,
      rotation: selectedObject.rotation,
      scale: 1,
      easing
    };

    setKeyframes((current) => ({
      ...current,
      [selectedObject.id]: [
        ...(current[selectedObject.id] || []).filter((key) => key.frame !== frame),
        next
      ].sort((a, b) => a.frame - b.frame)
    }));
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    if (next === "Animate") setExpanded(true);
    setShowCode(next === "Code");
  };

  return (
    <>
    {showSplash && (
      <SplashScreen
        version={(window as Window & { designClover?: { version?: string } }).designClover?.version || "1.0.0"}
        recentProjects={recentProjects}
        onNewProject={startNewProject}
        onOpenProject={() => document.getElementById("project-file-input")?.click()}
        onOpenRecent={reopenRecentProject}
        onDismiss={() => setShowSplash(false)}
      />
    )}
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img
            src={`${import.meta.env.BASE_URL}design-clover-logo.svg`}
            alt="Design Clover"
            className="app-logo"
          />
          <span className="brand-name">design<span>clover</span></span>
          <span className="version">BETA</span>
        </div>

        <div className="project-name">
          <input className="project-title-input" value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-label="Project name" />
          <span className="save-status"><Check size={12} /> {saveStatus}</span>
        </div>

        <div className="top-actions">
          <button className="icon-button" title="Undo (Ctrl+Z)" onClick={undo} disabled={historyIndexRef.current <= 0}><Undo2 size={17} /></button>
          <button className="icon-button" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1}><Redo2 size={17} /></button>
          <div className="top-divider" />
          <button className="icon-button" title="Open project" onClick={() => document.getElementById("project-file-input")?.click()}><FolderOpen size={16} /></button>
          <button className="icon-button" title="Save Design Clover project (.dc)" onClick={saveProjectFile}><Save size={16} /></button>
          <input key={projectInputKey} id="project-file-input" type="file" accept=".dc,.json,.clover.json,application/json" hidden onChange={openProjectFile} />
          <input key={svgInputKey} id="svg-file-input" type="file" accept=".svg,image/svg+xml" hidden onChange={openSvgFile} />
          <button className="icon-button" title="Settings"><Settings2 size={17} /></button>
          <button className="share-button"><Upload size={14} /> Export</button>
          <button className="avatar">O</button>
        </div>
      </header>

      <div className="modebar">
        <div className="mode-tabs">
          {([
            ["Design", MousePointer2],
            ["Prototype", Box],
            ["Animate", Film],
            ["Code", Code2]
          ] as const).map(([name, Icon]) => (
            <button
              key={name}
              className={`mode-tab ${mode === name ? "active" : ""}`}
              onClick={() => changeMode(name)}
            >
              <Icon size={15} />{name}
            </button>
          ))}
        </div>

        <div className="modebar-right">
          <span className="canvas-label">WORKSPACE</span>
          <button className="icon-button" onClick={() => setShowLeft(!showLeft)}>
            <PanelLeftClose size={16} />
          </button>
          <button className="icon-button" onClick={() => setShowRight(!showRight)}>
            <PanelRightClose size={16} />
          </button>
          <button className="icon-button" onClick={() => setExpanded(!expanded)}>
            <Maximize2 size={16} />
          </button>
        </div>
      </div>

      <div className="workspace">
        {showLeft && (
          <aside className="left-panel" style={{ width: leftWidth, minWidth: leftWidth }}>
            <div className="panel-heading">
              <span>TOOLS</span>
              <MoreHorizontal size={16} />
            </div>

            <div className="tool-grid">
              {([
                ["select", MousePointer2, "Select"],
                ["direct", Move, "Direct selection"],
                ["pen", Diamond, "Pen tool — click-drag to create curves; click first point to close"],
                ["pan", Hand, "Pan"],
                ["rect", Square, "Rectangle"],
                ["ellipse", Circle, "Ellipse"],
                ["text", Type, "Text"]
              ] as const).map(([value, Icon, label]) => (
                <button
                  key={value}
                  title={label}
                  className={`tool-button ${tool === value ? "tool-active" : ""}`}
                  onClick={() => setTool(value)}
                >
                  <Icon size={17} />
                </button>
              ))}
              <button
                className="tool-button"
                title="Import SVG as editable objects"
                onClick={() => document.getElementById("svg-file-input")?.click()}
              >
                <ImageIcon size={17} />
              </button>
              <button className="tool-button" title="Delete selected" onClick={deleteSelected}>
                <Trash2 size={16} />
              </button>
            </div>

            <div className="panel-section layer-section">
              <div className="section-heading">
                <span><Layers size={14} /> LAYERS</span>
                <button className="small-icon" onClick={() => addObject("rect")}>
                  <Plus size={15} />
                </button>
              </div>

              <div className="vector-action-toolbar">
                <button title="Group selected (Ctrl+G)" onClick={groupSelected} disabled={selectedIds.length < 2}><Group size={13} /></button>
                <button title="Ungroup selected" onClick={ungroupSelected}><Ungroup size={13} /></button>
                <button title="Duplicate selected" onClick={duplicateSelected} disabled={!selectedIds.length}><Copy size={13} /></button>
                <button title="Bring selected to front" onClick={() => selected && moveLayer(selected, "front")} disabled={!selected}><BringToFront size={13} /></button>
                <button title="Send selected to back" onClick={() => selected && moveLayer(selected, "back")} disabled={!selected}><SendToBack size={13} /></button>
              </div>

              <div className="align-toolbar">
                <span>ALIGN</span>
                <button title="Align left" onClick={() => alignSelected("left")} disabled={selectedIds.length < 2}><AlignLeft size={13} /></button>
                <button title="Align horizontal center" onClick={() => alignSelected("center")} disabled={selectedIds.length < 2}><AlignCenter size={13} /></button>
                <button title="Align right" onClick={() => alignSelected("right")} disabled={selectedIds.length < 2}><AlignRight size={13} /></button>
              </div>

              <div className="layer-search">
                <Search size={13} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search layers..."
                />
              </div>

              <div className="layer-list">
                {filteredObjects.map((item) => (
                  <div
                    key={item.id}
                    className={`layer-row ${selectedIds.includes(item.id) ? "selected" : ""} ${item.visible === false ? "layer-hidden" : ""}`}
                  >
                    <button
                      className="layer-item"
                      onClick={(event) => toggleObjectSelection(item.id, event.shiftKey || event.ctrlKey || event.metaKey)}
                      title="Click to select; Shift/Ctrl-click to add or remove from selection"
                    >
                      {item.type === "text" ? <Type size={14} /> : item.type === "ellipse" ? <Circle size={14} /> : item.type === "path" ? <Diamond size={14} /> : <Square size={14} />}
                      <span>{item.groupId ? "▧ " : ""}{item.name}</span>
                    </button>
                    <button className="layer-mini-action" title={item.visible === false ? "Show layer" : "Hide layer"} onClick={() => toggleVisibility(item.id)}>
                      {item.visible === false ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button className="layer-mini-action" title={item.locked ? "Unlock layer" : "Lock layer"} onClick={() => toggleLock(item.id)}>
                      {item.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                  </div>
                ))}
                {filteredObjects.length === 0 && (
                  <div className="empty-layers">No matching layers</div>
                )}
              </div>
            </div>

            <div className="left-bottom">
              <button><Box size={15} /> Assets <ChevronRight size={14} /></button>
              <button><Palette size={15} /> Libraries <ChevronRight size={14} /></button>
            </div>
          </aside>
        )}
        {showLeft && <div className="panel-resize-handle" title="Drag to resize left panel" onPointerDown={() => { resizePanelRef.current = "left"; }} />}

        <section className="center-workspace">
          <div className="canvas-toolbar">
            <div className="breadcrumb">
              <span>Pages</span><ChevronRight size={13} />
              <strong>Home Page</strong><span className="page-dot" />
            </div>

            <div className="canvas-controls">
              <button className="icon-button" onClick={undo} title="Undo (Ctrl+Z)" disabled={historyIndexRef.current <= 0}><Undo2 size={15} /></button>
              <button className="icon-button" onClick={redo} title="Redo (Ctrl+Shift+Z)" disabled={historyIndexRef.current >= historyRef.current.length - 1}><Redo2 size={15} /></button>
              <div className="top-divider" />
              <button
                className={`icon-button ${showGrid ? "tool-active" : ""}`}
                onClick={() => setShowGrid(!showGrid)}
                title="Toggle grid"
              >
                <Grid3X3 size={15} />
              </button>
              <button className={`icon-button ${showRulers ? "tool-active" : ""}`} onClick={() => setShowRulers(!showRulers)} title="Toggle rulers"><Ruler size={15} /></button>
              <button className={`icon-button ${showGuides ? "tool-active" : ""}`} onClick={() => { setShowGuides(!showGuides); setSnapToGuides(!snapToGuides); }} title="Toggle center guides and snapping"><Magnet size={15} /></button>
              <button className="zoom-button" onClick={() => setZoom(Math.min(200, zoom + 10))}>
                {zoom}% <ChevronDown size={12} />
              </button>
            </div>
          </div>

          <div className={`canvas-area ${tool === "pan" ? "pan-mode" : ""}`}>
            {showRulers && <><div className="canvas-ruler horizontal-ruler">{Array.from({ length: 17 }, (_, i) => <span key={i}>{i * 50}</span>)}</div><div className="canvas-ruler vertical-ruler">{Array.from({ length: 11 }, (_, i) => <span key={i}>{i * 50}</span>)}</div></>}
            <div className={`artboard ${device}`} style={{ transform: `scale(${zoom / 100})` }}>
              {showGuides && <div className="alignment-guides" aria-hidden="true"><span /><span /></div>}
              <div className="website-nav">
                <div className="mini-brand">
                  <div className="mini-clover">✿</div>
                  <span>clover<span>studio</span></span>
                </div>
                <div className="website-links">
                  <span>Features</span><span>Showcase</span><span>About</span>
                </div>
                <button className="website-nav-button">Get started ↗</button>
              </div>

              <div className="hero-content">
                <div className="hero-tag"><span /> CREATIVE DEVELOPMENT STUDIO</div>
                <h1>Ideas into<br /><span>experiences.</span></h1>
                <p>Design, animate and build beautiful digital<br />experiences — all in one creative workspace.</p>
                <div className="hero-buttons">
                  <button>Explore workspace <span>↗</span></button>
                  <button className="hero-secondary">Watch preview <Play size={12} /></button>
                </div>
              </div>

              <div className="floating-card">
                <div className="card-top">
                  <span className="live-dot" /> LIVE PREVIEW <MoreHorizontal size={15} />
                </div>
                <div className="card-graphic">
                  <div className="graphic-circle circle-one" />
                  <div className="graphic-circle circle-two" />
                  <div className="graphic-center">✳</div>
                </div>
                <div className="card-footer">
                  <div><strong>Creative flow</strong><span>Animation enabled</span></div>
                  <div className="card-arrow">↗</div>
                </div>
              </div>

              <div className="artboard-footer">
                <span>DESIGN CLOVER / 001</span>
                <span>MADE FOR CREATORS <span className="footer-star">✳</span></span>
              </div>

              <svg
                ref={svgRef}
                className={`vector-canvas ${showGrid ? "with-grid" : ""}`}
                viewBox="0 0 800 480"
                preserveAspectRatio="none"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
              >
                {animatedObjects.filter((item) => item.visible !== false).map((item) => (
                  <g
                    key={item.id}
                    transform={`translate(${item.animated.x - item.x} ${item.animated.y - item.y}) translate(${item.x + item.width / 2} ${item.y + item.height / 2}) rotate(${item.animated.rotation}) scale(${item.animated.scale}) translate(${-item.x - item.width / 2} ${-item.y - item.height / 2})`}
                  >
                    {item.type === "path" && item.points && (
                      <path
                        d={buildVectorPath(item.points, item.x, item.y, item.closed)}
                        fill={item.closed ? item.fill : "none"}
                        fillOpacity={0.88}
                        stroke={item.stroke || "#e8eee9"}
                        strokeWidth={item.strokeWidth ?? 2}
                        strokeLinejoin={item.strokeLinejoin || "round"}
                        strokeLinecap={item.strokeLinecap || "round"}
                        strokeDasharray={item.strokeDasharray || undefined}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          if (tool === "direct") { setSelected(item.id); setSelectedIds([item.id]); return; }
                          handleObjectPointerDown(event, item);
                        }}
                        style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                      />
                    )}
                    {item.type === "rect" && (
                      <rect
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        rx={item.cornerRadius ?? 5}
                        fill={item.fill}
                        fillOpacity={0.88}
                        stroke={selected === item.id ? "#ffffff" : "transparent"}
                        strokeWidth={selected === item.id ? 1.5 : 0}
                        onPointerDown={(event) => handleObjectPointerDown(event, item)}
                        style={{ cursor: item.locked ? "not-allowed" : tool === "select" ? "move" : "crosshair" }}
                      />
                    )}

                    {item.type === "ellipse" && (
                      <ellipse
                        cx={item.x + item.width / 2}
                        cy={item.y + item.height / 2}
                        rx={item.width / 2}
                        ry={item.height / 2}
                        fill={item.fill}
                        stroke={selected === item.id ? "#ffffff" : "transparent"}
                        strokeWidth={selected === item.id ? 1.5 : 0}
                        onPointerDown={(event) => handleObjectPointerDown(event, item)}
                        style={{ cursor: item.locked ? "not-allowed" : tool === "select" ? "move" : "crosshair" }}
                      />
                    )}

                    {item.type === "text" && (
                      <text
                        x={item.x}
                        y={item.y + (item.fontSize || 28)}
                        fontSize={item.fontSize || 28}
                        fill={item.fill}
                        onPointerDown={(event) => handleObjectPointerDown(event, item)}
                        style={{ cursor: item.locked ? "not-allowed" : tool === "select" ? "move" : "crosshair", userSelect: "none" }}
                      >
                        {item.text || "Text"}
                      </text>
                    )}

                    {selected === item.id && item.type === "path" && item.points && tool === "direct" && item.points.map((p, index) => (
                      <g key={`anchor-${index}`}>
                        {p.handleIn && <><line x1={item.x + p.x} y1={item.y + p.y} x2={item.x + p.x + p.handleIn.x} y2={item.y + p.y + p.handleIn.y} className="vector-bezier-line" /><circle cx={item.x + p.x + p.handleIn.x} cy={item.y + p.y + p.handleIn.y} r="4" className="vector-bezier-handle" onPointerDown={(event) => { event.stopPropagation(); setPathHandleDrag({ index, kind: "in" }); svgRef.current?.setPointerCapture(event.pointerId); }} /></>}
                        {p.handleOut && <><line x1={item.x + p.x} y1={item.y + p.y} x2={item.x + p.x + p.handleOut.x} y2={item.y + p.y + p.handleOut.y} className="vector-bezier-line" /><circle cx={item.x + p.x + p.handleOut.x} cy={item.y + p.y + p.handleOut.y} r="4" className="vector-bezier-handle" onPointerDown={(event) => { event.stopPropagation(); setPathHandleDrag({ index, kind: "out" }); svgRef.current?.setPointerCapture(event.pointerId); }} /></>}
                        <circle cx={item.x + p.x} cy={item.y + p.y} r="5" fill={p.smooth ? "#39d98a" : "#ffffff"} stroke="#39d98a" strokeWidth="2" style={{ cursor: "move" }} onPointerDown={(event) => { event.stopPropagation(); setDraggingAnchor(index); svgRef.current?.setPointerCapture(event.pointerId); }} />
                      </g>
                    ))}
                    {selected === item.id && (
                      <rect
                        className="vector-selection"
                        x={item.x - 4}
                        y={item.y - 4}
                        width={item.width + 8}
                        height={item.height + 8}
                        fill="none"
                        stroke="#39d98a"
                        strokeWidth="1"
                        strokeDasharray="4 3"
                        pointerEvents="none"
                      />
                    )}
                  </g>
                ))}

                {draftPath.length > 0 && <g pointerEvents="none"><path d={buildVectorPath(draftPath, 0, 0, false)} fill="none" stroke="#39d98a" strokeWidth="2" strokeDasharray="5 4" />{draftPath.map((p,i)=><g key={i}>{p.handleOut && <><line x1={p.x} y1={p.y} x2={p.x+p.handleOut.x} y2={p.y+p.handleOut.y} className="vector-bezier-line" /><circle cx={p.x+p.handleOut.x} cy={p.y+p.handleOut.y} r="4" className="vector-bezier-handle" /></>}<circle cx={p.x} cy={p.y} r="4" fill={p.smooth ? "#39d98a" : "#ffffff"} stroke="#39d98a" /></g>)}</g>}
                {showMotionPath && selectedKeys.length >= 2 && (
                  <g className="motion-path-overlay">
                    <path
                      d={getMotionPath(selectedKeys)}
                      className="motion-path-line"
                      fill="none"
                      pointerEvents="none"
                    />
                    {selectedKeys.map((key) => (
                      <circle
                        key={`path-point-${key.frame}`}
                        cx={key.x}
                        cy={key.y}
                        r="3"
                        className="motion-path-point"
                        pointerEvents="none"
                      />
                    ))}
                    {activeSegment && (() => {
                      const { start, end } = activeSegment;
                      const { p1, p2 } = getSegmentControls(start, end);
                      return (
                        <g className="bezier-handles">
                          <line x1={start.x} y1={start.y} x2={p1.x} y2={p1.y} className="bezier-handle-line" />
                          <line x1={end.x} y1={end.y} x2={p2.x} y2={p2.y} className="bezier-handle-line" />
                          <circle
                            cx={p1.x}
                            cy={p1.y}
                            r="6"
                            className="bezier-handle"
                            onPointerDown={(event) => startHandleDrag(event, "out", start.frame)}
                          />
                          <circle
                            cx={p2.x}
                            cy={p2.y}
                            r="6"
                            className="bezier-handle"
                            onPointerDown={(event) => startHandleDrag(event, "in", end.frame)}
                          />
                        </g>
                      );
                    })()}
                  </g>
                )}
              </svg>
            </div>

            <div className="canvas-floating-tools">
              <button
                className={`icon-button ${tool === "select" ? "tool-active" : ""}`}
                onClick={() => setTool("select")}
              >
                <MousePointer2 size={15} />
              </button>
              <button
                className={`icon-button ${tool === "pan" ? "tool-active" : ""}`}
                onClick={() => setTool("pan")}
                title="Pan tool (use drag on the canvas)"
              >
                <Hand size={15} />
              </button>
              <div className="floating-divider" />
              <button className="icon-button" onClick={() => setZoom(Math.max(20, zoom - 10))}>
                <Minus size={15} />
              </button>
              <button className="icon-button" onClick={() => setZoom(Math.min(200, zoom + 10))}>
                <Plus size={15} />
              </button>
            </div>
          </div>

          {showCode && (
            <div className="code-drawer">
              <div className="code-header">
                <span><Code2 size={14} /> VECTOR OBJECT DATA</span>
                <button onClick={() => setShowCode(false)}><X size={15} /></button>
              </div>
              <pre><code>{JSON.stringify(objects, null, 2)}</code></pre>
            </div>
          )}

          <div className={`timeline-panel ${expanded ? "expanded" : ""}`}>
            <div className="timeline-header">
              <div className="timeline-title">
                <Film size={15} />
                <strong>Animation Timeline</strong>
                <span className="timeline-subtitle">Scene 01</span>
              </div>
              <div className="timeline-actions">
                <button className="icon-button" onClick={() => { setFrame(0); setPlaying(false); }}>
                  <SkipBack size={15} />
                </button>
                <button className="play-button" onClick={() => setPlaying(!playing)}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button className="icon-button" onClick={() => setFrame(Math.min(120, frame + 1))}>
                  <SkipForward size={15} />
                </button>
                <span className="frame-counter">{String(frame).padStart(3, "0")} / 120</span>
                <button className="icon-button" onClick={() => setExpanded(!expanded)}>
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>

            <div className="timeline-body">
              <div className="timeline-tracks">
                <div className="track-labels">
                  <div className="track-label"><Eye size={13} /> {selectedObject?.name || "No selection"}</div>
                  <div className="track-label"><Move size={13} /> Position X/Y</div>
                  <div className="track-label"><RotateCw size={13} /> Rotation</div>
                  <div className="track-label"><Diamond size={13} /> Scale</div>
                </div>

                <div className="track-area">
                  <div className="timeline-ruler">
                    {Array.from({ length: 7 }, (_, index) => (
                      <span key={index}>{index * 20}f</span>
                    ))}
                  </div>
                  {[0, 1, 2, 3].map((track) => (
                    <div className="track-row" key={track}>
                      {selectedKeys.map((key) => (
                        <button
                          key={`${track}-${key.frame}`}
                          className={`keyframe ${key.frame === frame ? "key-active" : ""}`}
                          style={{ left: `${(key.frame / 120) * 100}%` }}
                          title={`Keyframe ${key.frame}`}
                          onClick={() => setFrame(key.frame)}
                        />
                      ))}
                    </div>
                  ))}
                  <div className="playhead" style={{ left: `${(frame / 120) * 100}%` }} />
                </div>
              </div>
            </div>

            <div className="timeline-footer">
              <span><Clock size={12} /> 30 FPS</span>
              <span>Duration: 4.0s</span>
              <button onClick={addKeyframe} disabled={!selectedObject}>
                <Diamond size={13} /> Add keyframe
              </button>
              <button onClick={() => setExpanded(!expanded)}>
                {expanded ? "Collapse studio" : "Expand studio"} <Maximize2 size={12} />
              </button>
            </div>
          </div>
        </section>

        {showRight && <div className="panel-resize-handle" title="Drag to resize inspector" onPointerDown={() => { resizePanelRef.current = "right"; }} />}
        {showRight && (
          <aside className="right-panel" style={{ width: rightWidth, minWidth: rightWidth }}>
            <div className="panel-heading">
              <span>INSPECTOR</span>
              <MoreHorizontal size={16} />
            </div>

            <div className="inspector-tabs">
              <button className="active">Design</button>
              <button>Prototype</button>
            </div>

            <div className="inspector-content">
              <div className="inspector-object">
                <div className="object-icon"><Square size={16} /></div>
                <div>
                  <strong>{selectedObject?.name || "Nothing selected"}</strong>
                  <span>{selectedObject ? `${selectedObject.type} object` : "Select an object"}</span>
                </div>
                <button className="small-icon" onClick={deleteSelected} disabled={!selectedObject}>
                  <Trash2 size={15} />
                </button>
              </div>

              {selectedIds.length > 1 && (
                <div className="selection-count">{selectedIds.length} objects selected · drag to move together</div>
              )}

              {selectedObject ? (
                <>
                  <div className="vector-inspector-actions">
                    <button onClick={groupSelected} disabled={selectedIds.length < 2}><Group size={13} /> Group</button>
                    <button onClick={ungroupSelected}><Ungroup size={13} /> Ungroup</button>
                    <button onClick={duplicateSelected}><Copy size={13} /> Duplicate</button>
                  </div>

                  <div className="property-section">
                    <div className="property-title">OBJECT <ChevronDown size={13} /></div>
                    <div className="property-grid">
                      <label>
                        Name
                        <input
                          value={selectedObject.name}
                          onChange={(event) => updateObject(selectedObject.id, { name: event.target.value })}
                        />
                      </label>
                      {selectedObject.type === "text" && (
                        <label>
                          Text
                          <input
                            value={selectedObject.text || ""}
                            onChange={(event) => updateObject(selectedObject.id, { text: event.target.value })}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="property-section">
                    <div className="property-title">POSITION & SIZE <ChevronDown size={13} /></div>
                    <div className="property-grid">
                      <label>
                        X
                        <input
                          type="number"
                          value={Math.round(selectedObject.x)}
                          onChange={(event) => updateObject(selectedObject.id, { x: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        Y
                        <input
                          type="number"
                          value={Math.round(selectedObject.y)}
                          onChange={(event) => updateObject(selectedObject.id, { y: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                    <div className="property-grid">
                      <label>
                        W
                        <input
                          type="number"
                          min="1"
                          value={Math.round(selectedObject.width)}
                          onChange={(event) => updateObject(selectedObject.id, { width: Math.max(1, Number(event.target.value)) })}
                        />
                      </label>
                      <label>
                        H
                        <input
                          type="number"
                          min="1"
                          value={Math.round(selectedObject.height)}
                          onChange={(event) => updateObject(selectedObject.id, { height: Math.max(1, Number(event.target.value)) })}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="property-section">
                    <div className="property-title">APPEARANCE <ChevronDown size={13} /></div>
                    <label className="color-control">
                      <span>Fill color</span>
                      <div className="color-input">
                        <input type="color" value={selectedObject.fill} onChange={(event) => updateObject(selectedObject.id, { fill: event.target.value })} />
                        <span>{selectedObject.fill.toUpperCase()}</span>
                      </div>
                    </label>
                    <label className="color-control"><span>Stroke color</span><div className="color-input"><input type="color" value={selectedObject.stroke || "#e8eee9"} onChange={(event) => updateObject(selectedObject.id, { stroke: event.target.value })} /><span>{(selectedObject.stroke || "#e8eee9").toUpperCase()}</span></div></label>
                    <div className="property-grid"><label>Stroke width<input type="number" min="0" max="30" step="0.5" value={selectedObject.strokeWidth ?? 0} onChange={(event) => updateObject(selectedObject.id, { strokeWidth: Math.max(0, Number(event.target.value)) })} /></label>{selectedObject.type === "rect" && <label>Corner radius<input type="number" min="0" max="100" value={selectedObject.cornerRadius ?? 5} onChange={(event) => updateObject(selectedObject.id, { cornerRadius: Math.max(0, Number(event.target.value)) })} /></label>}</div>
                    <div className="property-grid">
                      <label>Dash pattern<select value={selectedObject.strokeDasharray || "solid"} onChange={(event) => updateObject(selectedObject.id, { strokeDasharray: event.target.value === "solid" ? "" : event.target.value })}><option value="solid">Solid</option><option value="8 5">Dashed</option><option value="2 5">Dotted</option><option value="12 4 2 4">Dash-dot</option></select></label>
                      <label>Line cap<select value={selectedObject.strokeLinecap || "round"} onChange={(event) => updateObject(selectedObject.id, { strokeLinecap: event.target.value as VectorObject["strokeLinecap"] })}><option value="butt">Butt</option><option value="round">Round</option><option value="square">Square</option></select></label>
                      <label>Line join<select value={selectedObject.strokeLinejoin || "round"} onChange={(event) => updateObject(selectedObject.id, { strokeLinejoin: event.target.value as VectorObject["strokeLinejoin"] })}><option value="miter">Miter</option><option value="round">Round</option><option value="bevel">Bevel</option></select></label>
                    </div>
                  </div>

                  <div className="property-section">
                    <div className="property-title">TRANSFORM <ChevronDown size={13} /></div>
                    <div className="property-grid">
                      <label>
                        Rotation
                        <input
                          type="number"
                          value={selectedObject.rotation}
                          onChange={(event) => updateObject(selectedObject.id, { rotation: Number(event.target.value) })}
                        />
                      </label>
                      {selectedObject.type === "text" && (
                        <label>
                          Font size
                          <input
                            type="number"
                            min="6"
                            value={selectedObject.fontSize || 28}
                            onChange={(event) => updateObject(selectedObject.id, { fontSize: Math.max(6, Number(event.target.value)) })}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="property-section">
                    <div className="property-title">ANIMATION <ChevronDown size={13} /></div>
                    <div className="animation-card">
                      <div className="animation-icon"><Zap size={15} /></div>
                      <div>
                        <strong>Motion settings</strong>
                        <span>{selectedKeys.length} keyframes · interpolated motion</span>
                      </div>
                      <ChevronRight size={15} />
                    </div>
                    <div className="preset-library">
                      <div className="preset-library-heading">
                        <strong>MOTION PRESETS</strong>
                        <span>Apply to selected object</span>
                      </div>
                      <select
                        className="preset-select"
                        value={selectedPreset}
                        onChange={(event) => setSelectedPreset(event.target.value as AnimationPreset)}
                      >
                        <option value="bounce">Bouncing ball</option>
                        <option value="drive">Drive / move right</option>
                        <option value="spin">Full rotation</option>
                        <option value="pulse">Pulse / scale</option>
                        <option value="slide-in">Slide in from left</option>
                        <option value="shake">Shake</option>
                      </select>
                      <button
                        className="apply-preset-button"
                        onClick={applyAnimationPreset}
                        disabled={!selectedObject}
                      >
                        <Sparkles size={13} /> Apply preset
                      </button>
                      <p>Applying a preset replaces the selected object's current keyframes.</p>
                    </div>

                    <label className="easing-control">
                      <span>Interpolation</span>
                      <select value={easing} onChange={(event) => setEasing(event.target.value as Keyframe["easing"])}>
                        <option value="linear">Linear</option>
                        <option value="ease-in">Ease in</option>
                        <option value="ease-out">Ease out</option>
                        <option value="ease-in-out">Ease in-out</option>
                      </select>
                    </label>

                    <div className="motion-path-controls">
                      <label className="motion-path-toggle">
                        <input
                          type="checkbox"
                          checked={showMotionPath}
                          onChange={(event) => setShowMotionPath(event.target.checked)}
                        />
                        Show motion path
                      </label>
                      <span>{selectedKeys.length >= 2 ? "Drag the round handles on the canvas" : "Add two keyframes to create a path"}</span>
                    </div>

                    <div className="graph-editor">
                      <div className="graph-editor-heading">
                        <div>
                          <strong>GRAPH EDITOR</strong>
                          <span>Timing curve · all animated transforms</span>
                        </div>
                      </div>
                      <svg className="curve-graph" viewBox="0 0 240 116" role="img" aria-label={`${easing} animation curve`}>
                        <path className="curve-grid" d="M20 10V96H230 M20 53H230 M72 10V96 M125 10V96 M177 10V96" />
                        <path className="curve-diagonal" d="M20 96L230 10" />
                        <path
                          className="curve-line"
                          d={easing === "linear"
                            ? "M20 96L230 10"
                            : easing === "ease-in"
                              ? "M20 96 C20 96 190 10 230 10"
                              : easing === "ease-out"
                                ? "M20 96 C60 10 230 96 230 10"
                                : "M20 96 C85 96 165 10 230 10"}
                        />
                        <circle className="curve-start" cx="20" cy="96" r="3.5" />
                        <circle className="curve-end" cx="230" cy="10" r="3.5" />
                      </svg>
                      <div className="curve-presets">
                        {(["linear", "ease-in", "ease-out", "ease-in-out"] as const).map((preset) => (
                          <button
                            key={preset}
                            className={easing === preset ? "selected" : ""}
                            onClick={() => setEasing(preset)}
                          >
                            {preset === "linear" ? "Linear" : preset === "ease-in" ? "Ease In" : preset === "ease-out" ? "Ease Out" : "Ease In-Out"}
                          </button>
                        ))}
                      </div>
                      <p className="graph-editor-note">A keyframe’s easing controls the motion from that keyframe to the next.</p>
                    </div>

                    <button className="add-keyframe" onClick={addKeyframe}>
                      <Diamond size={13} /> Add keyframe at {frame}f
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-inspector">Select a vector object to edit its properties.</div>
              )}

              <div className="property-section">
                <div className="property-title">RESPONSIVE PREVIEW <ChevronDown size={13} /></div>
                <div className="device-selector">
                  <button className={device === "desktop" ? "active" : ""} onClick={() => setDevice("desktop")}>
                    <Monitor size={16} />
                  </button>
                  <button className={device === "tablet" ? "active" : ""} onClick={() => setDevice("tablet")}>
                    <Tablet size={16} />
                  </button>
                  <button className={device === "mobile" ? "active" : ""} onClick={() => setDevice("mobile")}>
                    <Smartphone size={16} />
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <div><span className="status-dot" /> {saveStatus}</div>
        <div>
          <span>Design Clover Beta</span><span>·</span>
          <span>Windows Desktop</span><span>·</span><span>{zoom}%</span>
        </div>
        <div><Sparkles size={13} /> Ctrl+Z Undo · Ctrl+S Save · H Pan · V Select</div>
      </footer>
    </main>
    </>
  );
}

export default App;
