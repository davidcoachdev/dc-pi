/**
 * dc-takeover.ts — Feature entry point for Human Takeover.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDcTakeoverTools } from "./tools/dc-takeover-tools.ts";

export function dcTakeoverExtension(pi: ExtensionAPI): void {
  registerDcTakeoverTools(pi);
}

export default dcTakeoverExtension;
