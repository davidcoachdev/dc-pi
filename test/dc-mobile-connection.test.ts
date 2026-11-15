import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  classifyTransport,
  connectUsb,
  connectWifi,
  createDcMobileConnectionDriver,
  DC_MOBILE_USB_HELP,
  DC_MOBILE_USB_UNAUTHORIZED_MESSAGE,
  isValidWifiAddress,
  listUsbDevices,
  loadConnectionPrefs,
  pairWifi,
  saveConnectionPrefs,
  type DcMobileConnectionDriver,
} from "../src/features/dc-mobile/core/dc-mobile-connection.ts";
import type {
  DcAdbDevice,
  DcAdbExecFn,
  DcAdbExecOptions,
} from "../src/features/dc-mobile/core/dc-adb-driver.ts";
import {
  DC_MOBILE_CONNECT_OPTIONS,
  DcMobileConnectWizard,
  type DcMobileConnectResult,
} from "../src/features/dc-mobile/views/dc-mobile-connect-modal.ts";
import type { DcMobileAdbRunner } from "../src/features/dc-mobile/core/dc-mobile-async-connection.ts";
import {
  ensureAndroidUsbWritable,
  findAndroidUsbNodes,
  restartAdbServer,
  type UsbPermissionOptions,
} from "../src/features/dc-mobile/core/dc-usb-permissions.ts";

interface ConnectionCall {
  kind: "connect" | "pair";
  address: string;
  code?: string;
}

interface FakeDriverOptions {
  devices?: DcAdbDevice[];
  available?: boolean;
  connectOutput?: string;
  pairOutput?: string;
  connectError?: unknown;
  pairError?: unknown;
}

function createFakeDriver(options: FakeDriverOptions = {}): {
  driver: DcMobileConnectionDriver;
  calls: ConnectionCall[];
} {
  const calls: ConnectionCall[] = [];

  const driver: DcMobileConnectionDriver = {
    isAvailable: () => options.available ?? true,
    listDevices: () => options.devices ?? [],
    connect(address: string) {
      calls.push({ kind: "connect", address });
      if (options.connectError) throw options.connectError;
      return options.connectOutput ?? `connected to ${address}`;
    },
    pair(address: string, code: string) {
      calls.push({ kind: "pair", address, code });
      if (options.pairError) throw options.pairError;
      return options.pairOutput ?? `Successfully paired to ${address}`;
    },
  };

  return { driver, calls };
}

const USB_DEVICE: DcAdbDevice = {
  serial: "R58M123ABC",
  state: "device",
  model: "SM G991B",
};

const WIFI_DEVICE: DcAdbDevice = {
  serial: "192.168.100.222:41779",
  state: "device",
  model: "SM G781U1",
};

const UNAUTHORIZED_USB: DcAdbDevice = {
  serial: "R58M999XYZ",
  state: "unauthorized",
  model: "SM G991B",
};

interface FakeSysfsEntry {
  vendor: string;
  bus: string;
  dev: string;
}

function createSysfsDevices(
  t: TestContext,
  entries: Record<string, FakeSysfsEntry>,
): Pick<UsbPermissionOptions, "devicesRoot" | "readSysfs"> {
  const devicesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dc-mobile-usb-sysfs-"));
  t.after(() => fs.rmSync(devicesRoot, { recursive: true, force: true }));

  for (const name of Object.keys(entries)) {
    fs.mkdirSync(path.join(devicesRoot, name), { recursive: true });
  }

  const readSysfs = (filePath: string): string => {
    const [entry, field] = path.relative(devicesRoot, filePath).split(path.sep);
    const data = entries[entry!];

    if (!data) throw new Error(`unexpected sysfs path: ${filePath}`);
    if (field === "idVendor") return data.vendor;
    if (field === "busnum") return data.bus;
    if (field === "devnum") return data.dev;
    throw new Error(`unexpected sysfs field: ${filePath}`);
  };

  return { devicesRoot, readSysfs };
}

function createDevNodeRoot(t: TestContext): string {
  const devNodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dc-mobile-usb-dev-"));
  t.after(() => fs.rmSync(devNodeRoot, { recursive: true, force: true }));
  return devNodeRoot;
}

