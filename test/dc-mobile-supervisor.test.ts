import test from "node:test";
import assert from "node:assert/strict";

import type { DcAdbDevice } from "../src/features/dc-mobile/core/dc-adb-driver.ts";
import {
  DC_MOBILE_USB_HELP,
  DC_MOBILE_USB_UNAUTHORIZED_MESSAGE,
  type DcMobileConnectionDriver,
  type DcMobileConnectionPrefs,
} from "../src/features/dc-mobile/core/dc-mobile-connection.ts";
import {
  DC_USBIPD_DEFAULT_PATH,
  discoverMdnsAddresses,
  ensureConnection,
  listUsbipdBusIds,
  parseMdnsServices,
  resolveUsbipdPath,
  startUsbAutoAttach,
} from "../src/features/dc-mobile/core/dc-mobile-supervisor.ts";

interface ConnectCall {
  address: string;
}

function prefs(patch: Partial<DcMobileConnectionPrefs> = {}): DcMobileConnectionPrefs {
  return {
    lastSerial: "",
    mode: "usb",
    lastWifiAddress: "",
    ...patch,
  };
}

function createFakeDriver(devices: DcAdbDevice[] = []): {
  driver: Pick<DcMobileConnectionDriver, "listDevices" | "connect">;
  calls: ConnectCall[];
} {
  const calls: ConnectCall[] = [];
  const driver: Pick<DcMobileConnectionDriver, "listDevices" | "connect"> = {
    listDevices: () => devices,
    connect(address: string) {
      calls.push({ address });
      return `connected to ${address}`;
    },
  };

  return { driver, calls };
}

const USB_DEVICE: DcAdbDevice = {
  serial: "RFCNB0MET4V",
  state: "device",
  model: "SM G781U1",
};

const WIFI_DEVICE: DcAdbDevice = {
  serial: "192.168.100.222:41779",
  state: "device",
  model: "SM G781U1",
};

test("dc-mobile supervisor: parseMdnsServices extracts connect services", () => {
  const output = [
    "List of discovered mdns services",
    "adb-RFCNB0MET4V-abc\t_adb-tls-connect._tcp\t192.168.100.222:41779",
    "",
  ].join("\n");

  assert.deepEqual(parseMdnsServices(output), ["192.168.100.222:41779"]);
});

test("dc-mobile supervisor: parseMdnsServices tolerates spaces, CRLF and blanks", () => {
  const output = [
    "List of discovered mdns services",
    "adb-phone    _adb-tls-connect._tcp    192.168.1.50:37000",
    "",
  ].join("\r\n");

  assert.deepEqual(parseMdnsServices(output), ["192.168.1.50:37000"]);
});

test("dc-mobile supervisor: parseMdnsServices ignores the header alone", () => {
  assert.deepEqual(parseMdnsServices("List of discovered mdns services\n\n"), []);
});

test("dc-mobile supervisor: parseMdnsServices excludes pairing entries", () => {
  const output = [
    "adb-RFCNB0MET4V-abc\t_adb-tls-pairing._tcp\t192.168.100.222:41780",
    "adb-RFCNB0MET4V-abc\t_adb-tls-connect._tcp\t192.168.100.222:41779",
  ].join("\n");

  assert.deepEqual(parseMdnsServices(output), ["192.168.100.222:41779"]);
});

test("dc-mobile supervisor: parseMdnsServices returns [] for empty output", () => {
  assert.deepEqual(parseMdnsServices(""), []);
});

test("dc-mobile supervisor: discoverMdnsAddresses uses the injected adb runner", () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const addresses = discoverMdnsAddresses({
    adbBin: "adb-test",
    execFn: (file, args) => {
      calls.push({ file, args });
      return "adb-x\t_adb-tls-connect._tcp\t10.0.0.5:5555\n";
    },
  });

  assert.deepEqual(addresses, ["10.0.0.5:5555"]);
  assert.deepEqual(calls, [{ file: "adb-test", args: ["mdns", "services"] }]);
});

