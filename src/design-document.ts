import type { VectorObject } from "./editor-types";
import type { BreakpointSettings, Device, LayoutConfig, ResponsiveFrame } from "./responsive/layoutEngine";
import { DEFAULT_BREAKPOINTS, DEFAULT_FRAMES } from "./responsive/layoutEngine";

export type StructureRole =
  | "page" | "header" | "nav" | "main" | "section" | "footer" | "article"
  | "heading" | "paragraph" | "button" | "image" | "icon" | "group" | "text" | "element";

export type StructureNode = {
  id: string;
  name: string;
  role: StructureRole;
  objectIds: string[];
  confidence?: number;
  children: StructureNode[];
  collapsed?: boolean;
  layout?: LayoutConfig;
};

export type ComponentDefinition = {
  id: string;
  name: string;
  objects: VectorObject[];
  updatedAt: number;
};

export type DesignToken = {
  id: string;
  name: string;
  category: "color" | "typography" | "font-size" | "font-weight" | "spacing" | "radius" | "shadow" | "dimension";
  value: string;
  objectIds: string[];
};

export type DesignDocumentSettings = {
  breakpoints: BreakpointSettings;
  viewports: Record<Device, ResponsiveFrame>;
  structure: StructureNode[];
  components: ComponentDefinition[];
  tokens: DesignToken[];
  codeSettings: { classPrefix: string; semanticHtml: boolean };
};

export const DEFAULT_DESIGN_SETTINGS: DesignDocumentSettings = {
  breakpoints: DEFAULT_BREAKPOINTS,
  viewports: DEFAULT_FRAMES,
  structure: [],
  components: [],
  tokens: [],
  codeSettings: { classPrefix: "dc", semanticHtml: true }
};

export function normalizeDesignSettings(value: unknown): DesignDocumentSettings {
  if (!value || typeof value !== "object") return DEFAULT_DESIGN_SETTINGS;
  const settings = value as Partial<DesignDocumentSettings>;
  const breakpoints = settings.breakpoints && typeof settings.breakpoints === "object"
    ? settings.breakpoints
    : DEFAULT_BREAKPOINTS;
  const viewports = settings.viewports && typeof settings.viewports === "object" ? settings.viewports : DEFAULT_FRAMES;
  return {
    breakpoints: {
      mobile: finitePositive(breakpoints.mobile, DEFAULT_BREAKPOINTS.mobile),
      tablet: finitePositive(breakpoints.tablet, DEFAULT_BREAKPOINTS.tablet),
      desktop: finitePositive(breakpoints.desktop, DEFAULT_BREAKPOINTS.desktop)
    },
    viewports: {
      mobile: normalizeFrame(viewports.mobile, DEFAULT_FRAMES.mobile),
      tablet: normalizeFrame(viewports.tablet, DEFAULT_FRAMES.tablet),
      desktop: normalizeFrame(viewports.desktop, DEFAULT_FRAMES.desktop)
    },
    structure: Array.isArray(settings.structure) ? settings.structure : [],
    components: Array.isArray(settings.components) ? settings.components : [],
    tokens: Array.isArray(settings.tokens) ? settings.tokens : [],
    codeSettings: settings.codeSettings && typeof settings.codeSettings === "object"
      ? {
          classPrefix: settings.codeSettings.classPrefix || "dc",
          semanticHtml: settings.codeSettings.semanticHtml !== false
        }
      : DEFAULT_DESIGN_SETTINGS.codeSettings
  };
}

function normalizeFrame(value: unknown, fallback: ResponsiveFrame): ResponsiveFrame {
  if (!value || typeof value !== "object") return fallback;
  const frame = value as Partial<ResponsiveFrame>;
  return {
    width: finitePositive(frame.width, fallback.width),
    height: finitePositive(frame.height, fallback.height)
  };
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createStructureNode(role: StructureRole, name: string, objectIds: string[], children: StructureNode[] = []): StructureNode {
  return { id: `structure-${crypto.randomUUID()}`, role, name, objectIds, children };
}

export function initialDevice(device: string): Device {
  return device === "mobile" || device === "tablet" ? device : "desktop";
}
