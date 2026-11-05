import type { VectorObject } from "../editor-types";
import { createStructureNode, type StructureNode, type StructureRole } from "../design-document";

function objectRole(object: VectorObject): StructureRole {
  if (object.type === "image") return "image";
  if (object.type === "text") {
    const text = (object.text || "").trim();
    if ((object.fontSize || 16) >= 28) return "heading";
    if (/^(get started|sign up|log in|buy|contact|submit|learn more|download)\b/i.test(text)) return "button";
    return "paragraph";
  }
  if (object.groupPath?.length || object.groupId) return "group";
  return "element";
}

function clusterRows(objects: VectorObject[], threshold: number): VectorObject[][] {
  const rows: VectorObject[][] = [];
  for (const object of [...objects].sort((a, b) => a.y - b.y)) {
    const row = rows.find((candidate) => {
      const center = candidate.reduce((sum, item) => sum + item.y + item.height / 2, 0) / candidate.length;
      return Math.abs(center - (object.y + object.height / 2)) <= threshold;
    });
    if (row) row.push(object);
    else rows.push([object]);
  }
  return rows.sort((a, b) => Math.min(...a.map((item) => item.y)) - Math.min(...b.map((item) => item.y)));
}

export function detectStructure(objects: VectorObject[]): StructureNode[] {
  const visible = objects.filter((object) => object.visible !== false);
  if (!visible.length) return [createStructureNode("page", "Page", [])];
  const groups = new Map<string, VectorObject[]>();
  const ungrouped: VectorObject[] = [];
  visible.forEach((object) => {
    const key = object.groupPath?.join("/") || object.groupId;
    if (key) groups.set(key, [...(groups.get(key) || []), object]);
    else ungrouped.push(object);
  });
  const rows = clusterRows(ungrouped, 64);
  const sections = rows.map((row, index) => {
    const role: StructureRole = index === 0 && row.some((item) => item.y < 90)
      ? "header"
      : index === rows.length - 1 && row.every((item) => item.y > 400)
        ? "footer"
        : "section";
    const members = [...row].sort((a, b) => a.x - b.x);
    const children = members.map((object) => createStructureNode(objectRole(object), object.name, [object.id]));
    const spread = members.length > 1 ? Math.max(...members.map((item) => item.x + item.width)) - Math.min(...members.map((item) => item.x)) : 0;
    return {
      ...createStructureNode(role, role === "header" ? "Header" : role === "footer" ? "Footer" : `Section ${index + 1}`, members.map((item) => item.id), children),
      confidence: role === "section" ? (spread > 240 ? 0.7 : 0.52) : 0.66
    };
  });
  const grouped = [...groups.entries()].map(([key, members]) => ({
    ...createStructureNode(
      "group",
      members[0]?.groupNames?.at(-1) || key.split("/").at(-1) || "Group",
      members.map((item) => item.id),
      members.map((item) => createStructureNode(objectRole(item), item.name, [item.id]))
    ),
    layout: members.find((item) => item.layout)?.layout
  }));
  const children = [...sections, ...grouped];
  return [
    createStructureNode("page", "Page", visible.map((item) => item.id), [
      createStructureNode("main", "Main", visible.map((item) => item.id), children)
    ])
  ];
}

export function updateStructureNode(
  tree: StructureNode[],
  nodeId: string,
  transform: (node: StructureNode) => StructureNode
): StructureNode[] {
  return tree.map((node) => node.id === nodeId
    ? transform(node)
    : { ...node, children: updateStructureNode(node.children, nodeId, transform) });
}

export function reconcileStructure(tree: StructureNode[], objects: VectorObject[]): StructureNode[] {
  const validIds = new Set(objects.map((object) => object.id));
  const normalize = (nodes: StructureNode[]): StructureNode[] => nodes.flatMap((node) => {
    const children = normalize(node.children);
    const objectIds = node.objectIds.filter((id) => validIds.has(id));
    if (!objectIds.length && !children.length && node.role !== "page" && node.role !== "main") return [];
    return [{ ...node, objectIds, children }];
  });
  const next = normalize(tree);
  const referenced = new Set<string>();
  const visit = (nodes: StructureNode[]) => nodes.forEach((node) => {
    node.objectIds.forEach((id) => referenced.add(id));
    visit(node.children);
  });
  visit(next);
  const missing = objects.filter((object) => !referenced.has(object.id));
  if (!missing.length) return next.length ? next : detectStructure(objects);
  const detected = detectStructure(missing);
  const additions = detected[0]?.children.flatMap((node) => node.children) || [];
  if (!next.length) return detected;
  const appendToMain = (nodes: StructureNode[]): StructureNode[] => nodes.map((node) => {
    if (node.role === "main") return { ...node, objectIds: [...node.objectIds, ...missing.map((object) => object.id)], children: [...node.children, ...additions] };
    return { ...node, children: appendToMain(node.children) };
  });
  return appendToMain(next);
}
