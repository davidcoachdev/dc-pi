import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// UI Primitives & Helpers
export { DcWindow, type DcWindowOptions } from "./ui/dc-window.ts";
export { DcTabs, type DcTabsOptions, type DcTabItem } from "./ui/dc-tabs.ts";
export { DcSidebarCard, type DcSidebarCardOptions } from "./ui/dc-sidebar-card.ts";
export { openDcModal, type DcModalOptions } from "./ui/dc-modal.ts";

// Bottom Bar Components & Helpers
export * from "./features/dc-sidebar/bottom-bar/index.ts";

// Core State & Machine
export { AgentVisualStateStore, type AgentState } from "./core/dc-agent-state/dc-agent-state.ts";

// Integrations
export { dcClipboard } from "./integrations/dc-clipboard/dc-clipboard.ts";
export { fetchJson, DcHttpError, DcHttpTimeoutError } from "./integrations/dc-http/dc-fetch.ts";
export { CliProxyClient } from "./integrations/dc-cliproxy/dc-cliproxy-client.ts";
import { DcNotifier, dcNotifier } from "./integrations/dc-notify/dc-notifier.ts";
export { DcNotifier, dcNotifier };
export const notifyHerdr = (title: string, body?: string): boolean => dcNotifier.notifyHerdr(title, body);
export { getGitChanges, parseGitStatus } from "./integrations/dc-git/dc-git.ts";

// Feature Extensions
import dcNotifyExtension from "./integrations/dc-notify/dc-notifier.ts";
import caritasExtension from "./features/dc-caritas/dc-caritas.ts";
import dcFaceExtension from "./features/dc-face/dc-face.ts";
import dcKeysExtension from "./features/dc-keys/dc-keys.ts";
import dcChangesExtension from "./features/dc-changes/dc-changes.ts";
import dcModelsExtension from "./features/dc-models/dc-models.ts";
import dcQuotaExtension from "./features/dc-quota/dc-quota.ts";
import dcStatusExtension from "./features/dc-status/dc-status.ts";
import dcBannerExtension from "./features/dc-banner/dc-banner.ts";
import dcUserExtension from "./features/dc-user/dc-user.ts";
import dcTitleExtension from "./features/dc-title/dc-title.ts";
import dcExitExtension from "./features/dc-exit/dc-exit.ts";
import dcPreviewExtension from "./features/dc-preview/dc-preview.ts";
import dcDoctorExtension from "./features/dc-doctor/dc-doctor.ts";
import dcReloadExtension from "./features/dc-reload/dc-reload.ts";
import dcToolBoxExtension from "./features/dc-tool-box/dc-tool-box.ts";
import dcUserBoxExtension from "./features/dc-user-box/dc-user-box.ts";
import dcMarkdownExtension from "./features/dc-markdown/dc-markdown.ts";
import dcSidebarExtension from "./features/dc-sidebar/dc-sidebar.ts";
import dcPromptExtension from "./features/dc-prompt/dc-prompt.ts";
import dcDialogsExtension from "./experimental/dc-dialogs-overlay/dc-dialogs.ts";

export const profileDuelExtension = dcFaceExtension;
export const dcFacesExtension = dcFaceExtension;
export const dcFaceAnimExtension = dcFaceExtension;

export {
  dcNotifyExtension,
  caritasExtension,
  caritasExtension as dcCaritasExtension,
  dcFaceExtension,
  dcKeysExtension,
  dcChangesExtension,
  dcModelsExtension,
  dcQuotaExtension,
  dcStatusExtension,
  dcBannerExtension,
  dcUserExtension,
  dcTitleExtension,
  dcExitExtension,
  dcPreviewExtension,
  dcDoctorExtension,
  dcReloadExtension,
  dcToolBoxExtension,
  dcUserBoxExtension,
  dcMarkdownExtension,
  dcSidebarExtension,
  dcPromptExtension,
  dcDialogsExtension,
};

/**
 * Unified DC Studio Extension.
 * Registers the entire DC Studio ecosystem by executing all feature extensions.
 */
export function dcStudioExtension(pi: ExtensionAPI, ctx?: ExtensionContext): void {
  dcNotifyExtension(pi);
  caritasExtension(pi);
  dcFaceExtension(pi);
  dcKeysExtension(pi);
  dcChangesExtension(pi);
  dcModelsExtension(pi);
  dcQuotaExtension(pi);
  dcStatusExtension(pi);
  dcBannerExtension(pi);
  dcUserExtension(pi);
  dcTitleExtension(pi);
  dcExitExtension(pi);
  dcPreviewExtension(pi);
  dcDoctorExtension(pi);
  dcReloadExtension(pi);
  dcToolBoxExtension(pi);
  dcUserBoxExtension(pi);
  dcMarkdownExtension(pi);
  dcSidebarExtension(pi);
  dcPromptExtension(pi);
  dcDialogsExtension(pi, ctx);
}

export default dcStudioExtension;
