import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ChangeEvent as ReactChangeEvent } from "react";
import {
  MousePointer2, Hand, Square, Circle, Type, Image as ImageIcon,
  Layers, Code2, Play, Pause, SkipBack, SkipForward, ChevronDown,
  ChevronRight, Plus, Minus, Settings2, Monitor, Smartphone, Tablet,
  Grid3X3, Undo2, Redo2, Upload, Eye, MoreHorizontal, Search, Move,
  RotateCw, Maximize2, PanelLeftClose, PanelRightClose, Sparkles,
  Film, Clock, Zap, Palette, Box, Diamond, Check, Trash2,
  Copy, Lock, Unlock, EyeOff, Group, Ungroup, AlignLeft, AlignCenter,
  AlignRight, BringToFront, SendToBack, Save, FolderOpen, Ruler, Magnet
} from "lucide-react";
import "./App.css";
import SplashScreen, { type RecentProject } from "./SplashScreen";
import { parseProjectFile, serializeProjectFile } from "./project-file";
import type { Point, VectorObject } from "./editor-types";
import { importSvg } from "./importers/svg/importSvg";
import PdfImportDialog from "./importers/pdf/PdfImportDialog";
import { isIllustratorFile } from "./importers/illustrator";
import { MAX_IMPORT_BYTES } from "./importers/import-types";
import type { ImportResult } from "./importers/import-types";
import DesignToolsPanel, { type DesignToolsTab } from "./ui/DesignToolsPanel";
import CodeModePanel from "./ui/CodeModePanel";
import { DEFAULT_DESIGN_SETTINGS, normalizeDesignSettings, type DesignDocumentSettings, type StructureNode } from "./design-document";
import { reconcileStructure, updateStructureNode } from "./structure/detectStructure";
import { createComponentDefinition, instantiateComponent, syncComponentInstances } from "./components/componentModel";
import { applyToken, detectTokens, updateToken } from "./design-tokens/tokenModel";
import { getResponsiveFrame, resolveResponsiveObjects, validateResponsiveLayout, type Device } from "./responsive/layoutEngine";
import { generateWebsite } from "./code-generation/generateWebsite";

