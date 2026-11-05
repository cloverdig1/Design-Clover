import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { VectorObject } from "../../editor-types";
import { MAX_IMPORT_BYTES, MAX_IMPORTED_OBJECTS, type ImportResult } from "../import-types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDocument = pdfjs.PDFDocumentProxy;

export function pdfBytesFromFile(buffer: ArrayBuffer, fileName: string): Uint8Array {
  if (buffer.byteLength > MAX_IMPORT_BYTES) throw new Error("PDF and Illustrator files must be 20 MB or smaller.");
  const bytes = new Uint8Array(buffer);
  if (!fileName.toLowerCase().endsWith(".ai")) return bytes;
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const offset = header.indexOf("%PDF-");
  if (offset < 0) {
    throw new Error(
      "This Illustrator file does not contain PDF-compatible content. In Illustrator, export it as SVG or save a copy with “Create PDF Compatible File” enabled, then import it again."
    );
  }
  return bytes.subarray(offset);
}

export function loadPdf(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes, useSystemFonts: true });
}

export async function renderPdfPageToDataUrl(page: pdfjs.PDFPageProxy): Promise<{ data: string; width: number; height: number }> {
  const unitViewport = page.getViewport({ scale: 1 });
  const fitScale = Math.min(800 / unitViewport.width, 480 / unitViewport.height);
  const scale = Math.min(fitScale * 2, 4);
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  if (width * height > 12_000_000) throw new Error("This PDF page is too large to render safely.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (!canvas.getContext("2d", { alpha: false })) throw new Error("Canvas rendering is unavailable for this PDF page.");
  await page.render({ canvas, viewport, background: "#ffffff" }).promise;
  const data = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  return { data, width, height };
}

export async function extractPdfText(page: pdfjs.PDFPageProxy): Promise<ImportResult> {
  const unitViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(800 / unitViewport.width, 480 / unitViewport.height);
  const viewport = page.getViewport({ scale });
  const offsetX = (800 - viewport.width) / 2;
  const offsetY = (480 - viewport.height) / 2;
  const textContent = await page.getTextContent();
  const objects: VectorObject[] = [];

  for (const [index, item] of textContent.items.entries()) {
    if (!("str" in item) || !item.str.trim()) continue;
    if (objects.length >= MAX_IMPORTED_OBJECTS) throw new Error(`This PDF page contains more than ${MAX_IMPORTED_OBJECTS} text objects.`);
    const [a, b, , , x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(6, Math.hypot(a, b));
    objects.push({
      id: `pdf-text-${Date.now()}-${index}`,
      name: `PDF text ${index + 1}`,
      type: "text",
      x: x + offsetX,
      y: y + offsetY - fontSize,
      width: Math.max(24, item.width * scale),
      height: Math.max(10, item.height * scale),
      fill: "#111111",
      rotation: Math.atan2(b, a) * 180 / Math.PI,
      text: item.str,
      fontSize,
      fontFamily: textContent.styles[item.fontName]?.fontFamily || "sans-serif"
    });
  }
  if (!objects.length) throw new Error("No extractable text was found on this PDF page. Import the page as a rendered image instead.");
  return {
    objects,
    warnings: ["Only selectable text was extracted. Artwork, images, fills, and vector paths are not included in this import mode."]
  };
}

export function pdfPageAsImage(data: string, width: number, height: number): ImportResult {
  const scale = Math.min(800 / width, 480 / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  return {
    objects: [{
      id: `pdf-page-${Date.now()}`,
      name: "PDF page",
      type: "image",
      x: (800 - renderedWidth) / 2,
      y: (480 - renderedHeight) / 2,
      width: renderedWidth,
      height: renderedHeight,
      fill: "#ffffff",
      rotation: 0,
      imageData: data
    }],
    warnings: ["The PDF page was imported as a flattened image; its vector elements are not individually editable."]
  };
}
