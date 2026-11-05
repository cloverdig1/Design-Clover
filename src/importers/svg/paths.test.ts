// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseSvgPath } from "./paths";
import { importSvg } from "./importSvg";
import { parseTransform, transformPoint, viewBoxTransform } from "./transform";

describe("SVG path reconstruction", () => {
  it("preserves cubic and converted quadratic curves across multiple subpaths", () => {
    const subpaths = parseSvgPath("M0 0 C10 0 10 10 20 10 S30 20 40 10 Q45 0 50 10 T60 10 A5 5 0 0 1 70 10 Z M80 0 l10 10");
    expect(subpaths).toHaveLength(2);
    expect(subpaths[0].closed).toBe(true);
    expect(subpaths[0].points.some((point) => point.handleIn || point.handleOut)).toBe(true);
    expect(subpaths[1].closed).toBe(false);
    expect(subpaths[1].points.at(-1)).toMatchObject({ x: 90, y: 10 });
  });

  it("rejects malformed or unsupported path syntax", () => {
    expect(() => parseSvgPath("M0 0 X10 10")).toThrow();
    expect(() => parseSvgPath("M0")).toThrow();
  });
});

describe("SVG design import", () => {
  it("applies nested transforms, group opacity, inherited CSS and group membership", () => {
    const root = new DOMParser().parseFromString('<svg width="200" height="100" viewBox="0 0 200 100"/>', "image/svg+xml").documentElement;
    expect(viewBoxTransform(root, 800, 480, 200, 100)).toEqual([4, 0, 0, 4, 0, 40]);
    const result = importSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
        <style>.leaf { fill: #20c080; stroke: #003300; stroke-width: 2; }</style>
        <g id="outer" transform="translate(10 5)" opacity=".5">
          <g id="nested" transform="scale(2)">
            <rect class="leaf" x="2" y="3" width="10" height="4" opacity=".5"/>
          </g>
        </g>
      </svg>`,
      "nested.svg"
    );
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]).toMatchObject({
      type: "path",
      x: 56,
      y: 84,
      width: 80,
      height: 32,
      fill: "#20c080",
      stroke: "#003300",
      opacity: 0.25,
      groupPath: ["svg-group-outer", "svg-group-nested"],
      groupNames: ["outer", "nested"]
    });
  });

  it("imports SVG primitive shapes, gradients, editable text and embedded raster images", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const result = importSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
        <line x1="0" y1="0" x2="10" y2="10" stroke="#111"/>
        <polygon points="20,20 30,20 30,30" fill="url(#g)"/>
        <text x="10" y="50" font-family="Inter" font-size="12" font-weight="700" text-anchor="middle">Hello</text>
        <image x="40" y="40" width="10" height="10" href="${image}"/>
      </svg>`,
      "shapes.svg"
    );
    expect(result.objects.map((object) => object.type)).toEqual(["path", "path", "text", "image"]);
    expect(result.objects[1].gradient?.type).toBe("linear");
    expect(result.objects[2]).toMatchObject({ text: "Hello", fontFamily: "Inter", fontWeight: "700", textAnchor: "middle" });
    expect(result.objects[3].imageData).toBe(image);
  });

  it("keeps SVG aspect ratio and converts physical element units", () => {
    const result = importSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in" viewBox="0 0 192 96">
        <rect width="72pt" height="25.4mm"/>
      </svg>`,
      "units.svg"
    );
    expect(result.objects[0].width).toBeCloseTo(400);
    expect(result.objects[0].height).toBeCloseTo(400);
    expect(() => importSvg('<svg viewBox="0 0 0 10"><rect width="1" height="1"/></svg>', "broken.svg")).toThrow(/invalid viewBox/i);
  });

  it("accepts sanitized embedded SVG images and blocks active embedded SVG content", () => {
    const safeImage = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')}`;
    const imported = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="${safeImage}" width="10" height="10"/></svg>`, "image.svg");
    expect(imported.objects[0].imageData).toMatch(/^data:image\/svg\+xml/);

    const unsafeImage = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')}`;
    const rejected = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/><image href="${unsafeImage}" width="10" height="10"/></svg>`, "unsafe-image.svg");
    expect(rejected.warnings.join(" ")).toMatch(/unsafe embedded/i);
  });

  it("blocks active content and reports external images instead of fetching them", () => {
    expect(() => importSvg("<svg><script>alert(1)</script></svg>", "unsafe.svg")).toThrow(/active/i);
    const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/><image href="https://example.invalid/a.png" width="10" height="10"/></svg>', "remote.svg");
    expect(result.objects).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/External SVG images/);
  });
});

describe("SVG transform parsing", () => {
  it("composes translate, scale, rotation, skew, and matrix transforms", () => {
    const matrix = parseTransform("translate(10 20) scale(2) rotate(90) skewX(0) matrix(1 0 0 1 0 0)");
    const point = transformPoint(matrix, { x: 1, y: 0 });
    expect(point.x).toBeCloseTo(10);
    expect(point.y).toBeCloseTo(22);
  });
});
