import { describe, expect, it } from "vitest";
import type { VectorObject } from "../editor-types";
import { detectStructure, updateStructureNode } from "./detectStructure";

const objects: VectorObject[] = [
  { id: "brand", name: "Brand", type: "text", x: 20, y: 20, width: 120, height: 30, fill: "#111", rotation: 0, text: "Clover", fontSize: 24 },
  { id: "hero", name: "Hero title", type: "text", x: 80, y: 140, width: 340, height: 70, fill: "#111", rotation: 0, text: "Welcome", fontSize: 40 },
  { id: "image", name: "Hero image", type: "image", x: 450, y: 120, width: 240, height: 200, fill: "#fff", rotation: 0 }
];

describe("semantic structure detection", () => {
  it("organizes objects into page and geometry-based sections with confidence", () => {
    const tree = detectStructure(objects);
    expect(tree[0].role).toBe("page");
    expect(tree[0].children[0].children).toHaveLength(2);
    expect(tree[0].children[0].children[0].role).toBe("header");
    expect(tree[0].children[0].children[1].confidence).toBeGreaterThan(0);
  });

  it("updates a nested structure node immutably", () => {
    const tree = detectStructure(objects);
    const target = tree[0].children[0].children[1];
    const next = updateStructureNode(tree, target.id, (node) => ({ ...node, name: "Hero" }));
    expect(next[0].children[0].children[1].name).toBe("Hero");
    expect(tree[0].children[0].children[1].name).not.toBe("Hero");
  });
});
