/**
 * USB permission handling for Android devices attached through usbipd-win.
 *
 * On WSL the device node created by `vhci_hcd` is owned by root:root, so the
 * unprivileged adb client cannot claim the ADB interface even when the device
 * is fully visible. Android platform-tools on a normal Linux host relies on
 * udev rules to widen those permissions; WSL does not ship them, and a system
 * wide rule file is outside this project's reach, so the fix is applied at
 * connection time on the exact nodes that belong to Android vendors.
 */

import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const USB_DEVICES_ROOT = "/sys/bus/usb/devices";
const USB_DEV_NODE_ROOT = "/dev/bus/usb";

/** Google (adb/accessory) and Samsung vendor ids. */
const ANDROID_VENDOR_IDS = new Set(["18d1", "04e8"]);

export interface UsbPermissionResult {
	/** Device nodes that were already writable or were fixed. */
	ready: string[];
	/** Device nodes that stayed read-only after the fix attempt. */
	failed: string[];
}

export interface UsbPermissionOptions {
	devicesRoot?: string;
	devNodeRoot?: string;
	/** Injectable for tests. */
	readSysfs?: (path: string) => string;
	/** Injectable for tests; performs the chmod. */
	chmod?: (node: string) => void;
}

function defaultReadSysfs(path: string): string {
	return readFileSync(path, "utf8").trim();
}

function defaultChmod(node: string): void {
	execFileSync("sudo", ["-n", "chmod", "a+rw", node], { stdio: "ignore" });
}

function isWritable(node: string): boolean {
	try {
		accessSync(node, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Lists device node paths (`/dev/bus/usb/BBB/DDD`) for every attached USB
 * device whose vendor id belongs to Android.
 */
export function findAndroidUsbNodes(options: UsbPermissionOptions = {}): string[] {
	const devicesRoot = options.devicesRoot ?? USB_DEVICES_ROOT;
	const devNodeRoot = options.devNodeRoot ?? USB_DEV_NODE_ROOT;
	const readSysfs = options.readSysfs ?? defaultReadSysfs;

	let entries: string[];
	try {
		entries = readdirSync(devicesRoot);
	} catch {
		return [];
	}

	const nodes: string[] = [];
	for (const entry of entries) {
		const base = `${devicesRoot}/${entry}`;
		let vendorId: string;
		try {
			vendorId = readSysfs(`${base}/idVendor`).toLowerCase();
		} catch {
			continue;
		}
		if (!ANDROID_VENDOR_IDS.has(vendorId)) continue;

		let busnum: string;
		let devnum: string;
		try {
			busnum = readSysfs(`${base}/busnum`);
			devnum = readSysfs(`${base}/devnum`);
		} catch {
			continue;
		}
		if (!busnum || !devnum) continue;

		const node = `${devNodeRoot}/${busnum.padStart(3, "0")}/${devnum.padStart(3, "0")}`;
		if (!nodes.includes(node)) nodes.push(node);
	}

	return nodes;
}

/**
 * Makes every attached Android USB device node usable by the current user.
 * Best effort by design: it never throws, and reports what it could not fix so
 * the caller can surface an actionable message instead of a silent failure.
 */
export function ensureAndroidUsbWritable(options: UsbPermissionOptions = {}): UsbPermissionResult {
	const chmod = options.chmod ?? defaultChmod;
	const result: UsbPermissionResult = { ready: [], failed: [] };

	for (const node of findAndroidUsbNodes(options)) {
		if (isWritable(node)) {
			result.ready.push(node);
			continue;
		}
		try {
			chmod(node);
		} catch {
			// Fall through to the writability check below.
		}
		if (isWritable(node)) {
			result.ready.push(node);
		} else {
			result.failed.push(node);
		}
	}

	return result;
}

export const DC_MOBILE_USB_PERMISSION_HELP =
	"USB visible pero sin permisos de escritura. Ejecutá con sudo: chmod a+rw /dev/bus/usb/<bus>/<dev>, o concedé sudo sin contraseña para que dc-mobile lo haga solo.";

/**
 * The adb server caches the failed open of a device node, so widening the
 * permissions is only visible after the server is restarted. This is the
 * difference between `no permissions (user ... not in the plugdev group)` and
 * a usable transport.
 */
export function restartAdbServer(
	execFn: (args: string[]) => void = (args) => {
		execFileSync("adb", args, { stdio: "ignore" });
	},
): boolean {
	try {
		execFn(["kill-server"]);
	} catch {
		// A missing server is not a failure for the caller.
	}
	try {
		execFn(["start-server"]);
		return true;
	} catch {
		return false;
	}
}