test("dc-mobile connection: classifyTransport uses ':' as the wifi marker", () => {
  assert.equal(classifyTransport("emulator-5554"), "usb");
  assert.equal(classifyTransport("R58M123ABC"), "usb");
  assert.equal(classifyTransport("192.168.100.222:41779"), "wifi");
  assert.equal(classifyTransport("device.local:37000"), "wifi");
  assert.equal(classifyTransport(""), "usb");
});

test("dc-mobile connection: listUsbDevices keeps only authorized serials without ':'", () => {
  const { driver } = createFakeDriver({
    devices: [USB_DEVICE, WIFI_DEVICE, UNAUTHORIZED_USB],
  });

  assert.deepEqual(listUsbDevices(driver), [USB_DEVICE]);
});

test("dc-mobile connection: listUsbDevices returns an empty list when nothing is plugged", () => {
  const { driver } = createFakeDriver();

  assert.deepEqual(listUsbDevices(driver), []);
});

test("dc-mobile connection: isValidWifiAddress accepts IPv4/hostname with a valid port", () => {
  const valid = [
    "192.168.100.222:41779",
    "10.0.0.1:1",
    "127.0.0.1:65535",
    "localhost:5555",
    "my-phone.lan:8080",
    "device-1.local:37000",
    " 192.168.1.5:5555 ",
  ];

  for (const address of valid) {
    assert.equal(isValidWifiAddress(address), true, `${address} should be valid`);
  }
});

test("dc-mobile connection: isValidWifiAddress rejects malformed host and port", () => {
  const invalid = [
    "",
    "   ",
    "192.168.1.1",
    ":5555",
    "192.168.1.1:",
    "192.168.1.1:0",
    "192.168.1.1:65536",
    "192.168.1.1:99999",
    "192.168.1.1:abc",
    "192.168.1.1:12.5",
    "999.1.1.1:5555",
    "192.168.1:5555",
    "192.168.1.1.1:5555",
    "host:5555:1",
    "http://host:5555",
    "host name:5555",
    "host:-1",
    "host_underscore:5555",
    "host:055536",
  ];

  for (const address of invalid) {
    assert.equal(isValidWifiAddress(address), false, `${address} should be invalid`);
  }
});

test("dc-mobile connection: USB help message matches S11 exactly", () => {
  assert.equal(
    DC_MOBILE_USB_HELP,
    "No hay dispositivos USB visibles. En WSL el cable requiere usbipd-win: winget install dorssel.usbipd-win, luego usbipd bind --busid <BUSID> y usbipd attach --wsl --busid <BUSID>.",
  );
});

test("dc-mobile connection: connectWifi connects and reports the serial", () => {
  const { driver, calls } = createFakeDriver();

  const outcome = connectWifi(driver, "192.168.100.222:41779");

  assert.deepEqual(calls, [
    { kind: "connect", address: "192.168.100.222:41779" },
  ]);
  assert.deepEqual(outcome, {
    ok: true,
    serial: "192.168.100.222:41779",
    message: "connected to 192.168.100.222:41779",
  });
});

test("dc-mobile connection: connectWifi reports adb errors verbatim without throwing", () => {
  const failed = createFakeDriver({
    connectOutput: "failed to connect to '192.168.1.5:5555': Connection refused",
  });
  const throwing = createFakeDriver({ connectError: new Error("adb falló (connect)") });

  assert.deepEqual(connectWifi(failed.driver, "192.168.1.5:5555"), {
    ok: false,
    message: "failed to connect to '192.168.1.5:5555': Connection refused",
  });
  assert.deepEqual(connectWifi(throwing.driver, "192.168.1.5:5555"), {
    ok: false,
    message: "adb falló (connect)",
  });
});

test("dc-mobile connection: a rejected address performs no adb call", () => {
  const { driver, calls } = createFakeDriver();

  for (const address of ["", "192.168.1.5", "192.168.1.5:70000", "host:abc"]) {
    assert.equal(connectWifi(driver, address).ok, false);
    assert.equal(pairWifi(driver, address, "123456").ok, false);
  }

  assert.deepEqual(calls, []);
});