test("dc-mobile supervisor: ensureConnection short-circuits an already connected device", () => {
  const { driver } = createFakeDriver([USB_DEVICE]);
  let permissionCalls = 0;
  let restartCalls = 0;

  const outcome = ensureConnection(driver, prefs({ mode: "usb" }), {
    ensurePermissions: () => {
      permissionCalls += 1;
      return { ready: [], failed: [] };
    },
    restartServer: () => {
      restartCalls += 1;
      return true;
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.serial, USB_DEVICE.serial);
  assert.equal(outcome.transport, "usb");
  assert.equal(permissionCalls, 0, "a connected device must not trigger repair");
  assert.equal(restartCalls, 0, "a connected device must not restart adb");
});

test("dc-mobile supervisor: ensureConnection reports a Wi-Fi device as wifi", () => {
  const { driver } = createFakeDriver([WIFI_DEVICE]);

  const outcome = ensureConnection(driver, prefs({ mode: "wifi" }));

  assert.equal(outcome.ok, true);
  assert.equal(outcome.serial, WIFI_DEVICE.serial);
  assert.equal(outcome.transport, "wifi");
});

test("dc-mobile supervisor: permission repair restarts adb only when a node is ready", () => {
  const { driver } = createFakeDriver();
  let restarts = 0;
  let ready: string[] = [];

  const deps = {
    ensurePermissions: () => ({ ready, failed: [] }),
    restartServer: () => {
      restarts += 1;
      return true;
    },
  };

  ensureConnection(driver, prefs({ mode: "usb" }), deps);
  assert.equal(restarts, 0, "no restart without a writable node");

  ready = ["/dev/bus/usb/001/007"];
  ensureConnection(driver, prefs({ mode: "usb" }), deps);
  assert.equal(restarts, 1, "a ready node requires the adb server restart");
});

test("dc-mobile supervisor: Wi-Fi fallback attempts adb connect exactly once", () => {
  const { driver, calls } = createFakeDriver();

  const outcome = ensureConnection(
    driver,
    prefs({ mode: "wifi", lastWifiAddress: "192.168.100.222:41779" }),
    {
      ensurePermissions: () => {
        throw new Error("Wi-Fi mode must not repair USB permissions");
      },
      restartServer: () => {
        throw new Error("Wi-Fi mode must not restart adb");
      },
    },
  );

  assert.equal(outcome.ok, true);
  assert.equal(outcome.serial, "192.168.100.222:41779");
  assert.equal(outcome.transport, "wifi");
  assert.deepEqual(calls, [{ address: "192.168.100.222:41779" }]);
});

test("dc-mobile supervisor: an unauthorized phone is a guided result", () => {
  const unauthorized: DcAdbDevice = {
    serial: "RFCNB0MET4V",
    state: "unauthorized",
    model: "SM G781U1",
  };
  const { driver } = createFakeDriver([unauthorized]);
  let restarts = 0;

  const outcome = ensureConnection(driver, prefs({ mode: "usb" }), {
    ensurePermissions: () => ({ ready: [], failed: [] }),
    restartServer: () => {
      restarts += 1;
      return true;
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.guided, true);
  assert.equal(outcome.serial, unauthorized.serial);
  assert.equal(outcome.message, DC_MOBILE_USB_UNAUTHORIZED_MESSAGE);
  assert.equal(restarts, 0);
});

test("dc-mobile supervisor: no USB device keeps the S11 guidance", () => {
  const { driver } = createFakeDriver();

  const outcome = ensureConnection(driver, prefs({ mode: "usb" }), {
    ensurePermissions: () => ({ ready: [], failed: [] }),
    restartServer: () => false,
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, DC_MOBILE_USB_HELP);
});

test("dc-mobile supervisor: listUsbipdBusIds picks Android vendor rows", () => {
  const output = [
    "Connected:",
    "BUSID  VID:PID    DEVICE                          STATE",
    "1-1    18d1:4ee7  Pixel 7                         Not shared",
    "2-2    046d:c52b  Logitech USB Receiver           Not shared",
    "3-1    04e8:6860  Samsung Galaxy S21              Shared",
    "",
  ].join("\n");

  const busIds = listUsbipdBusIds("/fake/usbipd.exe", { execFn: () => output });

  assert.deepEqual(busIds, ["1-1", "3-1"]);
});

test("dc-mobile supervisor: resolveUsbipdPath honors DC_USBIPD_PATH", () => {
  assert.equal(
    resolveUsbipdPath({ env: { DC_USBIPD_PATH: "/opt/usbipd" } }),
    "/opt/usbipd",
  );
  assert.equal(resolveUsbipdPath({ env: {} }), DC_USBIPD_DEFAULT_PATH);
});

test("dc-mobile supervisor: startUsbAutoAttach reports missing binary without throwing", () => {
  const result = startUsbAutoAttach("1-1", {
    exists: () => false,
    spawnFn: () => {
      throw new Error("spawn must not run when the binary is missing");
    },
  });

  assert.equal(result.started, false);
  assert.ok(result.message.length > 0);
});

test("dc-mobile supervisor: startUsbAutoAttach spawns detached and unrefs", () => {
  const spawned: Array<{ command: string; args: string[]; options: unknown }> = [];
  let unrefCalls = 0;

  const result = startUsbAutoAttach("7-7", {
    exists: () => true,
    spawnFn: (command, args, options) => {
      spawned.push({ command, args, options });
      return {
        unref: () => {
          unrefCalls += 1;
        },
        on: () => undefined,
      };
    },
  });

  assert.equal(result.started, true);
  assert.equal(unrefCalls, 1);
  assert.deepEqual(spawned[0]?.args, [
    "attach",
    "--wsl",
    "--auto-attach",
    "--busid",
    "7-7",
  ]);
  assert.deepEqual(spawned[0]?.options, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
});
