/**
 * dc-ptc/index.ts — Extensión modular de Programmatic Tool Calling para DC Studio.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDcPtcTools } from "./tools/dc-ptc-tools.ts";

export * from "./core/dc-ptc-types.ts";
export * from "./core/dc-ptc-runner.ts";
export * from "./tools/dc-ptc-tools.ts";

export default function dcPtcExtension(pi: ExtensionAPI): void {
  registerDcPtcTools(pi);
}
