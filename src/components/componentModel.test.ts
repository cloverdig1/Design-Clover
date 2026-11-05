import { describe, expect, it } from "vitest";
import type { VectorObject } from "../editor-types";
import { createComponentDefinition, instantiateComponent, syncComponentInstances } from "./componentModel";

const master: VectorObject = {
  id: "master-text", name: "Label", type: "text", x: 10, y: 20, width: 120, height: 24,
  fill: "#111111", rotation: 0, text: "Original"
};

describe("linked components", () => {
  it("creates instances linked to the source and propagates master edits with instance overrides", () => {
    const definition = createComponentDefinition("Button", [master]);
    const instance = instantiateComponent(definition)[0];
    const editedInstance = { ...instance, text: "Instance label", componentOverrides: { text: "Instance label" } };
    const editedMaster = { ...definition.objects[0], text: "Updated" };
    const updated = syncComponentInstances([editedMaster, editedInstance], { ...definition, objects: [editedMaster] });
    expect(updated[1]).toMatchObject({ text: "Instance label", x: instance.x, y: instance.y, componentSourceId: "master-text" });
    const plainInstance = syncComponentInstances([instance], { ...definition, objects: [editedMaster] })[0];
    expect(plainInstance.text).toBe("Updated");
  });

  it("preserves image replacement overrides when the linked master changes", () => {
    const imageMaster: VectorObject = {
      id: "master-image", name: "Photo", type: "image", x: 0, y: 0, width: 120, height: 80,
      fill: "#ffffff", rotation: 0, imageData: "data:image/png;base64,bWFzdGVy"
    };
    const definition = createComponentDefinition("Photo", [imageMaster]);
    const instance = instantiateComponent(definition)[0];
    const replacement = "data:image/png;base64,aW5zdGFuY2U=";
    const editedInstance = {
      ...instance,
      imageData: replacement,
      componentOverrides: { imageData: replacement }
    };
    const editedMaster = { ...definition.objects[0], width: 160 };
    const updated = syncComponentInstances([editedMaster, editedInstance], { ...definition, objects: [editedMaster] });
    expect(updated[1]).toMatchObject({ width: 160, imageData: replacement });
  });
});