test("dc-mobile connection: pairWifi validates the 6-digit code before calling adb", () => {
  const { driver, calls } = createFakeDriver();

  for (const code of ["", "12345", "1234567", "abcdef", "12 34 56"]) {
    const outcome = pairWifi(driver, "192.168.1.5:37000", code);
    assert.equal(outcome.ok, false, `${code} should be rejected`);
  }

  assert.deepEqual(calls, []);
});

test("dc-mobile connection: pairWifi pairs and then connects on success", () => {
  const { driver, calls } = createFakeDriver();

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456");

  assert.deepEqual(calls, [
    { kind: "pair", address: "192.168.1.5:37000", code: "123456" },
    { kind: "connect", address: "192.168.1.5:37000" },
  ]);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.paired, true);
  assert.equal(outcome.serial, "192.168.1.5:37000");
});

test("dc-mobile connection: pairWifi stops before connect when pairing fails", () => {
  const { driver, calls } = createFakeDriver({
    pairOutput: "Failed: Wrong password or connection was dropped.",
  });

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456");

  assert.deepEqual(calls, [
    { kind: "pair", address: "192.168.1.5:37000", code: "123456" },
  ]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.paired, undefined);
  assert.equal(
    outcome.message,
    "Failed: Wrong password or connection was dropped.",
  );
});

test("dc-mobile connection: pairWifi explains the closed pairing port when connect fails", () => {
  const { driver } = createFakeDriver({
    connectOutput: "failed to connect to '192.168.1.5:37000': Connection refused",
  });

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456");

  assert.equal(outcome.ok, false);
  assert.equal(outcome.paired, true);
  assert.match(outcome.message, /puerto de vinculación se cierra/);
  assert.match(outcome.message, /pantalla principal/);
});

test("dc-mobile connection: prefs roundtrip uses an atomic write under the given path", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-mobile-connection-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const configPath = path.join(dir, "nested", "dc-mobile.json");

  assert.deepEqual(loadConnectionPrefs(configPath), {
    lastSerial: "",
    mode: "usb",
    lastWifiAddress: "",
  });

  const saved = saveConnectionPrefs(
    {
      lastSerial: "192.168.100.222:41779",
      mode: "wifi",
      lastWifiAddress: "192.168.100.222:41779",
    },
    configPath,
  );

  assert.deepEqual(saved, {
    lastSerial: "192.168.100.222:41779",
    mode: "wifi",
    lastWifiAddress: "192.168.100.222:41779",
  });
  assert.deepEqual(loadConnectionPrefs(configPath), saved);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(configPath, "utf8")),
    saved,
  );
  assert.deepEqual(
    fs.readdirSync(path.dirname(configPath)).filter((name) => name.endsWith(".tmp")),
    [],
    "the atomic write must not leave temp files behind",
  );
});

test("dc-mobile connection: saveConnectionPrefs merges without dropping previous values", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-mobile-connection-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const configPath = path.join(dir, "dc-mobile.json");

  saveConnectionPrefs(
    { mode: "wifi", lastWifiAddress: "192.168.1.5:5555" },
    configPath,
  );
  saveConnectionPrefs({ lastSerial: "192.168.1.5:5555" }, configPath);

  assert.deepEqual(loadConnectionPrefs(configPath), {
    lastSerial: "192.168.1.5:5555",
    mode: "wifi",
    lastWifiAddress: "192.168.1.5:5555",
  });
});

test("dc-mobile connection: corrupt or partial JSON falls back to defaults", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-mobile-connection-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const configPath = path.join(dir, "dc-mobile.json");

  fs.writeFileSync(configPath, "{ not valid json", "utf8");
  assert.deepEqual(loadConnectionPrefs(configPath), {
    lastSerial: "",
    mode: "usb",
    lastWifiAddress: "",
  });

  fs.writeFileSync(
    configPath,
    JSON.stringify({ lastSerial: 42, mode: "carrier-pigeon", lastWifiAddress: null }),
    "utf8",
  );
  assert.deepEqual(loadConnectionPrefs(configPath), {
    lastSerial: "",
    mode: "usb",
    lastWifiAddress: "",
  });
});

