import type { VectorObject } from "../editor-types";

export type ImportResult = {
  objects: VectorObject[];
  warnings: string[];
};

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORTED_OBJECTS = 3000;
