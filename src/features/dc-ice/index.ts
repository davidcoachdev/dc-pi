/**
 * src/features/dc-ice/index.ts — Punto de entrada para el módulo dc-ice (IDSD / Intent Gate).
 */

export * from "./types.ts";
export * from "./ice-validator.ts";
export * from "./tools/dc-ice-tools.ts";
export * from "./dc-ice-extension.ts";

import { dcIceExtension } from "./dc-ice-extension.ts";
export default dcIceExtension;