test("dc-mobile connection: production driver runs adb connect/pair with explicit timeouts", () => {
  interface RecordedCall {
    file: string;
    args: string[];
    options: DcAdbExecOptions;
  }

  const calls: RecordedCall[] = [];
  const execFn: DcAdbExecFn = (file, args, options) => {
    calls.push({ file, args, options });
    return args[0] === "pair" ? "Successfully paired" : "connected";
  };

  const driver = createDcMobileConnectionDriver({ execFn, adbBin: "adb-test" });

  driver.connect("192.168.1.5:5555");
  driver.pair("192.168.1.5:37000", "123456");

  assert.deepEqual(calls[0]?.args, ["connect", "192.168.1.5:5555"]);
  assert.equal(calls[0]?.file, "adb-test");
  assert.ok(calls[0]!.options.timeout >= 20_000);

  assert.deepEqual(calls[1]?.args, ["pair", "192.168.1.5:37000", "123456"]);
  assert.ok(calls[1]!.options.timeout >= 30_000);
});

test("dc-usb-permissions: findAndroidUsbNodes keeps Android vendors and zero-pads bus/dev", (t) => {
  const sysfs = createSysfsDevices(t, {
    "1-1": { vendor: "18d1", bus: "1", dev: "7" },
    "1-2": { vendor: "04E8", bus: "2", dev: "13" },
    "1-3": { vendor: "413c", bus: "3", dev: "4" },
  });
  const devNodeRoot = createDevNodeRoot(t);

  const nodes = findAndroidUsbNodes({
    devicesRoot: sysfs.devicesRoot,
    devNodeRoot,
    readSysfs: sysfs.readSysfs,
  });

  assert.deepEqual(nodes.sort(), [
    path.join(devNodeRoot, "001", "007"),
    path.join(devNodeRoot, "002", "013"),
  ].sort());
  assert.ok(!nodes.some((node) => node.includes("/003/")), "non-Android vendor must be rejected");
});

test("dc-usb-permissions: findAndroidUsbNodes skips entries without vendor or bus/dev", (t) => {
  const sysfs = createSysfsDevices(t, {
    "1-1": { vendor: "18d1", bus: "1", dev: "7" },
  });
  const devNodeRoot = createDevNodeRoot(t);
  const readSysfs = (filePath: string): string => {
    if (filePath.endsWith("/idVendor")) return "18d1";
    if (filePath.endsWith("/busnum")) return "1";
    if (filePath.endsWith("/devnum")) return "";
    throw new Error(`unexpected sysfs path: ${filePath}`);
  };

  assert.deepEqual(
    findAndroidUsbNodes({
      devicesRoot: sysfs.devicesRoot,
      devNodeRoot,
      readSysfs,
    }),
    [],
  );
});

test("dc-usb-permissions: ensureAndroidUsbWritable skips chmod for an already-writable node", (t) => {
  const sysfs = createSysfsDevices(t, {
    "1-1": { vendor: "18d1", bus: "1", dev: "7" },
  });
  const devNodeRoot = createDevNodeRoot(t);
  const node = path.join(devNodeRoot, "001", "007");
  fs.mkdirSync(path.dirname(node), { recursive: true });
  fs.writeFileSync(node, "");
  fs.chmodSync(node, 0o666);

  const chmodCalls: string[] = [];
  const result = ensureAndroidUsbWritable({
    devicesRoot: sysfs.devicesRoot,
    devNodeRoot,
    readSysfs: sysfs.readSysfs,
    chmod: (target) => {
      chmodCalls.push(target);
      throw new Error("chmod must not run for a writable node");
    },
  });

  assert.deepEqual(result, { ready: [node], failed: [] });
  assert.deepEqual(chmodCalls, []);
});

test("dc-usb-permissions: ensureAndroidUsbWritable reports a failed chmod", (t) => {
  const sysfs = createSysfsDevices(t, {
    "1-1": { vendor: "18d1", bus: "1", dev: "7" },
  });
  const devNodeRoot = createDevNodeRoot(t);
  const node = path.join(devNodeRoot, "001", "007");

  const chmodCalls: string[] = [];
  const result = ensureAndroidUsbWritable({
    devicesRoot: sysfs.devicesRoot,
    devNodeRoot,
    readSysfs: sysfs.readSysfs,
    chmod: (target) => {
      chmodCalls.push(target);
      throw new Error("EPERM: operation not permitted");
    },
  });

  assert.deepEqual(result, { ready: [], failed: [node] });
  assert.deepEqual(chmodCalls, [node]);
});

