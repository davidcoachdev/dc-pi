/**
 * dc-approval/index.ts — Extensión del sistema de Aprobación Unitaria (Allowed-Once).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export * from "./core/dc-approval-types.ts";
export * from "./core/dc-approval-coordinator.ts";
export * from "./views/dc-approval-modal.ts";

export default function dcApprovalExtension(_pi: ExtensionAPI): void {
  // Inicialización de la extensión de aprobaciones
}
