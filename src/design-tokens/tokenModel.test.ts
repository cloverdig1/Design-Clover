import { describe, expect, it } from "vitest";
import type { VectorObject } from "../editor-types";
import { applyToken, detectTokens, updateToken } from "./tokenModel";

const objects: VectorObject[] = [
  { id: "a", name: "A", type: "rect", x: 0, y: 0, width: 80, height: 40, fill: "#111111", rotation: 0, cornerRadius: 4 },
  { id: "b", name: "B", type: "text", x: 100, y: 0, width: 80, height: 40, fill: "#111111", rotation: 0, text: "Text", fontSize: 16, fontFamily: "Inter", fontWeight: "700" }
];

describe("design tokens", () => {
  it("detects repeated colors and typographic values", () => {
    const tokens = detectTokens(objects);
    expect(tokens.some((token) => token.category === "color" && token.value === "#111111")).toBe(true);
    expect(tokens.some((token) => token.category === "font-size" && token.value === "16")).toBe(true);
    expect(tokens.some((token) => token.category === "font-weight" && token.value === "700")).toBe(true);
  });

  it("links selected objects and propagates value changes", () => {
    const token = { id: "brand", name: "Brand", category: "color" as const, value: "#00aa55", objectIds: [] };
    const linked = applyToken(objects, token, ["a"]);
    expect(linked[0]).toMatchObject({ fill: "#00aa55", tokenRefs: { fill: "brand" } });
    expect(updateToken(linked, token, "#ff0088")[0].fill).toBe("#ff0088");
    expect(linked[1].fill).toBe("#111111");
  });
});