type Mode = "Design" | "Prototype" | "Animate" | "Code";
type Tool = "select" | "direct" | "pen" | "pan" | "rect" | "ellipse" | "text";
type AnimationPreset = "bounce" | "drive" | "spin" | "pulse" | "slide-in" | "shake";

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
  const [pdfImportFile, setPdfImportFile] = useState<File | null>(null);
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
            device: typeof local.device === "string" ? local.device : "desktop",
            designSettings: local.designSettings
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
  const [device, setDevice] = useState<Device>(() => {
    const saved = readLocalProject();
    return saved?.device === "mobile" || saved?.device === "tablet" ? saved.device : "desktop";
  });
  const [designSettings, setDesignSettings] = useState(() => normalizeDesignSettings(readLocalProject()?.designSettings));
  const [designToolsTab, setDesignToolsTab] = useState<DesignToolsTab>("layers");
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
  const rememberRecentProject = useCallback((snapshot: { name: string; objects: VectorObject[]; keyframes: Record<string, Keyframe[]>; device: string; designSettings?: DesignDocumentSettings }) => {
    const project: RecentProject = {
      id: `${snapshot.name}-${Date.now()}`,
      name: snapshot.name || "Untitled Project",
      updatedAt: new Date().toISOString(),
      snapshot: { name: snapshot.name || "Untitled Project", objects: snapshot.objects, keyframes: snapshot.keyframes, device: snapshot.device, designSettings: snapshot.designSettings }
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
    setDesignSettings(DEFAULT_DESIGN_SETTINGS);
    setProjectName("Untitled Project");
    setSelected("clover-rect");
    setSelectedIds(["clover-rect"]);
    setFrame(0);
    setPlaying(false);
    setTool("select");
    setMode("Design");
    setSaveStatus("New project");
    resetHistory(freshObjects, DEFAULT_DESIGN_SETTINGS);
    setHistoryVersion((value) => value + 1);
    rememberRecentProject({ name: "Untitled Project", objects: freshObjects, keyframes: {}, device: "desktop", designSettings: DEFAULT_DESIGN_SETTINGS });
    setShowSplash(false);
  };

  const reopenRecentProject = (project: RecentProject) => {
    const snapshot = project.snapshot;
    if (!snapshot || !Array.isArray(snapshot.objects)) return;
    setObjects(snapshot.objects as VectorObject[]);
    setKeyframes(snapshot.keyframes && typeof snapshot.keyframes === "object" ? snapshot.keyframes as Record<string, Keyframe[]> : {});
    setDevice(snapshot.device === "tablet" || snapshot.device === "mobile" ? snapshot.device : "desktop");
    const restoredSettings = normalizeDesignSettings(snapshot.designSettings);
    setDesignSettings(restoredSettings);
    setProjectName(snapshot.name || project.name);
    setSelected("");
    setSelectedIds([]);
    setFrame(0);
    setPlaying(false);
    resetHistory(snapshot.objects as VectorObject[], restoredSettings);
    setHistoryVersion((value) => value + 1);
    setSaveStatus("Recent project opened");
    setShowSplash(false);
  };

  const [projectInputKey, setProjectInputKey] = useState(0);
  const [svgInputKey, setSvgInputKey] = useState(0);
  const [, setHistoryVersion] = useState(0);
  const historyRef = useRef<Array<{ objects: VectorObject[]; designSettings: DesignDocumentSettings }>>([{ objects, designSettings }]);
  const historyIndexRef = useRef(0);
  const skipHistoryRef = useRef(false);
  const resizePanelRef = useRef<"left" | "right" | null>(null);
  const panDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragSelectionRef = useRef<string[]>([]);
  const dragStartPointRef = useRef({ x: 0, y: 0 });
  const dragOriginsRef = useRef<Record<string, { x: number; y: number }>>({});
  const dragKeyframesRef = useRef<Record<string, Keyframe[]>>({});

  function resetHistory(nextObjects: VectorObject[], nextSettings: DesignDocumentSettings) {
    historyRef.current = [{ objects: nextObjects, designSettings: nextSettings }];
    historyIndexRef.current = 0;
    setHistoryVersion((value) => value + 1);
  }

  useEffect(() => {
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    const history = historyRef.current;
    const current = history[historyIndexRef.current];
    if (current.objects === objects && current.designSettings === designSettings) return;
    const next = history.slice(0, historyIndexRef.current + 1);
    next.push({ objects, designSettings });
    if (next.length > 80) next.shift();
    historyRef.current = next;
    historyIndexRef.current = next.length - 1;
    setHistoryVersion((value) => value + 1);
  }, [objects, designSettings]);

  useEffect(() => {
    try {
      localStorage.setItem("design-clover-project-v1", JSON.stringify({
        version: 1, name: projectName, objects, keyframes, device, designSettings
      }));
      setSaveStatus("Saved locally");
    } catch (error) {
      setSaveStatus("Local save unavailable");
    }
  }, [objects, keyframes, device, projectName, designSettings]);

  useEffect(() => {
    const structure = reconcileStructure(designSettings.structure, objects);
    if (JSON.stringify(structure) !== JSON.stringify(designSettings.structure)) {
      setDesignSettings((current) => ({ ...current, structure }));
    }
  }, [objects, designSettings.structure]);

  useEffect(() => {
    if (!designSettings.components.length) return;
    const updatedDefinitions = designSettings.components.map((definition) => {
      const masterObjects = objects.filter((object) => object.componentDefinitionId === definition.id && !object.componentInstanceId);
      if (!masterObjects.length || JSON.stringify(masterObjects) === JSON.stringify(definition.objects)) return definition;
      return { ...definition, objects: masterObjects.map((object) => ({ ...object })), updatedAt: Date.now() };
    });
    const definitionsChanged = updatedDefinitions.some((definition, index) => definition !== designSettings.components[index]);
    if (definitionsChanged) {
      setDesignSettings((current) => ({ ...current, components: updatedDefinitions }));
      return;
    }
    let synced = objects;
    for (const definition of designSettings.components) synced = syncComponentInstances(synced, definition);
    if (JSON.stringify(synced) !== JSON.stringify(objects)) setObjects(synced);
  }, [objects, designSettings.components]);

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
    const snapshot = historyRef.current[historyIndexRef.current];
    setObjects(snapshot.objects);
    setDesignSettings(snapshot.designSettings);
    setHistoryVersion((value) => value + 1);
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    skipHistoryRef.current = true;
    const snapshot = historyRef.current[historyIndexRef.current];
    setObjects(snapshot.objects);
    setDesignSettings(snapshot.designSettings);
    setHistoryVersion((value) => value + 1);
  };

  const saveProjectFile = () => {
    const contents = serializeProjectFile({ name: projectName, objects, keyframes, device, designSettings });
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
      setDevice(parsed.device === "mobile" || parsed.device === "tablet" ? parsed.device : "desktop");
      const restoredSettings = normalizeDesignSettings(parsed.designSettings);
      setDesignSettings(restoredSettings);
      setProjectName(typeof parsed.name === "string" ? parsed.name : "Imported Project");
      setSelected("");
      setSelectedIds([]);
      resetHistory(parsed.objects as VectorObject[], restoredSettings);
      setSaveStatus("Project opened");
      rememberRecentProject({
        name: typeof parsed.name === "string" ? parsed.name : "Imported Project",
        objects: parsed.objects as VectorObject[],
        keyframes: parsed.keyframes && typeof parsed.keyframes === "object" ? parsed.keyframes as Record<string, Keyframe[]> : {},
        device: parsed.device === "mobile" || parsed.device === "tablet" ? parsed.device : "desktop",
        designSettings: restoredSettings
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

  const commitImportedObjects = (result: ImportResult, description: string) => {
    const imported = result.objects;
    if (!imported.length) throw new Error("The selected file did not contain importable objects.");
    setObjects((current) => [...current, ...imported]);
    setSelected(imported[imported.length - 1].id);
    setSelectedIds(imported.map((object) => object.id));
    setTool("select");
    setMode("Design");
    setShowSplash(false);
    setSaveStatus(`Imported ${imported.length} ${description}`);
    if (result.warnings.length) window.alert(`Import completed with limitations:\n\n${result.warnings.map((warning) => `• ${warning}`).join("\n")}`);
  };

  const openDesignFile = async (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Import files must be 20 MB or smaller.");
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (extension === "svg") {
        const result = importSvg(await file.text(), file.name);
        commitImportedObjects(result, `SVG objects from ${file.name}`);
      } else if (extension === "pdf" || isIllustratorFile(file.name)) {
        setPdfImportFile(file);
      } else {
        throw new Error("Choose an SVG, PDF, or PDF-compatible Illustrator (.ai) file.");
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : `Could not import "${file.name}".`);
    } finally {
      setSvgInputKey((value) => value + 1);
    }
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

  const responsiveFrame = useMemo(
    () => getResponsiveFrame(device, designSettings.breakpoints, designSettings.viewports[device]),
    [device, designSettings.breakpoints, designSettings.viewports]
  );
  const structure = designSettings.structure;
  const responsiveObjects = useMemo(() => resolveResponsiveObjects(objects, device, responsiveFrame), [objects, device, responsiveFrame]);
  const selectedObject = responsiveObjects.find((item) => item.id === selected);

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
    () => responsiveObjects.map((item) => ({
      ...item,
      animated: getAnimatedTransform(item, frame, keyframes[item.id] || [])
    })),
    [objects, responsiveObjects, frame, keyframes]
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
    setObjects((current) => current.map((item) => {
      if (item.id !== id) return item;
      const responsiveGeometry = device !== "desktop" &&
        (patch.x !== undefined || patch.y !== undefined || patch.width !== undefined || patch.height !== undefined);
      if (responsiveGeometry) {
        const { x, y, width, height, ...appearance } = patch;
        const overrides = item.responsiveOverrides || {};
        return {
          ...item,
          ...appearance,
          responsiveOverrides: {
            ...overrides,
            [device]: {
              ...overrides[device],
              ...(x !== undefined ? { x } : {}),
              ...(y !== undefined ? { y } : {}),
              ...(width !== undefined ? { width } : {}),
              ...(height !== undefined ? { height } : {})
            }
          }
        };
      }
      const points = item.type === "path" && item.points && !patch.points && (patch.width !== undefined || patch.height !== undefined)
        ? item.points.map((point) => {
            const scaleX = patch.width !== undefined ? patch.width / item.width : 1;
            const scaleY = patch.height !== undefined ? patch.height / item.height : 1;
            return {
              ...point,
              x: point.x * scaleX,
              y: point.y * scaleY,
              ...(point.handleIn ? { handleIn: { x: point.handleIn.x * scaleX, y: point.handleIn.y * scaleY } } : {}),
              ...(point.handleOut ? { handleOut: { x: point.handleOut.x * scaleX, y: point.handleOut.y * scaleY } } : {})
            };
          })
        : item.points;
      return {
        ...item,
        ...patch,
        ...(points ? { points } : {}),
        ...(item.componentInstanceId && ("text" in patch || "imageData" in patch || "fill" in patch)
          ? {
              componentOverrides: {
                ...item.componentOverrides,
                ...("text" in patch ? { text: patch.text } : {}),
                ...("imageData" in patch ? { imageData: patch.imageData } : {}),
                ...("fill" in patch ? { fill: patch.fill } : {})
              }
            }
          : {})
      };
    }));
  };

  const replaceSelectedImage = (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !selectedObject || selectedObject.type !== "image") return;
    if (file.size > MAX_IMPORT_BYTES) {
      setSaveStatus("Image replacement failed: file exceeds the 20 MB limit");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    const allowedExtensions = ["png", "jpg", "jpeg", "gif", "webp"];
    if (!allowedTypes.includes(file.type) && !(file.type === "" && extension && allowedExtensions.includes(extension))) {
      setSaveStatus("Image replacement failed: choose a PNG, JPEG, GIF, or WebP image");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setSaveStatus("Image replacement failed: could not read the selected file");
        return;
      }
      updateObject(selectedObject.id, { imageData: reader.result });
      setSaveStatus("Image replaced");
    };
    reader.onerror = () => setSaveStatus(`Image replacement failed: ${reader.error?.message || "could not read the selected file"}`);
    reader.readAsDataURL(file);
  };

  const responsiveWarnings = validateResponsiveLayout(objects, device, responsiveFrame);
  const generatedWebsite = useMemo(() => generateWebsite(objects, {
    title: projectName,
    breakpoints: designSettings.breakpoints,
    viewports: designSettings.viewports,
    structure: designSettings.structure,
    tokens: designSettings.tokens
  }), [objects, projectName, designSettings.breakpoints, designSettings.viewports, designSettings.structure, designSettings.tokens]);

  const createComponent = () => {
    const selectedObjects = objects.filter((object) => selectedIds.includes(object.id));
    if (!selectedObjects.length) return;
    const definition = createComponentDefinition(`Component ${designSettings.components.length + 1}`, selectedObjects);
    const masters = new Map(definition.objects.map((object) => [object.id, object]));
    setObjects((current) => current.map((object) => selectedIds.includes(object.id)
      ? { ...object, componentDefinitionId: definition.id, componentInstanceId: undefined, componentSourceId: object.id }
      : object));
    setDesignSettings((current) => ({ ...current, components: [...current.components, { ...definition, objects: [...masters.values()] }] }));
    setSaveStatus(`Created component ${definition.name}`);
  };

  const insertComponent = (componentId: string) => {
    const definition = designSettings.components.find((component) => component.id === componentId);
    if (!definition) return;
    const instances = instantiateComponent(definition);
    setObjects((current) => [...current, ...instances]);
    setSelected(instances[0]?.id || "");
    setSelectedIds(instances.map((object) => object.id));
  };

  const duplicateComponent = (componentId: string) => {
    const source = designSettings.components.find((component) => component.id === componentId);
    if (!source) return;
    const copy = createComponentDefinition(`${source.name} copy`, source.objects);
    setDesignSettings((current) => ({ ...current, components: [...current.components, copy] }));
  };

  const updateDesignSettings = (patch: Partial<typeof DEFAULT_DESIGN_SETTINGS>) => {
    setDesignSettings((current) => ({ ...current, ...patch }));
  };

  const applyDesignToken = (tokenId: string) => {
    const token = designSettings.tokens.find((item) => item.id === tokenId);
    if (!token || !selectedIds.length) return;
    setObjects((current) => applyToken(current, token, selectedIds));
    setDesignSettings((current) => ({
      ...current,
      tokens: current.tokens.map((item) => item.id === tokenId
        ? { ...item, objectIds: [...new Set([...item.objectIds, ...selectedIds])] }
        : item)
    }));
  };

  const editDesignToken = (tokenId: string, value: string, name?: string) => {
    const token = designSettings.tokens.find((item) => item.id === tokenId);
    if (!token) return;
    if (value !== token.value) setObjects((current) => updateToken(current, token, value));
    setDesignSettings((current) => ({
      ...current,
      tokens: current.tokens.map((item) => item.id === tokenId ? { ...item, value, ...(name !== undefined ? { name } : {}) } : item)
    }));
  };

  const toggleObjectSelection = (id: string, additive = false) => {
    const item = objects.find((object) => object.id === id);
    if (!item) return;
    if (!additive && item.groupPath?.length) {
      const pathKey = JSON.stringify(item.groupPath);
      const groupMembers = objects.filter((object) => JSON.stringify(object.groupPath || []) === pathKey).map((object) => object.id);
      setSelectedIds(groupMembers);
      setSelected(id);
      return;
    }
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
      selectedIds.includes(item.id) ? { ...item, groupId, groupPath: undefined, groupNames: undefined } : item
    ));
  };

  const ungroupSelected = () => {
    const importedPaths = objects
      .filter((item) => selectedIds.includes(item.id) && item.groupPath?.length)
      .map((item) => item.groupPath!);
    if (importedPaths.length) {
      setObjects((current) => current.map((item) => {
        const path = item.groupPath;
        if (!path) return item;
        const parentPath = importedPaths.find((candidate) =>
          path.length >= candidate.length && candidate.every((id, index) => path[index] === id)
        );
        if (!parentPath) return item;
        const nextPath = path.filter((_, index) => index !== parentPath.length - 1);
        const nextNames = item.groupNames?.filter((_, index) => index !== parentPath.length - 1);
        return {
          ...item,
          groupId: nextPath[nextPath.length - 1],
          groupPath: nextPath.length ? nextPath : undefined,
          groupNames: nextNames?.length ? nextNames : undefined
        };
      }));
      return;
    }
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
      groupId: undefined,
      groupPath: undefined,
      groupNames: undefined
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

  const addObject = (type: "rect" | "ellipse" | "text", x = 330, y = 230) => {
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
    const logicalWidth = 800 * responsiveFrame.width / 1440;
    const logicalHeight = 480 * responsiveFrame.height / 900;
    return {
      x: Math.max(0, Math.min(logicalWidth, ((event.clientX - rect.left) / rect.width) * logicalWidth)),
      y: Math.max(0, Math.min(logicalHeight, ((event.clientY - rect.top) / rect.height) * logicalHeight))
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
      : item.groupPath?.length
        ? objects.filter((object) => JSON.stringify(object.groupPath || []) === JSON.stringify(item.groupPath)).map((object) => object.id)
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
      objects.filter((object) => nextSelection.includes(object.id)).map((object) => {
        const responsiveObject = responsiveObjects.find((item) => item.id === object.id) || object;
        return [object.id, { x: responsiveObject.x, y: responsiveObject.y }];
      })
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
        const logicalWidth = 800 * responsiveFrame.width / 1440;
        const logicalHeight = 480 * responsiveFrame.height / 900;
        const centerX = (left + right) / 2 + deltaX;
        const centerY = (top + bottom) / 2 + deltaY;
        if (Math.abs(centerX - logicalWidth / 2) <= 8) deltaX += logicalWidth / 2 - centerX;
        if (Math.abs(centerY - logicalHeight / 2) <= 8) deltaY += logicalHeight / 2 - centerY;
      }
    }

    setObjects((current) => current.map((item) => {
      if (!movingIds.includes(item.id)) return item;
      const origin = dragOriginsRef.current[item.id] || { x: item.x, y: item.y };
      if (device !== "desktop") {
        const overrides = item.responsiveOverrides || {};
        return {
          ...item,
          responsiveOverrides: {
            ...overrides,
            [device]: { ...overrides[device], x: origin.x + deltaX, y: origin.y + deltaY }
          }
        };
      }
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
          <button className="icon-button" title="Import SVG, PDF, or Illustrator file" onClick={() => document.getElementById("design-import-input")?.click()}><ImageIcon size={16} /></button>
          <button className="icon-button" title="Save Design Clover project (.dc)" onClick={saveProjectFile}><Save size={16} /></button>
          <input key={projectInputKey} id="project-file-input" type="file" accept=".dc,.json,.clover.json,application/json" hidden onChange={openProjectFile} />
          <input key={svgInputKey} id="design-import-input" type="file" accept=".svg,.pdf,.ai,image/svg+xml,application/pdf,application/postscript" hidden onChange={openDesignFile} />
          <button className="icon-button" title="Settings"><Settings2 size={17} /></button>
          <button className="share-button" onClick={() => changeMode("Code")}><Upload size={14} /> Export</button>
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
                title="Import SVG, PDF, or Illustrator file"
                onClick={() => document.getElementById("design-import-input")?.click()}
              >
                <ImageIcon size={17} />
              </button>
              <button className="tool-button" title="Delete selected" onClick={deleteSelected}>
                <Trash2 size={16} />
              </button>
            </div>

            <DesignToolsPanel
              activeTab={designToolsTab}
              onTabChange={setDesignToolsTab}
              objects={objects}
              selectedIds={selectedIds}
              onSelect={(ids) => {
                const validIds = ids.filter((id) => objects.some((object) => object.id === id));
                setSelectedIds(validIds);
                setSelected(validIds[0] || "");
              }}
              structure={structure}
              onStructureChange={(nodes: StructureNode[]) => updateDesignSettings({ structure: nodes })}
              onGroup={groupSelected}
              onUngroup={ungroupSelected}
              onRoleChange={(nodeId, role) => {
                setDesignSettings((current) => ({
                  ...current,
                  structure: updateStructureNode(current.structure, nodeId, (node) => ({ ...node, role }))
                }));
              }}
              onObjectsChange={setObjects}
              components={designSettings.components}
              onCreateComponent={createComponent}
              onRenameComponent={(id, name) => setDesignSettings((current) => ({ ...current, components: current.components.map((item) => item.id === id ? { ...item, name } : item) }))}
              onDuplicateComponent={duplicateComponent}
              onInsertComponent={insertComponent}
              tokens={designSettings.tokens}
              onDetectTokens={() => {
                const detected = detectTokens(objects);
                setDesignSettings((current) => ({
                  ...current,
                  tokens: [...current.tokens, ...detected.filter((token) => !current.tokens.some((existing) => existing.category === token.category && existing.value === token.value))]
                }));
              }}
              onAddToken={() => setDesignSettings((current) => ({
                ...current,
                tokens: [...current.tokens, { id: `token-${crypto.randomUUID()}`, name: `Color ${current.tokens.length + 1}`, category: "color", value: "#39d98a", objectIds: [] }]
              }))}
              onApplyToken={applyDesignToken}
              onUpdateToken={editDesignToken}
              device={device}
              frame={responsiveFrame}
              breakpoints={designSettings.breakpoints}
              onFrameChange={(viewport) => setDesignSettings((current) => ({ ...current, viewports: { ...current.viewports, [device]: viewport } }))}
              onBreakpointsChange={(breakpoints) => setDesignSettings((current) => ({ ...current, breakpoints }))}
              onObjectLayoutChange={updateObject}
              warnings={responsiveWarnings}
            />
            {designToolsTab === "layers" && <div className="panel-section layer-section">
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
                    style={{ paddingLeft: 8 + (item.groupPath?.length || 0) * 10 }}
                    title={item.groupNames?.join(" / ")}
                  >
                    <button
                      className="layer-item"
                      onClick={(event) => toggleObjectSelection(item.id, event.shiftKey || event.ctrlKey || event.metaKey)}
                      title="Click to select; Shift/Ctrl-click to add or remove from selection"
                      onDoubleClick={() => {
                        const name = window.prompt("Rename layer", item.name);
                        if (name?.trim()) updateObject(item.id, { name: name.trim() });
                      }}
                    >
                      {item.type === "text" ? <Type size={14} /> : item.type === "ellipse" ? <Circle size={14} /> : item.type === "path" ? <Diamond size={14} /> : item.type === "image" ? <ImageIcon size={14} /> : <Square size={14} />}
                      <span>{item.groupPath?.length ? "▧ " : item.groupId ? "▧ " : ""}{item.name}</span>
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
            </div>}

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
                viewBox={`0 0 ${800 * responsiveFrame.width / 1440} ${480 * responsiveFrame.height / 900}`}
                preserveAspectRatio="none"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
              >
                  <defs>
                    {objects.filter((object) => object.gradient).map((object) => (
                      object.gradient?.type === "linear"
                        ? <linearGradient key={object.id} id={`gradient-${object.id}`} x1={object.gradient.x1} y1={object.gradient.y1} x2={object.gradient.x2} y2={object.gradient.y2}>{object.gradient.stops.map((stop, index) => <stop key={`${object.id}-${index}`} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}</linearGradient>
                        : object.gradient
                          ? <radialGradient key={object.id} id={`gradient-${object.id}`} cx={object.gradient.cx} cy={object.gradient.cy} r={object.gradient.r} fx={object.gradient.fx} fy={object.gradient.fy}>{object.gradient.stops.map((stop, index) => <stop key={`${object.id}-${index}`} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />)}</radialGradient>
                          : null
                    ))}
                  </defs>
                  {animatedObjects.filter((item) => item.visible !== false).map((item) => (
                    <g
                      key={item.id}
                      opacity={item.opacity ?? 1}
                      transform={`translate(${item.animated.x - item.x} ${item.animated.y - item.y}) translate(${item.x + item.width / 2} ${item.y + item.height / 2}) rotate(${item.animated.rotation}) scale(${item.animated.scale}) translate(${-item.x - item.width / 2} ${-item.y - item.height / 2})`}
                    >
                    {item.type === "path" && item.points && (
                      <path
                        d={buildVectorPath(item.points, item.x, item.y, item.closed)}
                        fill={item.closed ? (item.gradient ? `url(#gradient-${item.id})` : item.fill) : "none"}
                        fillOpacity={item.fillOpacity ?? 1}
                        fillRule={item.fillRule || "nonzero"}
                        stroke={item.stroke || "none"}
                        strokeOpacity={item.strokeOpacity ?? 1}
                        strokeWidth={item.strokeWidth ?? 0}
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
                        fill={item.gradient ? `url(#gradient-${item.id})` : item.fill}
                        fillOpacity={item.fillOpacity ?? 1}
                        stroke={item.stroke || "none"}
                        strokeOpacity={item.strokeOpacity ?? 1}
                        strokeWidth={item.strokeWidth ?? 0}
                        strokeDasharray={item.strokeDasharray || undefined}
                        strokeLinecap={item.strokeLinecap || "round"}
                        strokeLinejoin={item.strokeLinejoin || "round"}
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
                        fill={item.gradient ? `url(#gradient-${item.id})` : item.fill}
                        fillOpacity={item.fillOpacity ?? 1}
                        stroke={item.stroke || "none"}
                        strokeOpacity={item.strokeOpacity ?? 1}
                        strokeWidth={item.strokeWidth ?? 0}
                        strokeDasharray={item.strokeDasharray || undefined}
                        strokeLinecap={item.strokeLinecap || "round"}
                        strokeLinejoin={item.strokeLinejoin || "round"}
                        onPointerDown={(event) => handleObjectPointerDown(event, item)}
                        style={{ cursor: item.locked ? "not-allowed" : tool === "select" ? "move" : "crosshair" }}
                      />
                    )}

                    {item.type === "text" && (
                      <text
                        x={item.x}
                        y={item.y + (item.fontSize || 28)}
                        fontSize={item.fontSize || 28}
                        fontFamily={item.fontFamily || "sans-serif"}
                        fontWeight={item.fontWeight || "normal"}
                        fontStyle={item.fontStyle || "normal"}
                        textAnchor={item.textAnchor || "start"}
                        letterSpacing={item.letterSpacing}
                        textDecoration={item.textDecoration}
                        fill={item.gradient ? `url(#gradient-${item.id})` : item.fill}
                        fillOpacity={item.fillOpacity ?? 1}
                        stroke={item.stroke || "none"}
                        strokeOpacity={item.strokeOpacity ?? 1}
                        strokeWidth={item.strokeWidth ?? 0}
                        onPointerDown={(event) => handleObjectPointerDown(event, item)}
                        style={{ cursor: item.locked ? "not-allowed" : tool === "select" ? "move" : "crosshair", userSelect: "none" }}
                      >
                        {item.text || "Text"}
                      </text>
                    )}
                    {item.type === "image" && item.imageData && (
                      <image
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        href={item.imageData}
                        preserveAspectRatio="xMidYMid meet"
                        onPointerDown={(event) => handleObjectPointerDown(event, item)}
                        style={{ cursor: item.locked ? "not-allowed" : tool === "select" ? "move" : "crosshair" }}
                      />
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

          {showCode && <CodeModePanel website={generatedWebsite} projectName={projectName} />}

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
                      {selectedObject.type === "image" && (
                        <>
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept=".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp"
                            hidden
                            onChange={replaceSelectedImage}
                          />
                          <button className="image-replace-button" onClick={() => imageInputRef.current?.click()}>
                            Replace image
                          </button>
                        </>
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
                  <button className={device === "desktop" ? "active" : ""} onClick={() => { setDevice("desktop"); setDesignToolsTab("responsive"); }}>
                    <Monitor size={16} />
                  </button>
                  <button className={device === "tablet" ? "active" : ""} onClick={() => { setDevice("tablet"); setDesignToolsTab("responsive"); }}>
                    <Tablet size={16} />
                  </button>
                  <button className={device === "mobile" ? "active" : ""} onClick={() => { setDevice("mobile"); setDesignToolsTab("responsive"); }}>
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
    {pdfImportFile && (
      <PdfImportDialog
        file={pdfImportFile}
        onImport={(result, description) => {
          commitImportedObjects(result, description);
          setPdfImportFile(null);
        }}
        onClose={() => setPdfImportFile(null)}
      />
    )}
    </>
  );
}

export default App;
