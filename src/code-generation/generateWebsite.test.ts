import { describe, expect, it } from "vitest";
import type { VectorObject } from "../editor-types";
import { generateWebsite } from "./generateWebsite";
import { createWebsiteArchive } from "../export/exportWebsite";
import { unzipSync, strFromU8 } from "fflate";

const objects: VectorObject[] = [
  { id: "heading", name: "Main heading", type: "text", x: 40, y: 50, width: 400, height: 64, fill: "#172019", rotation: 0, text: "Hello <world>", fontSize: 36 },
  { id: "photo", name: "Decorative image", type: "image", x: 450, y: 80, width: 200, height: 160, fill: "#fff", rotation: 0, imageData: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==" }
];

describe("website generation and export", () => {
  it("generates escaped semantic HTML, responsive CSS, and externalized data assets", () => {
    const generated = generateWebsite(objects, { title: "Test", breakpoints: { desktop: 1440, tablet: 768, mobile: 375 } });
    expect(generated.html).toContain("<h2");
    expect(generated.html).toContain("Hello &lt;world&gt;");
    expect(generated.html).toContain("./assets/photo.svg");
    expect(generated.css).toContain("@media (max-width: 375px)");
    expect(generated.assets).toHaveLength(1);
  });

  it("creates an independently usable ZIP website archive", () => {
    const generated = generateWebsite(objects, { title: "Test" });
    const archive = unzipSync(createWebsiteArchive(generated, "Test"));
    expect(strFromU8(archive["index.html"])).toContain("./styles.css");
    expect(archive["assets/photo.svg"]).toBeDefined();
    expect(archive["README.md"]).toBeDefined();
  });

  it("exports responsive visibility and rejects unsafe link and CSS values", () => {
    const generated = generateWebsite([
      {
        id: "hidden-card",
        name: "Hidden card",
        type: "rect",
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        fill: "red; background:url(javascript:alert(1))",
        rotation: 0,
        visible: false,
        responsiveOverrides: { mobile: { visible: true, x: 12 } }
      },
      {
        id: "unsafe-link",
        name: "Unsafe link",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 30,
        fill: "#111",
        rotation: 0,
        text: "Open",
        fontFamily: 'Arial"; color:red; } body { background:url(https://example.test/x)',
        semanticRole: "link",
        href: "javascript:alert(1)"
      },
      {
        id: "unsupported-image",
        name: "Unsupported image",
        type: "image",
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        fill: "none",
        rotation: 0,
        imageData: "data:text/html;base64,PHNjcmlwdD4="
      },
      {
        id: "tablet-only",
        name: "Tablet card",
        type: "rect",
        x: 0,
        y: 0,
        width: 60,
        height: 40,
        fill: "#fff",
        rotation: 0,
        visible: false,
        responsiveOverrides: { tablet: { visible: true } }
      }
    ], { breakpoints: { desktop: 1440, tablet: 700, mobile: 900 } });

    expect(generated.html).toContain('href="#"');
    expect(generated.html).not.toContain("javascript:");
    expect(generated.css).toContain("display: none");
    expect(generated.css).toContain("display: block");
    expect(generated.css).not.toContain("background:url(https://example.test/x)");
    expect(generated.warnings).toContain('Image "Unsupported image" uses an unsupported or invalid data URL and was omitted.');
    expect(generated.css.indexOf("@media (max-width: 900px)")).toBeLessThan(generated.css.indexOf("@media (max-width: 700px)"));
  });
});
