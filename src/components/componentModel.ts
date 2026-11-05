import type { ComponentDefinition } from "../design-document";
import type { VectorObject } from "../editor-types";

export function createComponentDefinition(name: string, objects: VectorObject[]): ComponentDefinition {
  const id = `component-${crypto.randomUUID()}`;
  return {
    id,
    name,
    objects: objects.map((object) => ({ ...object, componentDefinitionId: id })),
    updatedAt: Date.now()
  };
}

export function instantiateComponent(definition: ComponentDefinition, offset = 24): VectorObject[] {
  const instanceId = `instance-${crypto.randomUUID()}`;
  return definition.objects.map((object) => ({
    ...object,
    id: `object-${crypto.randomUUID()}`,
    name: object.name,
    x: object.x + offset,
    y: object.y + offset,
    componentDefinitionId: definition.id,
    componentInstanceId: instanceId,
    componentSourceId: object.id,
    componentOverrides: undefined
  }));
}

export function syncComponentInstances(
  objects: VectorObject[],
  definition: ComponentDefinition
): VectorObject[] {
  const originals = new Map(definition.objects.map((object) => [object.id, object]));
  const sourceIds = new Set(originals.keys());
  return objects.map((object) => {
    if (object.componentDefinitionId !== definition.id || !object.componentInstanceId) return object;
    const source = originals.get(object.componentSourceId || object.id);
    if (!source || !sourceIds.has(source.id)) return object;
    const updated = {
      ...source,
      ...object.componentOverrides,
      id: object.id,
      x: object.x,
      y: object.y,
      componentDefinitionId: definition.id,
      componentInstanceId: object.componentInstanceId,
      componentSourceId: source.id,
      componentOverrides: object.componentOverrides
    };
    return JSON.stringify(updated) === JSON.stringify(object) ? object : updated;
  });
}
