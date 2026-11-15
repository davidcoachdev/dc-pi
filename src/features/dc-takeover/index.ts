/**
 * dc-takeover/index.ts — Public surface of the Human Takeover feature.
 */

export { default, default as dcTakeoverExtension } from "./dc-takeover.ts";
export * from "./core/dc-takeover-types.ts";
export { DcTakeoverPanel, openDcTakeoverModal } from "./views/dc-takeover-modal.ts";
export { DC_TAKEOVER_HEADLESS_NOTE, registerDcTakeoverTools } from "./tools/dc-takeover-tools.ts";
