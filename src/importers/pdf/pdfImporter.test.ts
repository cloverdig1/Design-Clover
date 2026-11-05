// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isIllustratorFile } from "../illustrator";
import { pdfBytesFromFile, pdfPageAsImage } from "./pdfImporter";

describe("PDF and Illustrator file handling", () => {
  it("recognizes PDF-compatible Illustrator files and rejects non-compatible ones", () => {
    const bytes = new TextEncoder().encode("%!PS-Adobe-3.0\n%PDF-1.7\ncontent");
    const result = pdfBytesFromFile(bytes.buffer, "artwork.AI");
    expect(new TextDecoder().decode(result)).toBe("%PDF-1.7\ncontent");
    expect(isIllustratorFile("artwork.AI")).toBe(true);
    expect(isIllustratorFile("artwork.svg")).toBe(false);
    expect(() => pdfBytesFromFile(new TextEncoder().encode("%!PS-Adobe-3.0").buffer, "legacy.ai")).toThrow(/PDF-compatible/i);
  });

  it("uses a full-page raster object without distorting page proportions", () => {
    const result = pdfPageAsImage("data:image/png;base64,abc", 1600, 900);
    expect(result.objects[0]).toMatchObject({
      type: "image",
      x: 0,
      y: 15,
      width: 800,
      height: 450
    });
    expect(result.warnings[0]).toMatch(/flattened image/i);
  });
});
