import { zipSync, strToU8 } from "fflate";
import type { GeneratedWebsite } from "../code-generation/generateWebsite";

export function createWebsiteArchive(website: GeneratedWebsite, projectName: string): Uint8Array {
  const warningNotes = website.warnings.length
    ? `\n## Generation warnings\n\n${website.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : "";
  const files: Record<string, Uint8Array> = {
    "index.html": strToU8(website.html),
    "styles.css": strToU8(website.css),
    "README.md": strToU8(`# ${projectName}\n\nGenerated with Design Clover. Open \`index.html\` in a browser to preview the website.\n${warningNotes}`)
  };
  for (const asset of website.assets) files[asset.path] = asset.data;
  return zipSync(files, { level: 6 });
}

export function downloadWebsiteArchive(website: GeneratedWebsite, projectName: string): void {
  const archive = createWebsiteArchive(website, projectName);
  const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${projectName.trim().replace(/[^a-z0-9-_]+/gi, "-") || "design-clover-website"}.zip`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
