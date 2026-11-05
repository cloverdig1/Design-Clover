import type { DesignToken } from "../design-document";
import type { VectorObject } from "../editor-types";

export function detectTokens(objects: VectorObject[]): DesignToken[] {
  const colors = new Map<string, string[]>();
  const fonts = new Map<string, string[]>();
  const fontSizes = new Map<string, string[]>();
  const fontWeights = new Map<string, string[]>();
  const radii = new Map<string, string[]>();
  const shadows = new Map<string, string[]>();
  const spacing = new Map<string, string[]>();
  const dimensions = new Map<string, string[]>();
  for (const object of objects) {
    if (object.fill && object.fill !== "none") colors.set(object.fill, [...new Set([...(colors.get(object.fill) || []), object.id])]);
    if (object.stroke && object.stroke !== "none") colors.set(object.stroke, [...new Set([...(colors.get(object.stroke) || []), object.id])]);
    if (object.fontFamily) fonts.set(object.fontFamily, [...(fonts.get(object.fontFamily) || []), object.id]);
    if (object.fontSize) fontSizes.set(String(object.fontSize), [...(fontSizes.get(String(object.fontSize)) || []), object.id]);
    if (object.fontWeight) fontWeights.set(String(object.fontWeight), [...(fontWeights.get(String(object.fontWeight)) || []), object.id]);
    if (object.cornerRadius) radii.set(String(object.cornerRadius), [...(radii.get(String(object.cornerRadius)) || []), object.id]);
    if (object.shadow) shadows.set(object.shadow, [...(shadows.get(object.shadow) || []), object.id]);
    if (object.layout?.gap !== undefined) spacing.set(String(object.layout.gap), [...(spacing.get(String(object.layout.gap)) || []), object.id]);
    if (object.layout?.padding !== undefined) spacing.set(String(object.layout.padding), [...(spacing.get(String(object.layout.padding)) || []), object.id]);
    const dimensionsValue = `${Math.round(object.width)}x${Math.round(object.height)}`;
    dimensions.set(dimensionsValue, [...(dimensions.get(dimensionsValue) || []), object.id]);
  }
  const entries: Array<[DesignToken["category"], Map<string, string[]>]> = [
    ["color", colors], ["typography", fonts], ["font-size", fontSizes], ["font-weight", fontWeights],
    ["spacing", spacing], ["radius", radii], ["shadow", shadows], ["dimension", dimensions]
  ];
  return entries.flatMap(([category, values]) => [...values].map(([value, objectIds], index) => ({
    id: `token-${category}-${index}-${value.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`,
    name: `${category.replace("-", " ")} ${index + 1}`,
    category,
    value,
    objectIds
  })));
}

export function applyToken(objects: VectorObject[], token: DesignToken, objectIds: string[]): VectorObject[] {
  return objects.map((object) => {
    if (!objectIds.includes(object.id)) return object;
    if (token.category === "color") return {
      ...object,
      fill: token.value,
      tokenRefs: { ...object.tokenRefs, fill: token.id },
      ...(object.componentInstanceId ? { componentOverrides: { ...object.componentOverrides, fill: token.value } } : {})
    };
    if (token.category === "typography" && object.type === "text") return { ...object, fontFamily: token.value, tokenRefs: { ...object.tokenRefs, fontFamily: token.id } };
    if (token.category === "font-size" && object.type === "text") return { ...object, fontSize: Number(token.value), tokenRefs: { ...object.tokenRefs, fontSize: token.id } };
    if (token.category === "font-weight" && object.type === "text") return { ...object, fontWeight: token.value, tokenRefs: { ...object.tokenRefs, fontWeight: token.id } };
    if (token.category === "radius" && object.type === "rect") return { ...object, cornerRadius: Number(token.value), tokenRefs: { ...object.tokenRefs, cornerRadius: token.id } };
    if (token.category === "shadow") return { ...object, shadow: token.value, tokenRefs: { ...object.tokenRefs, shadow: token.id } };
    if (token.category === "spacing") return { ...object, layout: { ...object.layout, mode: object.layout?.mode || "flex", gap: Number(token.value) }, tokenRefs: { ...object.tokenRefs, gap: token.id } };
    if (token.category === "dimension") {
      const [width, height] = token.value.toLowerCase().split("x").map(Number);
      if (Number.isFinite(width) && Number.isFinite(height)) return { ...object, width, height, tokenRefs: { ...object.tokenRefs, width: token.id, height: token.id } };
    }
    return object;
  });
}

export function updateToken(objects: VectorObject[], token: DesignToken, value: string): VectorObject[] {
  return objects.map((object) => {
    const refs = object.tokenRefs;
    if (!refs) return object;
    const patch: Partial<VectorObject> = {};
    if (refs.fill === token.id) patch.fill = value;
    if (refs.fontFamily === token.id) patch.fontFamily = value;
    if (refs.fontSize === token.id) patch.fontSize = Number(value);
    if (refs.fontWeight === token.id) patch.fontWeight = value;
    if (refs.cornerRadius === token.id) patch.cornerRadius = Number(value);
    if (refs.shadow === token.id) patch.shadow = value;
    if (refs.gap === token.id) patch.layout = { ...object.layout, mode: object.layout?.mode || "flex", gap: Number(value) };
    if (refs.width === token.id || refs.height === token.id) {
      const [width, height] = value.toLowerCase().split("x").map(Number);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        if (refs.width === token.id) patch.width = width;
        if (refs.height === token.id) patch.height = height;
      }
    }
    return Object.keys(patch).length ? { ...object, ...patch } : object;
  });
}