test("dc-usb-permissions: ensureAndroidUsbWritable marks a fixed node as ready", (t) => {
  const sysfs = createSysfsDevices(t, {
    "1-1": { vendor: "18d1", bus: "1", dev: "7" },
  });
  const devNodeRoot = createDevNodeRoot(t);
  const node = path.join(devNodeRoot, "001", "007");

  const result = ensureAndroidUsbWritable({
    devicesRoot: sysfs.devicesRoot,
    devNodeRoot,
    readSysfs: sysfs.readSysfs,
    chmod: (target) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "");
      fs.chmodSync(target, 0o666);
    },
  });

  assert.deepEqual(result, { ready: [node], failed: [] });
});

test("dc-usb-permissions: restartAdbServer returns false when start-server fails", () => {
  const calls: string[][] = [];

  const ok = restartAdbServer((args) => {
    calls.push(args);
    if (args[0] === "start-server") throw new Error("adb missing");
  });

  assert.equal(ok, false);
  assert.deepEqual(calls, [["kill-server"], ["start-server"]]);
});

test("dc-usb-permissions: restartAdbServer returns true when both calls succeed", () => {
  const calls: string[][] = [];

  const ok = restartAdbServer((args) => {
    calls.push(args);
  });

  assert.equal(ok, true);
  assert.deepEqual(calls, [["kill-server"], ["start-server"]]);
});

test("dc-usb-permissions: restartAdbServer tolerates a failing kill-server", () => {
  const ok = restartAdbServer((args) => {
    if (args[0] === "kill-server") throw new Error("no server");
  });

  assert.equal(ok, true);
});

test("dc-mobile connection: connectUsb restarts adb only when permissions became ready", () => {
  let restarts = 0;
  const driver = { listDevices: () => [USB_DEVICE] };

  const first = connectUsb(driver, {
    ensurePermissions: () => ({ ready: ["/dev/bus/usb/001/007"], failed: [] }),
    restartServer: () => {
      restarts += 1;
      return true;
    },
  });

  assert.equal(restarts, 1);
  assert.equal(first.ok, true);
  assert.equal(first.serial, USB_DEVICE.serial);

  restarts = 0;
  const second = connectUsb(driver, {
    ensurePermissions: () => ({ ready: [], failed: [] }),
    restartServer: () => {
      restarts += 1;
      return true;
    },
  });

  assert.equal(restarts, 0, "no restart without a writable node");
  assert.equal(second.ok, true);
});

test("dc-mobile connection: connectUsb reports an unauthorized phone as a guided step", () => {
  const outcome = connectUsb(
    { listDevices: () => [{ ...USB_DEVICE, state: "unauthorized" }] },
    {
      ensurePermissions: () => ({ ready: [], failed: [] }),
      restartServer: () => {
        throw new Error("restart must not run without ready nodes");
      },
    },
  );

  assert.equal(outcome.ok, false);
  assert.equal(outcome.guided, true);
  assert.equal(outcome.serial, USB_DEVICE.serial);
  assert.equal(
    outcome.message,
    'El celular rechazó la huella RSA. Aceptá "Permitir depuración USB" en la pantalla del teléfono y reintentá.',
  );
});

test("dc-mobile connection: connectUsb prefers the permission help over the generic USB help", () => {
  const outcome = connectUsb(
    { listDevices: () => [] },
    {
      ensurePermissions: () => ({ ready: [], failed: ["/dev/bus/usb/001/007"] }),
      restartServer: () => false,
    },
  );

  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /USB visible pero sin permisos de escritura/);
});

test("dc-mobile connection: connectUsb keeps the S11 help when no Android node is attached", () => {
  const outcome = connectUsb(
    { listDevices: () => [] },
    {
      ensurePermissions: () => ({ ready: [], failed: [] }),
      restartServer: () => false,
    },
  );

  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, DC_MOBILE_USB_HELP);
});

interface DiscoveryDriverOptions {
  discover?: () => string[];
  refusedAddresses?: string[];
}

