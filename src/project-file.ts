export const designCloverFileSignature = "DESIGN CLOVER PROJECT\n";

type ProjectData = {
  name: string;
  objects: unknown[];
  keyframes: Record<string, unknown[]>;
  device: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeProjectFile(project: ProjectData): string {
  return `${designCloverFileSignature}${JSON.stringify(
    { format: "design-clover", version: 1, project },
    null,
    2
  )}\n`;
}

export function parseProjectFile(contents: string, fileName: string): Record<string, unknown> {
  if (fileName.toLowerCase().endsWith(".dc")) {
    if (!contents.startsWith(designCloverFileSignature)) {
      throw new Error("This .dc file does not have a valid Design Clover signature.");
    }

    const parsed: unknown = JSON.parse(contents.slice(designCloverFileSignature.length));
    if (!isRecord(parsed) || parsed.format !== "design-clover" || parsed.version !== 1 ||
        !isRecord(parsed.project) || !Array.isArray(parsed.project.objects)) {
      throw new Error("This .dc file uses an unsupported format or version.");
    }

    return { format: "design-clover", version: 1, ...parsed.project };
  }

  const parsed: unknown = JSON.parse(contents);
  if (!isRecord(parsed) || parsed.format !== "design-clover" || !Array.isArray(parsed.objects)) {
    throw new Error("This is not a valid Design Clover project file.");
  }
  return parsed;
}
