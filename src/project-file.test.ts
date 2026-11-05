import { describe, expect, it } from "vitest";
import { parseProjectFile, serializeProjectFile } from "./project-file";

describe("project document compatibility", () => {
  it("opens existing .dc and clover JSON documents without new settings", () => {
    const oldProject = serializeProjectFile({ name: "Old", objects: [], keyframes: {}, device: "desktop" });
    expect(parseProjectFile(oldProject, "old.dc").objects).toEqual([]);
    expect(parseProjectFile(JSON.stringify({ format: "design-clover", objects: [], keyframes: {}, device: "desktop" }), "old.clover.json")).toMatchObject({ objects: [] });
  });

  it("round-trips extended responsive and structure settings", () => {
    const settings = { breakpoints: { mobile: 390, tablet: 820, desktop: 1440 }, viewports: {}, structure: [], components: [], tokens: [], codeSettings: { classPrefix: "site", semanticHtml: true } };
    const contents = serializeProjectFile({ name: "New", objects: [], keyframes: {}, device: "mobile", designSettings: settings });
    expect(parseProjectFile(contents, "new.dc").designSettings).toEqual(settings);
  });
});