/** Pair succeeds, the pairing port always refuses, discovery answers. */
function createDiscoveryDriver(options: DiscoveryDriverOptions = {}) {
  const connects: string[] = [];
  const refused = new Set(options.refusedAddresses ?? ["192.168.1.5:37000"]);

  const driver = {
    isAvailable: () => true,
    listDevices: () => [],
    connect(address: string): string {
      connects.push(address);
      if (refused.has(address)) {
        return `failed to connect to '${address}': Connection refused`;
      }
      return `connected to ${address}`;
    },
    pair: (address: string) => `Successfully paired to ${address}`,
    ...(options.discover ? { discover: options.discover } : {}),
  };

  return { driver, connects };
}

test("dc-mobile connection: pairWifi connects to the mDNS port after pairing closes", () => {
  const { driver, connects } = createDiscoveryDriver({
    discover: () => ["192.168.1.5:41000"],
  });

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456");

  assert.deepEqual(connects, ["192.168.1.5:37000", "192.168.1.5:41000"]);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.serial, "192.168.1.5:41000");
  assert.match(outcome.message, /mDNS/);
  assert.equal(outcome.paired, true);
});

test("dc-mobile connection: pairWifi ignores discovered endpoints on another host", () => {
  const { driver, connects } = createDiscoveryDriver({
    discover: () => ["192.168.1.9:41000", "192.168.1.5:41000:extra"],
  });

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456");

  assert.deepEqual(connects, ["192.168.1.5:37000"]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.paired, true);
  assert.match(outcome.message, /pantalla principal/);
});

test("dc-mobile connection: pairWifi survives a discovery failure and keeps the manual prompt", () => {
  const { driver } = createDiscoveryDriver({
    discover: () => {
      throw new Error("adb mdns services unavailable");
    },
  });

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456");

  assert.equal(outcome.ok, false);
  assert.equal(outcome.paired, true);
  assert.match(outcome.message, /pantalla principal/);
});

test("dc-mobile connection: pairWifi falls back to the last working address when mDNS is silent", () => {
  const { driver, connects } = createDiscoveryDriver({
    discover: () => [],
    refusedAddresses: ["192.168.1.5:37000"],
  });

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456", "192.168.1.5:41000");

  assert.deepEqual(connects, ["192.168.1.5:37000", "192.168.1.5:41000"]);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.serial, "192.168.1.5:41000");
  assert.match(outcome.message, /última dirección conocida/);
});

test("dc-mobile connection: pairWifi never reuses a saved address from another host", () => {
  const { driver, connects } = createDiscoveryDriver({
    discover: () => [],
  });

  const outcome = pairWifi(driver, "192.168.1.5:37000", "123456", "192.168.1.9:41000");

  assert.deepEqual(connects, ["192.168.1.5:37000"]);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.paired, true);
  assert.match(outcome.message, /pantalla principal/);
});

interface WizardHarness {
  wizard: DcMobileConnectWizard;
  results: DcMobileConnectResult[];
  /** Every adb argument list the wizard asked the runner to execute. */
  adbCalls: string[][];
  renderText(): string;
  type(text: string): void;
}

interface WizardRunnerOptions {
  /** Initial connect attempts that fail before the fake adb starts accepting. */
  connectFailures?: number;
  pairOutput?: string;
}

