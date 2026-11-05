import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, Lock, Plus, Smartphone, Monitor, Component, Palette, LayoutGrid } from "lucide-react";
import type { VectorObject } from "../editor-types";
import type { ComponentDefinition, DesignToken, StructureNode, StructureRole } from "../design-document";
import { resolveResponsiveObjects, type BreakpointSettings, type Device, type LayoutConfig, type LayoutWarning, type ResponsiveFrame } from "../responsive/layoutEngine";

export type DesignToolsTab = "layers" | "structure" | "components" | "tokens" | "responsive";

type Props = {
  activeTab: DesignToolsTab;
  onTabChange: (tab: DesignToolsTab) => void;
  objects: VectorObject[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  structure: StructureNode[];
  onStructureChange: (nodes: StructureNode[]) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onRoleChange: (nodeId: string, role: StructureRole) => void;
  onObjectsChange: (objects: VectorObject[]) => void;
  components: ComponentDefinition[];
  onCreateComponent: () => void;
  onRenameComponent: (id: string, name: string) => void;
  onDuplicateComponent: (id: string) => void;
  onInsertComponent: (id: string) => void;
  tokens: DesignToken[];
  onDetectTokens: () => void;
  onAddToken: () => void;
  onApplyToken: (id: string) => void;
  onUpdateToken: (id: string, value: string, name?: string) => void;
  device: Device;
  frame: ResponsiveFrame;
  breakpoints: BreakpointSettings;
  onFrameChange: (frame: ResponsiveFrame) => void;
  onBreakpointsChange: (breakpoints: BreakpointSettings) => void;
  onObjectLayoutChange: (id: string, patch: Partial<VectorObject>) => void;
  warnings: LayoutWarning[];
};

function updateNode(nodes: StructureNode[], id: string, change: (node: StructureNode) => StructureNode): StructureNode[] {
  return nodes.map((node) => node.id === id ? change(node) : { ...node, children: updateNode(node.children, id, change) });
}

function moveNode(nodes: StructureNode[], id: string, direction: -1 | 1): StructureNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) return nodes;
    const next = [...nodes];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  return nodes.map((node) => ({ ...node, children: moveNode(node.children, id, direction) }));
}

