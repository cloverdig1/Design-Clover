import { describe, expect, it } from "vitest";
import type { VectorObject } from "../editor-types";
import { DEFAULT_BREAKPOINTS, getResponsiveFrame, resolveResponsiveObject, resolveResponsiveObjects, validateResponsiveLayout } from "./layoutEngine";

const object: VectorObject = {
  id: "card",
  name: "Card",
  type: "rect",
  x: 100,
  y: 80,
  width: 200,
  height: 100,
  fill: "#fff",
  rotation: 0,
  layout: { mode: "absolute", anchors: ["right", "bottom"], minWidth: 80 },
  responsiveOverrides: { mobile: { x: 20, width: 180, visible: true } }
};

describe("responsive layout engine", () => {
  it("uses default and customized viewport sizes", () => {
    expect(getResponsiveFrame("mobile", DEFAULT_BREAKPOINTS)).toEqual({ width: 375, height: 812 });
    expect(getResponsiveFrame("tablet", { ...DEFAULT_BREAKPOINTS, tablet: 820 })).toEqual({ width: 820, height: 1024 });
    expect(getResponsiveFrame("desktop", DEFAULT_BREAKPOINTS, { width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
  });

  it("resolves device overrides without mutating desktop source values", () => {
    const mobile = resolveResponsiveObject(object, "mobile", { width: 375, height: 812 });
    expect(mobile).toMatchObject({ x: 20, width: 180, visible: true });
    expect(object).toMatchObject({ x: 100, width: 200 });
  });

  it("arranges grouped flex children and distributes remaining space to fill-sized children", () => {
    const objects: VectorObject[] = [
      { ...object, id: "container", groupId: "row", x: 0, y: 0, width: 300, height: 100, layout: { mode: "flex", direction: "row", padding: 10, gap: 10, align: "stretch" } },
      { ...object, id: "fixed", groupId: "row", x: 0, y: 0, width: 80, height: 20 },
      { ...object, id: "fill", groupId: "row", x: 0, y: 0, width: 40, height: 20, layout: { mode: "absolute", widthMode: "fill" } }
    ];
    const resolved = resolveResponsiveObjects(objects, "desktop", { width: 1440, height: 900 });
    expect(resolved.find((item) => item.id === "fixed")).toMatchObject({ x: 10, width: 80, height: 80 });
    expect(resolved.find((item) => item.id === "fill")).toMatchObject({ x: 100, width: 190, height: 80 });
  });

  it("places grid children into responsive cells with percent sizing", () => {
    const objects: VectorObject[] = [
      { ...object, id: "grid", groupId: "cards", x: 0, y: 0, width: 220, height: 120, layout: { mode: "grid", columns: 2, padding: 10, gap: 10 } },
      { ...object, id: "first", groupId: "cards", x: 0, y: 0, width: 30, height: 20, layout: { mode: "absolute", widthMode: "fill", heightMode: "fill" } },
      { ...object, id: "second", groupId: "cards", x: 0, y: 0, width: 30, height: 20, layout: { mode: "absolute", widthMode: "percent", widthPercent: 50, heightMode: "fill" } }
    ];
    const resolved = resolveResponsiveObjects(objects, "desktop", { width: 1440, height: 900 });
    expect(resolved.find((item) => item.id === "first")).toMatchObject({ x: 10, y: 10, width: 95, height: 100 });
    expect(resolved.find((item) => item.id === "second")).toMatchObject({ x: 115, y: 10, width: 47.5, height: 100 });
  });

  it("does not reserve flex space for children hidden at the current breakpoint", () => {
    const objects: VectorObject[] = [
      { ...object, id: "container", groupId: "row", x: 0, y: 0, width: 300, height: 100, responsiveOverrides: undefined, layout: { mode: "flex", direction: "row", gap: 12 } },
      { ...object, id: "hidden", groupId: "row", x: 0, y: 0, width: 100, height: 20, responsiveOverrides: { mobile: { visible: false } } },
      { ...object, id: "visible", groupId: "row", x: 0, y: 0, width: 80, height: 20, responsiveOverrides: undefined }
    ];
    const resolved = resolveResponsiveObjects(objects, "mobile", { width: 375, height: 812 });
    expect(resolved.find((item) => item.id === "visible")?.x).toBe(0);
    expect(resolved.find((item) => item.id === "hidden")?.visible).toBe(false);
  });

  it("reports viewport overflow and substantial overlaps", () => {
    const warnings = validateResponsiveLayout([
      { ...object, x: 760, y: 460, width: 100, height: 40, responsiveOverrides: undefined },
      { ...object, id: "cover", x: 760, y: 460, width: 90, height: 38, responsiveOverrides: undefined }
    ], "desktop", { width: 1440, height: 900 });
    expect(warnings.some((warning) => warning.code === "outside")).toBe(true);
    expect(warnings.some((warning) => warning.code === "overlap")).toBe(true);
  });
});
