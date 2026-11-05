import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { ImportResult } from "../import-types";
import { extractPdfText, loadPdf, pdfBytesFromFile, pdfPageAsImage, renderPdfPageToDataUrl } from "./pdfImporter";

type PdfImportDialogProps = {
  file: File;
  onImport: (result: ImportResult, description: string) => void;
  onClose: () => void;
};

export default function PdfImportDialog({ file, onImport, onClose }: PdfImportDialogProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | null = null;
    void file.arrayBuffer().then((buffer) => {
      if (!active) return;
      task = loadPdf(pdfBytesFromFile(buffer, file.name));
      return task.promise;
    }).then((result) => {
      if (result && active) {
        setDocument(result);
        setPageNumber(1);
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "The PDF could not be opened.");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => {
      active = false;
      if (task) void task.destroy();
    };
  }, [file]);

  useEffect(() => {
    if (!document) return;
    let active = true;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    void document.getPage(pageNumber).then(async (page) => {
      if (!active) return;
      const source = page.getViewport({ scale: 1 });
      const scale = Math.min(560 / source.width, 360 / source.height);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas || !canvas.getContext("2d")) throw new Error("PDF preview rendering is unavailable.");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      renderTask = page.render({ canvas, viewport, background: "#ffffff" });
      await renderTask.promise;
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not render the selected PDF page.");
    });
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  const importPage = async (mode: "image" | "text") => {
    if (!document) return;
    setBusy(true);
    setError("");
    try {
      const page = await document.getPage(pageNumber);
      let result: ImportResult;
      if (mode === "text") {
        result = await extractPdfText(page);
      } else {
        const preview = await renderPdfPageToDataUrl(page);
        result = pdfPageAsImage(preview.data, preview.width, preview.height);
      }
      onImport(result, `PDF page ${pageNumber}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import this PDF page.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="import-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-import-title">
        <header className="import-dialog-header">
          <div>
            <strong id="pdf-import-title">Import {file.name}</strong>
            <span>{document ? `${document.numPages} page${document.numPages === 1 ? "" : "s"} · choose a page and import mode` : "Opening document..."}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close import dialog">×</button>
        </header>
        {error && <div className="import-dialog-error" role="alert">{error}</div>}
        {busy && !document ? <div className="import-dialog-loading">Reading document...</div> : null}
        {document && (
          <>
            <div className="import-page-controls">
              <button type="button" className="icon-button" onClick={() => setPageNumber((value) => Math.max(1, value - 1))} disabled={pageNumber <= 1 || busy}>‹</button>
              <label>Page <input type="number" min="1" max={document.numPages} value={pageNumber} disabled={busy} onChange={(event) => setPageNumber(Math.max(1, Math.min(document.numPages, Number(event.target.value) || 1)))} /> of {document.numPages}</label>
              <button type="button" className="icon-button" onClick={() => setPageNumber((value) => Math.min(document.numPages, value + 1))} disabled={pageNumber >= document.numPages || busy}>›</button>
            </div>
            <div className="import-page-preview">
              <canvas ref={canvasRef} aria-label={`Preview of page ${pageNumber}`} />
              {busy && <span>Rendering...</span>}
            </div>
            <div className="import-dialog-actions">
              <button type="button" onClick={() => void importPage("text")} disabled={busy}>Extract editable text</button>
              <button type="button" className="primary" onClick={() => void importPage("image")} disabled={busy}>Import page as image</button>
            </div>
            <p className="import-dialog-note">PDF vector shapes and embedded artwork are not yet reconstructed as individual objects. The image option preserves the full page appearance.</p>
          </>
        )}
      </section>
    </div>
  );
}