/** Lets the wizard's async run settle before the assertions. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createWizard(options: WizardRunnerOptions = {}): WizardHarness {
  const results: WizardHarness["results"] = [];
  const adbCalls: string[][] = [];
  let remainingFailures = options.connectFailures ?? 0;

  const runner: DcMobileAdbRunner = async (args, log) => {
    adbCalls.push([...args]);
    log(`adb ${args.join(" ")}`);

    if (args[0] === "connect") {
      const address = args[1]!;
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return {
          ok: false,
          output: `failed to connect to '${address}': Connection refused`,
        };
      }
      return { ok: true, output: `connected to ${address}` };
    }

    return {
      ok: true,
      output: options.pairOutput ?? `Successfully paired to ${args[1]}`,
    };
  };

  const driver = {
    isAvailable: () => true,
    listDevices: () => [],
    connect: () => {
      throw new Error("the wizard must use the async runner");
    },
    pair: () => {
      throw new Error("the wizard must use the async runner");
    },
    discover: () => [],
  };

  const wizard = new DcMobileConnectWizard({
    driver: driver as never,
    prefs: { mode: "usb", lastSerial: "", lastWifiAddress: "" } as never,
    theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s } as never,
    done: (result) => results.push(result),
    requestRender: () => {},
    runner,
  });

  return {
    wizard,
    results,
    adbCalls,
    renderText: () => wizard.render(60).join("\n"),
    type(text: string) {
      for (const char of text) wizard.handleInput(char);
    },
  };
}

test("dc-mobile wizard: S1 has a single Wi-Fi path with no pairing option", () => {
  assert.equal(DC_MOBILE_CONNECT_OPTIONS.length, 3);
  assert.deepEqual(
    DC_MOBILE_CONNECT_OPTIONS.map((option) => option.label),
    ["USB · detectar dispositivo", "Wi-Fi · conectar", "Cancelar"],
  );
  assert.deepEqual(
    DC_MOBILE_CONNECT_OPTIONS.map((option) => option.id),
    ["usb", "wifi", "cancel"],
  );
  assert.ok(
    !DC_MOBILE_CONNECT_OPTIONS.some((option) => (option.id as string) === "pair"),
    "no separate pairing option may be offered",
  );
});

test("dc-mobile wizard: S3 a successful connect skips pairing and closes ok", async () => {
  const h = createWizard();

  h.wizard.handleInput("\u001b[B");
  h.wizard.handleInput("\r");
  h.type("192.168.1.5:44523");
  h.wizard.handleInput("\r");
  await settle();

  assert.deepEqual(h.adbCalls, [["connect", "192.168.1.5:44523"]]);
  assert.equal(h.results.length, 1);
  assert.deepEqual(h.results[0], {
    ok: true,
    mode: "wifi",
    serial: "192.168.1.5:44523",
    lastWifiAddress: "192.168.1.5:44523",
    message: "Conectado a 192.168.1.5:44523.",
  });
});

test("dc-mobile wizard: S4/S7 a failed connect asks URL+code and retries the main address", async () => {
  const h = createWizard({ connectFailures: 1 });

  h.wizard.handleInput("\u001b[B");
  h.wizard.handleInput("\r");
  h.type("192.168.1.5:44523");
  h.wizard.handleInput("\r");
  await settle();

  assert.equal(h.results.length, 0, "el wizard debe seguir abierto pidiendo vinculación");
  const pairingScreen = h.renderText();
  assert.match(pairingScreen, /IP:puerto del diálogo de vinculación/);
  assert.match(pairingScreen, /Código de 6 dígitos/);
  assert.match(pairingScreen, /192\.168\.1\.5:/, "precarga el host de vinculación");

  h.type("37000");
  h.wizard.handleInput("\t");
  h.type("123456");
  h.wizard.handleInput("\r");
  await settle();

  assert.deepEqual(h.adbCalls, [
    ["connect", "192.168.1.5:44523"],
    ["pair", "192.168.1.5:37000", "123456"],
    ["connect", "192.168.1.5:44523"],
  ]);
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0]?.ok, true);
  assert.equal(h.results[0]?.serial, "192.168.1.5:44523");
  assert.equal(h.results[0]?.message, "Conectado a 192.168.1.5:44523.");
});

test("dc-mobile wizard: S6 a wrong code keeps the pairing screen with values and error", async () => {
  const h = createWizard({
    connectFailures: 1,
    pairOutput: "Failed: Wrong password or connection was dropped.",
  });

  h.wizard.handleInput("\u001b[B");
  h.wizard.handleInput("\r");
  h.type("192.168.1.5:44523");
  h.wizard.handleInput("\r");
  await settle();

  h.type("37000");
  h.wizard.handleInput("\t");
  h.type("123456");
  h.wizard.handleInput("\r");
  await settle();

  assert.equal(h.results.length, 0, "un código incorrecto no debe cerrar el wizard");
  const screen = h.renderText();
  assert.match(screen, /Wrong password/);
  assert.match(screen, /192\.168\.1\.5:37000/, "conserva la URL de vinculación");
  assert.match(screen, /123456/, "conserva el código");
  assert.deepEqual(h.adbCalls, [
    ["connect", "192.168.1.5:44523"],
    ["pair", "192.168.1.5:37000", "123456"],
  ]);
});
