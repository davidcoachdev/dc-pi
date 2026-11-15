import { execFile } from "node:child_process";
import { truncateToWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcJustifiedRow } from "../../dc-sidebar/views/dc-sidebar-body.ts";
import { DcAdbDriver, type DcAdbDevice } from "../core/dc-adb-driver.ts";
import {
  classifyTransport,
  loadConnectionPrefs,
  type DcMobileConnectionPrefs,
} from "../core/dc-mobile-connection.ts";
import {
  createDcMobileSupervisedDriver,
  ensureConnection,
  type DcMobileSupervisorResult,
} from "../core/dc-mobile-supervisor.ts";
import {
  getLiveViewerPid,
  openLiveViewer,
  type DcLiveViewerResult,
} from "../core/dc-mobile-viewer.ts";
import { getLastInspection } from "../tools/dc-mobile-tools.ts";
import {
  formatMobileActivity,
  getMobileActivity,
  recordMobileActivity,
  subscribeMobileActivity,
} from "../core/dc-mobile-activity.ts";

/**
 * Supervisor card for the `[4] MOBILE` sidebar tab (S2–S6, S9, S10).
 *
 * S4: `render()` never runs adb. The device snapshot is taken asynchronously
 * when the card mounts and after every action, and it lives in module scope so
 * switching tabs does not lose it. Repaints are event-driven: activity events
 * and snapshot refreshes call `requestRender`.
 */

/** Last rendered activity lines: the rail is 50 columns wide (S3, S6). */
export const DC_MOBILE_CARD_ACTIVITY_LINES = 8;

export type DcMobileSidebarTransport = "usb" | "wifi" | "mixed" | "none";

export interface DcMobileSidebarSnapshot {
  /** `null` until the first asynchronous probe finishes. */
  adbAvailable: boolean | null;
  devices: readonly DcAdbDevice[];
  transport: DcMobileSidebarTransport;
  activeSerial: string;
  viewerPid?: number;
  lastFrameAt?: number;
  updatedAt: number;
  error?: string;
}

/**
 * Injectable surface. Production defaults reuse the dc-mobile core; tests pass
 * deterministic fakes (no real adb, no real viewer).
 */
