import { useState } from "react";
import { Clipboard, Download, Eye, FileCode2 } from "lucide-react";
import type { GeneratedWebsite } from "../code-generation/generateWebsite";
import { downloadWebsiteArchive } from "../export/exportWebsite";

type Props = { website: GeneratedWebsite; projectName: string };

export default function CodeModePanel({ website, projectName }: Props) {
  const [file, setFile] = useState<"html" | "css" | "structure" | "preview">("html");
  const [message, setMessage] = useState("");
  const content = file === "html" ? website.html : file === "css" ? website.css : JSON.stringify(website.structure, null, 2);
  const preview = website.html
    .replace('<link rel="stylesheet" href="./styles.css">', `<style>${website.css}</style>`)
    .replace(/src="\.\/assets\/([^"]+)"/g, (_match, assetName: string) => {
      const asset = website.assets.find((item) => item.path.endsWith(`/${assetName}`));
      if (!asset) return 'src=""';
      const base64 = btoa(Array.from(asset.data, (byte) => String.fromCharCode(byte)).join(""));
      const extension = asset.path.split(".").pop();
      return `src="data:image/${extension === "svg" ? "svg+xml" : extension};base64,${base64}"`;
    });
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        try {
          textarea.select();
          if (!document.execCommand("copy")) throw new Error("Clipboard access is unavailable.");
        } finally {
          textarea.remove();
        }
      }
      setMessage(`${file.toUpperCase()} copied`);
    } catch (error) {
      setMessage(error instanceof Error ? `Copy failed: ${error.message}` : "Copy failed.");
    }
  };
  return <section className="code-drawer code-mode-panel">
    <div className="code-header">
      <span><FileCode2 size={14} /> WEBSITE CODE · {website.assets.length} ASSETS · LIVE{website.warnings.length ? ` · ${website.warnings.length} WARNINGS` : ""}</span>
      <div className="code-panel-actions">
        {(["html", "css", "structure", "preview"] as const).map((item) => <button key={item} className={file === item ? "active" : ""} onClick={() => setFile(item)}>{item === "preview" ? <Eye size={12} /> : null}{item.toUpperCase()}</button>)}
        <button onClick={() => void copy()} disabled={file === "preview"}><Clipboard size={12} /> Copy</button>
        <button className="code-export" onClick={() => { try { downloadWebsiteArchive(website, projectName); setMessage("Website ZIP exported"); } catch (error) { setMessage(error instanceof Error ? `Export failed: ${error.message}` : "Export failed."); } }}><Download size={12} /> Export ZIP</button>
        <span role="status">{message}</span>
      </div>
    </div>
    {website.warnings.length > 0 && <ul className="code-generation-warnings" role="status">{website.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
    {file === "preview"
      ? <iframe className="code-preview" title="Generated website preview" sandbox="allow-same-origin" srcDoc={preview} />
      : <pre className="generated-code"><code>{content}</code></pre>}
  </section>;
}