function StructureTree({
  nodes, selectedIds, onSelect, onChange, onRoleChange, objects, onObjectsChange, depth = 0
}: {
  nodes: StructureNode[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onChange: (nodes: StructureNode[]) => void;
  onRoleChange: (nodeId: string, role: StructureRole) => void;
  objects: VectorObject[];
  onObjectsChange: (objects: VectorObject[]) => void;
  depth?: number;
}) {
  return <ul className="structure-tree">
    {nodes.map((node) => {
      const selected = node.objectIds.some((id) => selectedIds.includes(id));
      const groupObjects = objects.filter((object) => node.objectIds.includes(object.id));
      const allHidden = groupObjects.length > 0 && groupObjects.every((object) => object.visible === false);
      const allLocked = groupObjects.length > 0 && groupObjects.every((object) => object.locked);
      return <li key={node.id}>
        <div className={`structure-row ${selected ? "selected" : ""}`} style={{ paddingLeft: 7 + depth * 14 }} onClick={() => onSelect(node.objectIds)}>
          {node.children.length > 0
            ? <button className="structure-collapse" aria-label={`${node.collapsed ? "Expand" : "Collapse"} ${node.name}`} onClick={(event) => { event.stopPropagation(); onChange(updateNode(nodes, node.id, (item) => ({ ...item, collapsed: !item.collapsed }))); }}>{node.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>
            : <span className="structure-leaf" />}
          <input aria-label={`Rename ${node.name}`} value={node.name} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange(updateNode(nodes, node.id, (item) => ({ ...item, name: event.target.value })))} />
          <select aria-label={`Semantic role for ${node.name}`} value={node.role} onClick={(event) => event.stopPropagation()} onChange={(event) => onRoleChange(node.id, event.target.value as StructureRole)}>
            {(["page", "header", "nav", "main", "section", "footer", "article", "heading", "paragraph", "button", "image", "icon", "group", "text", "element"] as StructureRole[]).map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          {typeof node.confidence === "number" && <small title="Deterministic geometry heuristic; verify this classification">{Math.round(node.confidence * 100)}%</small>}
          <button className="structure-action" title={allHidden ? "Show objects" : "Hide objects"} disabled={!groupObjects.length} onClick={(event) => { event.stopPropagation(); onObjectsChange(objects.map((object) => node.objectIds.includes(object.id) ? { ...object, visible: allHidden } : object)); }}>{allHidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
          <button className="structure-action" title={allLocked ? "Unlock objects" : "Lock objects"} disabled={!groupObjects.length} onClick={(event) => { event.stopPropagation(); onObjectsChange(objects.map((object) => node.objectIds.includes(object.id) ? { ...object, locked: !allLocked } : object)); }}><Lock size={12} /></button>
          <button className="structure-action" title="Move up" onClick={(event) => { event.stopPropagation(); onChange(moveNode(nodes, node.id, -1)); }}>↑</button>
          <button className="structure-action" title="Move down" onClick={(event) => { event.stopPropagation(); onChange(moveNode(nodes, node.id, 1)); }}>↓</button>
        </div>
        {!node.collapsed && node.children.length > 0 && <StructureTree nodes={node.children} selectedIds={selectedIds} onSelect={onSelect} onChange={(next) => onChange(updateNode(nodes, node.id, (item) => ({ ...item, children: next })))} onRoleChange={onRoleChange} objects={objects} onObjectsChange={onObjectsChange} depth={depth + 1} />}
      </li>;
    })}
  </ul>;
}

export default function DesignToolsPanel(props: Props) {
  const [selectedToken, setSelectedToken] = useState("");
  const selectedObject = resolveResponsiveObjects(props.objects, props.device, props.frame).find((object) => props.selectedIds.includes(object.id));
  const selectedSource = props.objects.find((object) => object.id === selectedObject?.id);
  const layout = selectedObject?.layout || { mode: "absolute" as const };
  const tabs: Array<[DesignToolsTab, string, typeof Layers]> = [
    ["layers", "Layers", Layers],
    ["structure", "Structure", LayoutGrid],
    ["components", "Components", Component],
    ["tokens", "Tokens", Palette],
    ["responsive", "Responsive", Smartphone]
  ];
  return <div className="design-tools-panel">
    <div className="design-tools-tabs">
      {tabs.map(([tab, title, Icon]) => <button key={tab} className={props.activeTab === tab ? "active" : ""} title={title} aria-label={title} onClick={() => props.onTabChange(tab)}><Icon size={13} /><span>{title}</span></button>)}
    </div>
    {props.activeTab === "structure" && <div className="design-tools-content">
      <div className="design-tools-heading"><strong>DOCUMENT STRUCTURE</strong><span><button disabled={props.selectedIds.length < 2} onClick={props.onGroup}>Group</button><button onClick={props.onUngroup}>Ungroup</button><button onClick={() => props.onStructureChange([])} title="Re-analyze structure">Analyze</button></span></div>
      <p className="design-tools-note">Geometry-based suggestions only. Review section and text roles before generating code.</p>
      {props.structure.length
        ? <StructureTree nodes={props.structure} selectedIds={props.selectedIds} onSelect={props.onSelect} onChange={props.onStructureChange} onRoleChange={props.onRoleChange} objects={props.objects} onObjectsChange={props.onObjectsChange} />
        : <p className="design-tools-empty">Select Analyze to detect a semantic outline.</p>}
    </div>}
    {props.activeTab === "components" && <div className="design-tools-content">
      <div className="design-tools-heading"><strong>COMPONENT LIBRARY</strong><button disabled={!props.selectedIds.length} onClick={props.onCreateComponent}><Plus size={12} /> Create</button></div>
      <p className="design-tools-note">Component masters stay linked to instances. Instance text, image, and fill edits are retained as overrides.</p>
      {props.components.map((definition) => {
        const instances = props.objects.filter((object) => object.componentDefinitionId === definition.id && object.componentInstanceId);
        return <div className="component-card" key={definition.id}>
          <input aria-label="Component name" value={definition.name} onChange={(event) => props.onRenameComponent(definition.id, event.target.value)} />
          <small>{definition.objects.length} master objects · {instances.length} instances</small>
          <div className="component-actions">
            <button onClick={() => props.onSelect(definition.objects.map((object) => object.id))}>Edit master</button>
            <button onClick={() => props.onInsertComponent(definition.id)}>Place instance</button>
            <button onClick={() => props.onDuplicateComponent(definition.id)}>Duplicate</button>
          </div>
        </div>;
      })}
      {!props.components.length && <p className="design-tools-empty">Select canvas objects and create a component to start a reusable library.</p>}
    </div>}
    {props.activeTab === "tokens" && <div className="design-tools-content">
      <div className="design-tools-heading"><strong>DESIGN TOKENS</strong><span><button onClick={props.onDetectTokens}>Detect</button><button onClick={props.onAddToken}>+ Token</button></span></div>
      <p className="design-tools-note">Detected values are suggestions. Apply a token to link selected objects; linked values update together.</p>
      {props.tokens.map((token) => <div className="token-card" key={token.id}>
        <div><input aria-label="Token name" value={token.name} onChange={(event) => props.onUpdateToken(token.id, token.value, event.target.value)} /><small>{token.category} · {token.objectIds.length} linked</small></div>
        <input aria-label={`${token.name} value`} type={token.category === "color" ? "color" : "text"} value={token.value} onChange={(event) => props.onUpdateToken(token.id, event.target.value)} />
        <button className={selectedToken === token.id ? "active" : ""} onClick={() => { setSelectedToken(token.id); props.onApplyToken(token.id); }} disabled={!props.selectedIds.length}>Apply</button>
      </div>)}
      {!props.tokens.length && <p className="design-tools-empty">Detect repeated colors and typography, or add a token manually.</p>}
    </div>}
    {props.activeTab === "responsive" && <div className="design-tools-content">
      <div className="design-tools-heading"><strong>RESPONSIVE LAYOUT</strong></div>
      <div className="responsive-device-readout"><Monitor size={14} /> {props.device.toUpperCase()} VIEWPORT</div>
      <div className="property-grid">
        <label>Width<input type="number" min="240" max="3840" value={props.frame.width} onChange={(event) => props.onFrameChange({ ...props.frame, width: Number(event.target.value) || 240 })} /></label>
        <label>Height<input type="number" min="240" max="3840" value={props.frame.height} onChange={(event) => props.onFrameChange({ ...props.frame, height: Number(event.target.value) || 240 })} /></label>
      </div>
      <div className="responsive-breakpoints">
        <strong>BREAKPOINTS (PX)</strong>
        {(["mobile", "tablet", "desktop"] as Device[]).map((device) => <label key={device}>{device}<input type="number" min="240" max="3840" value={props.breakpoints[device]} onChange={(event) => props.onBreakpointsChange({ ...props.breakpoints, [device]: Number(event.target.value) || props.breakpoints[device] })} /></label>)}
      </div>
      {selectedObject && <>
        <div className="design-tools-heading"><strong>SELECTED OBJECT</strong><span>{selectedObject.name}</span></div>
        <div className="property-grid">
          {(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key.toUpperCase()}<input type="number" min={key === "width" || key === "height" ? 1 : undefined} value={Math.round(selectedObject[key])} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { responsiveOverrides: { ...selectedObject.responsiveOverrides, [props.device]: { ...selectedObject.responsiveOverrides?.[props.device], [key]: Number(event.target.value) } } })} /></label>)}
        </div>
        <label className="responsive-visibility"><input type="checkbox" checked={selectedSource?.responsiveOverrides?.[props.device]?.visible ?? selectedObject.visible !== false} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { responsiveOverrides: { ...selectedObject.responsiveOverrides, [props.device]: { ...selectedObject.responsiveOverrides?.[props.device], visible: event.target.checked } } })} /> Visible on {props.device}</label>
        <label className="layout-field">Layout mode<select value={layout.mode} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, mode: event.target.value as LayoutConfig["mode"] } })}><option value="absolute">Absolute</option><option value="flex">Flexbox</option><option value="grid">CSS Grid</option></select></label>
        {layout.mode !== "absolute" && <div className="property-grid">
          <label>Direction<select value={layout.direction || "row"} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, direction: event.target.value as LayoutConfig["direction"] } })}><option value="row">Horizontal</option><option value="column">Vertical</option></select></label>
          {layout.mode === "grid" && <label>Columns<input type="number" min="1" max="12" value={layout.columns || 2} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, columns: Math.max(1, Number(event.target.value)) } })} /></label>}
          <label>Gap<input type="number" min="0" value={layout.gap || 0} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, gap: Math.max(0, Number(event.target.value)) } })} /></label>
          <label>Padding<input type="number" min="0" value={layout.padding || 0} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, padding: Math.max(0, Number(event.target.value)) } })} /></label>
          <label>Margin<input type="number" min="0" value={layout.margin || 0} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, margin: Math.max(0, Number(event.target.value)) } })} /></label>
          <label>Align<select value={layout.align || "stretch"} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, align: event.target.value as LayoutConfig["align"] } })}><option value="start">Start</option><option value="center">Center</option><option value="end">End</option><option value="stretch">Stretch</option></select></label>
          <label>Justify<select value={layout.justify || "start"} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, justify: event.target.value as LayoutConfig["justify"] } })}><option value="start">Start</option><option value="center">Center</option><option value="end">End</option><option value="space-between">Space between</option><option value="space-around">Space around</option></select></label>
        </div>}
        <div className="property-grid">
          <label>Width sizing<select value={layout.widthMode || "fixed"} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, widthMode: event.target.value as LayoutConfig["widthMode"] } })}><option value="fixed">Fixed</option><option value="auto">Auto</option><option value="percent">Percent</option><option value="fill">Fill container</option><option value="hug">Hug contents</option></select></label>
          <label>Height sizing<select value={layout.heightMode || "fixed"} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, heightMode: event.target.value as LayoutConfig["heightMode"] } })}><option value="fixed">Fixed</option><option value="auto">Auto</option><option value="percent">Percent</option><option value="fill">Fill container</option><option value="hug">Hug contents</option></select></label>
        </div>
        {(layout.widthMode === "percent" || layout.heightMode === "percent") && <div className="property-grid">
          {layout.widthMode === "percent" && <label>Width %<input type="number" min="1" max="100" value={layout.widthPercent || 100} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, widthPercent: Number(event.target.value) } })} /></label>}
          {layout.heightMode === "percent" && <label>Height %<input type="number" min="1" max="100" value={layout.heightPercent || 100} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, heightPercent: Number(event.target.value) } })} /></label>}
        </div>}
        <div className="responsive-breakpoints">
          <strong>MIN/MAX CONSTRAINTS</strong>
          <div className="property-grid"><label>Min W<input type="number" min="0" value={layout.minWidth || ""} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, minWidth: event.target.value ? Number(event.target.value) : undefined } })} /></label><label>Max W<input type="number" min="0" value={layout.maxWidth || ""} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, maxWidth: event.target.value ? Number(event.target.value) : undefined } })} /></label></div>
          <div className="property-grid"><label>Min H<input type="number" min="0" value={layout.minHeight || ""} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, minHeight: event.target.value ? Number(event.target.value) : undefined } })} /></label><label>Max H<input type="number" min="0" value={layout.maxHeight || ""} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, maxHeight: event.target.value ? Number(event.target.value) : undefined } })} /></label></div>
          <div className="layout-anchor-grid"><strong>ANCHOR</strong>{(["left", "right", "top", "bottom", "center-x", "center-y"] as const).map((anchor) => <label key={anchor}><input type="checkbox" checked={layout.anchors?.includes(anchor) || false} onChange={(event) => props.onObjectLayoutChange(selectedObject.id, { layout: { ...layout, anchors: event.target.checked ? [...new Set([...(layout.anchors || []), anchor])] : (layout.anchors || []).filter((item) => item !== anchor) } })} />{anchor}</label>)}</div>
        </div>
      </>}
      <div className="responsive-warnings">
        <strong>LAYOUT CHECKS · {props.warnings.length}</strong>
        {props.warnings.length ? <ul>{props.warnings.slice(0, 12).map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul> : <p>No likely overflow or overlap detected.</p>}
      </div>
      <p className="design-tools-note">Resizing and positioning fields save device-specific overrides. Breakpoint previews and validation use deterministic geometric checks, not automatic design correction.</p>
    </div>}
  </div>;
}
