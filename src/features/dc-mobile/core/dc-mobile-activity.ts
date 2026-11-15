/**
 * In-memory activity log for the dc-mobile sidebar card (S3, S4, S8).
 *
 * The log lives in module scope so the sidebar tab can be destroyed and
 * rebuilt without losing the phone timeline. It is purely in-memory: no
 * timers, no filesystem access, no adb calls, and no view imports. The card
 * repaints by subscribing to this module instead of polling.
 */

export type DcMobileActivityKind =
  | "connect"
  | "pair"
  | "discover"
  | "inspect"
  | "action"
  | "viewer"
  | "disconnect"
  | "error";

export interface DcMobileActivity {
  at: number;
  kind: DcMobileActivityKind;
  message: string;
}

/** Hard cap from S3: the oldest events are dropped first. */
export const DC_MOBILE_ACTIVITY_LIMIT = 200;

type DcMobileActivityListener = (activity: DcMobileActivity) => void;

let activityLog: DcMobileActivity[] = [];
let listeners = new Set<DcMobileActivityListener>();

/** Returns a frozen snapshot view so callers cannot mutate the log. */
function snapshot(): readonly DcMobileActivity[] {
  return Object.freeze(activityLog.slice());
}

/** Copies one record so the live log and the snapshot never share objects. */
function freezeRecord(activity: DcMobileActivity): DcMobileActivity {
  return Object.freeze({ ...activity });
}

function emit(activity: DcMobileActivity): void {
  for (const listener of [...listeners]) {
    try {
      listener(activity);
    } catch {
      // A broken subscriber must not starve the remaining subscribers.
    }
  }
}

/**
 * Appends one event and returns the resulting record.
 *
 * Contract for a blank message: nothing is appended and no listener runs. The
 * newest stored event is returned instead, so callers can keep using the
 * return value; when the log is empty a detached placeholder carrying the
 * rejected `at` is returned and the log stays empty.
 */
export function recordMobileActivity(
  kind: DcMobileActivityKind,
  message: string,
  at: number = Date.now(),
): DcMobileActivity {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    const previous = activityLog[activityLog.length - 1];
    return previous ?? { at, kind, message: "" };
  }

  const activity = freezeRecord({ at, kind, message: trimmed });
  activityLog.push(activity);
  if (activityLog.length > DC_MOBILE_ACTIVITY_LIMIT) {
    activityLog = activityLog.slice(activityLog.length - DC_MOBILE_ACTIVITY_LIMIT);
  }

  emit(activity);
  return activity;
}

/** Oldest first, newest last; the returned array is frozen. */
export function getMobileActivity(): readonly DcMobileActivity[] {
  return snapshot();
}

/**
 * Formats one event as `HH:MM:SS <message>` in local time using plain zero
 * padding, so the output never depends on the process locale.
 */
export function formatMobileActivity(activity: DcMobileActivity): string {
  const date = new Date(activity.at);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds} ${activity.message}`;
}

/**
 * Subscribes to newly recorded events. Returns an idempotent unsubscribe
 * function; unsubscribing twice is safe.
 */
export function subscribeMobileActivity(listener: DcMobileActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drops every stored event and detaches all listeners. */
export function clearMobileActivity(): void {
  activityLog = [];
  listeners = new Set<DcMobileActivityListener>();
}