export interface DcMobileSidebarDeps {
  isAdbAvailable: () => boolean;
  listDevices: () => DcAdbDevice[];
  loadPrefs: () => DcMobileConnectionPrefs;
  reconnect: () => DcMobileSupervisorResult;
  disconnect: (serial: string) => string | Promise<string>;
  openViewer: (serial: string) => DcLiveViewerResult;
  getViewerPid: (serial: string) => number | undefined;
  getLastFrameAt: (serial: string) => number | undefined;
  now: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptySnapshot(): DcMobileSidebarSnapshot {
  return {
    adbAvailable: null,
    devices: [],
    transport: "none",
    activeSerial: "",
    updatedAt: 0,
  };
}

let snapshot: DcMobileSidebarSnapshot = emptySnapshot();
let refreshChain: Promise<void> = Promise.resolve();
let actionChain: Promise<void> = Promise.resolve();
let activeRenderRequest: (() => void) | undefined;
let activitySubscription: (() => void) | undefined;

function notifyRepaint(): void {
  try {
    activeRenderRequest?.();
  } catch {
    /* repaint is best effort */
  }
}

function ensureActivitySubscription(): void {
  if (activitySubscription) return;
  activitySubscription = subscribeMobileActivity(() => notifyRepaint());
}

function safeLoadPrefs(deps: DcMobileSidebarDeps): DcMobileConnectionPrefs {
  try {
    return deps.loadPrefs();
  } catch {
    return { lastSerial: "", mode: "usb", lastWifiAddress: "", pairedHosts: [] };
  }
}

function transportOf(devices: readonly DcAdbDevice[]): DcMobileSidebarTransport {
  const kinds = new Set(devices.map((device) => classifyTransport(device.serial)));
  if (kinds.size === 0) return "none";
  if (kinds.size > 1) return "mixed";
  return kinds.has("wifi") ? "wifi" : "usb";
}

function readViewerPid(deps: DcMobileSidebarDeps, serial: string): number | undefined {
  try {
    return deps.getViewerPid(serial);
  } catch {
    return undefined;
  }
}

function readLastFrameAt(deps: DcMobileSidebarDeps, serial: string): number | undefined {
  try {
    return deps.getLastFrameAt(serial);
  } catch {
    return undefined;
  }
}

/**
 * Records the transitions that belong to the card itself (S3, S10): adb
 * becoming unavailable and a device that just started answering as `device`.
 * Routine refreshes stay silent so the timeline is not flooded.
 */
function recordSnapshotTransition(
  previous: DcMobileSidebarSnapshot,
  next: DcMobileSidebarSnapshot,
): void {
  if (previous.adbAvailable !== false && next.adbAvailable === false) {
    recordMobileActivity("error", "adb no disponible");
    return;
  }

  const known = new Set(previous.devices.map((device) => device.serial));
  for (const device of next.devices) {
    if (known.has(device.serial) || device.state !== "device") continue;
    recordMobileActivity("connect", "conectado (device)");
  }
}

async function performRefresh(deps: DcMobileSidebarDeps): Promise<void> {
  // Keep every adb call off the synchronous render path (S4).
  await Promise.resolve();

  const previous = snapshot;
  let next: DcMobileSidebarSnapshot;

  let adbAvailable = false;
  try {
    adbAvailable = deps.isAdbAvailable() === true;
  } catch {
    adbAvailable = false;
  }

  if (!adbAvailable) {
    next = { ...emptySnapshot(), adbAvailable: false, updatedAt: deps.now() };
  } else {
    let devices: readonly DcAdbDevice[] = [];
    let error: string | undefined;
    try {
      devices = deps.listDevices().map((device) => ({ ...device }));
    } catch (caught) {
      error = errorMessage(caught);
    }

    const prefs = safeLoadPrefs(deps);
    const activeSerial =
      devices.find((device) => device.state === "device")?.serial ||
      devices[0]?.serial ||
      prefs.lastSerial ||
      "";

    next = {
      adbAvailable: true,
      devices,
      transport: transportOf(devices),
      activeSerial,
      viewerPid: activeSerial ? readViewerPid(deps, activeSerial) : undefined,
      lastFrameAt: activeSerial ? readLastFrameAt(deps, activeSerial) : undefined,
      updatedAt: deps.now(),
      ...(error ? { error } : {}),
    };
  }

  snapshot = next;
  recordSnapshotTransition(previous, next);
  notifyRepaint();
}

function defaultDeps(): DcMobileSidebarDeps {
  return {
    isAdbAvailable: () => new DcAdbDriver().isAvailable(),
    listDevices: () => new DcAdbDriver().listDevices(),
    loadPrefs: () => loadConnectionPrefs(),
    reconnect: () => ensureConnection(createDcMobileSupervisedDriver()),
    disconnect: (serial: string) => disconnectViaAdb(serial),
    openViewer: (serial: string) => openLiveViewer(serial),
    getViewerPid: (serial: string) => getLiveViewerPid(serial),
    getLastFrameAt: (serial: string) => getLastInspection(serial)?.capturedAt,
    now: () => Date.now(),
  };
}

/** S5: `adb disconnect <serial>`, or `adb kill-server` when there is none. */
function disconnectViaAdb(serial: string): Promise<string> {
  const args = serial ? ["disconnect", serial] : ["kill-server"];

  return new Promise((resolve) => {
    try {
      execFile(
        "adb",
        args,
        { timeout: 10_000, maxBuffer: 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => {
          if (error) {
            resolve(String(stderr ?? "").trim() || errorMessage(error));
            return;
          }
          resolve(String(stdout ?? "").trim());
        },
      );
    } catch (caught) {
      resolve(errorMessage(caught));
    }
  });
}

/** Merges overrides over the production surface for tests and callers. */
export function resolveDcMobileSidebarDeps(
  overrides: Partial<DcMobileSidebarDeps> = {},
): DcMobileSidebarDeps {
  return { ...defaultDeps(), ...overrides };
}

/**
 * Takes a fresh device snapshot outside the render path (S4). Fire-and-forget
 * for the card; tests await this exported promise directly.
 */
export function refreshMobileSidebarSnapshot(
  deps: Partial<DcMobileSidebarDeps> = {},
): Promise<void> {
  const resolved = resolveDcMobileSidebarDeps(deps);
  const task = refreshChain.then(
    () => performRefresh(resolved),
    () => performRefresh(resolved),
  );
  refreshChain = task.catch(() => {});
  return task;
}

/** Awaits every snapshot refresh queued so far. */
export async function flushMobileSidebarSnapshot(): Promise<void> {
  let current: Promise<void>;
  do {
    current = refreshChain;
    await current;
  } while (current !== refreshChain);
}

function enqueueAction(deps: DcMobileSidebarDeps, task: () => Promise<void>): void {
  const run = async () => {
    await Promise.resolve();
    try {
      await task();
    } catch (error) {
      recordMobileActivity("error", errorMessage(error));
    }
    await refreshMobileSidebarSnapshot(deps);
    notifyRepaint();
  };

  actionChain = actionChain.then(run, run).catch(() => {});
}

/** Awaits the queued card actions and the snapshot refresh they trigger. */
export async function flushMobileSidebarActions(): Promise<void> {
  let current: Promise<void>;
  do {
    current = actionChain;
    await current;
  } while (current !== actionChain);
  await flushMobileSidebarSnapshot();
}

export function getDcMobileSidebarSnapshot(): DcMobileSidebarSnapshot {
  return snapshot;
}

/** Test seam: forgets the module-scope snapshot and the repaint target. */
export function resetDcMobileSidebarStateForTesting(): void {
  snapshot = emptySnapshot();
  activeRenderRequest = undefined;
  refreshChain = Promise.resolve();
  actionChain = Promise.resolve();
  activitySubscription?.();
  activitySubscription = undefined;
}

function resolveActionSerial(state: DcMobileSidebarSnapshot, deps: DcMobileSidebarDeps): string {
  if (state.activeSerial) return state.activeSerial;
  return safeLoadPrefs(deps).lastSerial.trim();
}

function formatDeviceCount(count: number): string {
  if (count <= 0) return "sin dispositivos";
  return count === 1 ? "1 dispositivo" : `${count} dispositivos`;
}

function formatTransport(transport: DcMobileSidebarTransport): string {
  switch (transport) {
    case "usb":
      return "USB";
    case "wifi":
      return "Wi-Fi";
    case "mixed":
      return "mixto";
    default:
      return "-";
  }
}

function formatViewer(state: DcMobileSidebarSnapshot, now: number): string {
  if (typeof state.viewerPid === "number") {
    return `abierto (pid ${state.viewerPid})`;
  }
  if (typeof state.lastFrameAt === "number") {
    const seconds = Math.max(0, Math.round((now - state.lastFrameAt) / 1000));
    return `último frame hace ${seconds}s`;
  }
  return "sin frames";
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

class DcMobileSidebarCardComponent implements Component {
  private readonly deps: DcMobileSidebarDeps;
  private readonly requestRender?: () => void;
  private currentCard?: DcSidebarCard;

  constructor(requestRender?: () => void, overrides: Partial<DcMobileSidebarDeps> = {}) {
    this.requestRender = requestRender;
    this.deps = resolveDcMobileSidebarDeps(overrides);

    activeRenderRequest = this.requestRender;
    ensureActivitySubscription();

    // S4: fire-and-forget mount snapshot; render never calls adb.
    void refreshMobileSidebarSnapshot(this.deps);
  }

  invalidate(): void {
    this.currentCard?.invalidate?.();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return this.currentCard?.handleMouse?.(event);
  }

  private reconnect(): void {
    enqueueAction(this.deps, async () => {
      recordMobileActivity("connect", "reconectando");
      const result = this.deps.reconnect();
      recordMobileActivity(result.ok ? "connect" : "error", result.message);
    });
  }

  private disconnectLink(): void {
    enqueueAction(this.deps, async () => {
      const serial = resolveActionSerial(snapshot, this.deps);
      recordMobileActivity(
        "disconnect",
        serial ? `desconectando ${serial}` : "desconectando servidor adb",
      );

      const output = String(await this.deps.disconnect(serial)).trim();
      if (output && /error|failed|cannot|unable|refused/i.test(output)) {
        recordMobileActivity("error", `vínculo: ${output}`);
        return;
      }
      recordMobileActivity("disconnect", "vínculo apagado");
    });
  }

  private openViewer(): void {
    enqueueAction(this.deps, async () => {
      const serial = resolveActionSerial(snapshot, this.deps);
      if (!serial) {
        recordMobileActivity("error", "sin dispositivo para el visor");
        return;
      }

      recordMobileActivity("viewer", "capturando pantalla");
      const result = this.deps.openViewer(serial);
      if (typeof result.pid === "number") {
        recordMobileActivity("viewer", `visor abierto (pid ${result.pid})`);
        return;
      }
      recordMobileActivity("viewer", result.message);
    });
  }

  private actionRow(
    label: string,
    hint: string,
    enabled: boolean,
    onClick: () => void,
    colors: { dim: (text: string) => string; bright: (text: string) => string; bold: (text: string) => string; white: (text: string) => string },
  ): DcJustifiedRow {
    const button = enabled
      ? colors.bright(colors.bold(`[${label}]`))
      : colors.dim(`[${label}]`);
    const hintText = enabled ? colors.white(hint) : colors.dim(hint);

    return new DcJustifiedRow(`  ${hintText}`, `${button} `, enabled ? onClick : undefined);
  }

  render(width: number): string[] {
    try {
      const bloodBright = (text: string) => `\x1b[38;2;255;51;51m${text}\x1b[0m`;
      const bloodSoft = (text: string) => `\x1b[38;2;255;128;128m${text}\x1b[0m`;
      const bloodWhite = (text: string) => `\x1b[38;2;255;204;204m${text}\x1b[0m`;
      const greenBright = (text: string) => `\x1b[38;2;46;204;113m${text}\x1b[0m`;
      const yellowBright = (text: string) => `\x1b[38;2;250;204;21m${text}\x1b[0m`;
      const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
      const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;

      const state = snapshot;
      const rows: Component[] = [];
      const divider = () => new DcJustifiedRow(`  ${dim("─".repeat(Math.max(10, width - 8)))}`, "");

      // ── Header: device count + dominant transport (S2) ──
      rows.push(
        new DcJustifiedRow(
          `  ${bloodBright(bold(formatDeviceCount(state.devices.length)))}`,
          `${bloodSoft(formatTransport(state.transport))} `,
        ),
      );

      if (state.adbAvailable === false) {
        rows.push(new DcJustifiedRow(`  ${bloodBright(bold("adb no disponible"))}`, ""));
      } else if (state.adbAvailable === null) {
        rows.push(new DcJustifiedRow(`  ${dim("adb: verificando…")}`, ""));
      }

      // ── One row per device: serial, state and model when adb reports it ──
      for (const device of state.devices) {
        const stateColor =
          device.state === "device"
            ? greenBright
            : device.state === "unauthorized"
              ? yellowBright
              : bloodSoft;
        const model = device.model && device.model !== "-" ? ` ${clip(device.model, 14)}` : "";

        rows.push(
          new DcJustifiedRow(
            `  ${bloodWhite(clip(device.serial, 24))}`,
            `${stateColor(device.state)}${dim(model)} `,
          ),
        );
      }

      rows.push(divider());

      // ── Live activity log (S3): newest lines that fit in the rail ──
      const activities = getMobileActivity();
      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft(bold("bitácora"))}`,
          `${dim(`${activities.length} ev`)} `,
        ),
      );

      const visible = activities.slice(-DC_MOBILE_CARD_ACTIVITY_LINES);
      if (visible.length === 0) {
        rows.push(new DcJustifiedRow(`  ${dim("sin eventos todavía")}`, ""));
      } else {
        for (const activity of visible) {
          const formatted = formatMobileActivity(activity);
          const time = formatted.slice(0, 8);
          const message = formatted.slice(9);
          rows.push(new DcJustifiedRow(`  ${dim(time)} ${bloodWhite(message)}`, ""));
        }
      }

      rows.push(divider());

      // ── Viewer status (S6): the image itself lives in the floating window ──
      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft("visor:")}`,
          `${bloodWhite(formatViewer(state, this.deps.now()))} `,
        ),
      );

      rows.push(divider());

      // ── Actions (S5, S9): mouse-only; disabled while adb is not usable ──
      const actionable = state.adbAvailable === true;
      const colors = { dim, bright: bloodBright, bold, white: bloodWhite };

      rows.push(
        this.actionRow("Reconectar", "↻ reconectar", actionable, () => this.reconnect(), colors),
      );
      rows.push(
        this.actionRow(
          "Apagar vínculo",
          "■ apagar vínculo",
          actionable,
          () => this.disconnectLink(),
          colors,
        ),
      );
      rows.push(
        this.actionRow("Abrir visor", "▣ abrir visor", actionable, () => this.openViewer(), colors),
      );

      this.currentCard = new DcSidebarCard({
        glyph: "📱",
        title: "MOBILE",
        titleRight: "supervisor",
        content: new DcVStack(rows),
        paddingX: 1,
      });

      return this.currentCard.render(width);
    } catch {
      // S9: render is defensive; a broken row must never tear down the rail.
      this.currentCard = undefined;
      return [truncateToWidth("📱 MOBILE · sin datos", Math.max(1, width), "")];
    }
  }
}

export function createDcMobileSidebarCard(
  requestRender?: () => void,
  deps: Partial<DcMobileSidebarDeps> = {},
): Component {
  return new DcMobileSidebarCardComponent(requestRender, deps);
}
