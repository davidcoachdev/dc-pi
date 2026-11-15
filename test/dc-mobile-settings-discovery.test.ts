import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";

import {
  readWirelessDebuggingAddress,
} from "../src/features/dc-mobile/core/dc-mobile-settings-discovery.ts";
import type { DcMobileAdbRunner } from "../src/features/dc-mobile/core/dc-mobile-async-connection.ts";

const DEVELOPMENT_SETTINGS_ARGS = [
  "shell",
  "am",
  "start",
  "-a",
  "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
];
const DUMP_ARGS = ["exec-out", "uiautomator", "dump", "/dev/tty"];
const SWIPE_UP_ARGS = ["shell", "input", "swipe", "540", "1600", "540", "600", "300"];
const TAP_WIRELESS_ARGS = ["shell", "input", "tap", "300", "1492"];
const BACK_ARGS = ["shell", "input", "keyevent", "KEYCODE_BACK"];

const DEVELOPMENT_SCREEN = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,1920]">
    <node index="0" text="Sistema" resource-id="android:id/title" clickable="false" bounds="[40,600][1040,680]" />
    <node index="1" text="Acerca del teléfono" resource-id="android:id/title" clickable="false" bounds="[40,700][1040,780]" />
  </node>
</hierarchy>`;

const DEVELOPMENT_SCREEN_WITH_ROW = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,1920]">
    <node index="0" text="Sistema" resource-id="android:id/title" class="android.widget.TextView" clickable="false" bounds="[40,600][1040,680]" />
    <node index="0" text="Depuración inalámbrica" resource-id="android:id/title" class="android.widget.TextView" content-desc="" clickable="false" bounds="[63,1461][536,1522]" />
    <node index="0" text="" resource-id="com.android.settings:id/switchWidget" class="android.widget.Switch" content-desc="Depuración inalámbrica" clickable="true" bounds="[880,1424][1080,1645]" />
  </node>
</hierarchy>`;

const DEVELOPMENT_SCREEN_SWITCH_ONLY = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,1920]">
    <node index="0" text="" resource-id="com.android.settings:id/switchWidget" class="android.widget.Switch" content-desc="Depuración inalámbrica" clickable="true" bounds="[880,1424][1080,1645]" />
  </node>
</hierarchy>`;

function wirelessScreen(value: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,1920]">
    <node index="0" text="Dirección IP y puerto" resource-id="android:id/title" clickable="false" bounds="[40,300][1040,380]" />
    <node index="1" text="${value}" resource-id="android:id/summary" clickable="false" bounds="[40,380][1040,460]" />
  </node>
</hierarchy>`;
}

interface ScriptedRunner {
  runner: DcMobileAdbRunner;
  calls: string[][];
  logs: string[];
}

function createRunner(options: {
  dumps: string[];
  startOk?: boolean;
  dumpOk?: boolean;
}): ScriptedRunner {
  const calls: string[][] = [];
  const logs: string[] = [];
  let dumpIndex = 0;

  const runner: DcMobileAdbRunner = async (args, log) => {
    calls.push([...args]);
    log(`$ adb ${args.join(" ")}`);
    logs.push(`$ adb ${args.join(" ")}`);

    if (args[0] === "shell" && args[1] === "am") {
      return { ok: options.startOk !== false, output: "Starting: Intent" };
    }

    if (args[0] === "exec-out" || args[1] === "exec-out") {
      if (options.dumpOk === false) return { ok: false, output: "" };
      const output = options.dumps[dumpIndex] ?? "";
      dumpIndex += 1;
      return { ok: true, output };
    }

    return { ok: true, output: "" };
  };

  return { runner, calls, logs };
}

test("dc-mobile settings discovery: S7a reads a row below the fold and its value", async () => {
  const { runner, calls, logs } = createRunner({
    dumps: [DEVELOPMENT_SCREEN, DEVELOPMENT_SCREEN_WITH_ROW, wirelessScreen("192.168.100.222:44523")],
  });

  const address = await readWirelessDebuggingAddress(runner);

  assert.deepEqual(address, {
    address: "192.168.100.222:44523",
    host: "192.168.100.222",
    port: 44523,
  });
  assert.deepEqual(calls, [
    DEVELOPMENT_SETTINGS_ARGS,
    DUMP_ARGS,
    SWIPE_UP_ARGS,
    DUMP_ARGS,
    TAP_WIRELESS_ARGS,
    DUMP_ARGS,
    BACK_ARGS,
    BACK_ARGS,
  ]);
  assert.ok(
    logs.some((line) => line.includes("uiautomator")),
    "the module must report the commands through the injected log",
  );
});

test("dc-mobile settings discovery: S7b rejects invalid ports, public hosts and text", async () => {
  const values = [
    "192.168.100.222:0",
    "192.168.100.222:99999",
    "8.8.8.8:44523",
    "Sin dirección disponible",
  ];

  for (const value of values) {
    const { runner } = createRunner({
      dumps: [DEVELOPMENT_SCREEN_WITH_ROW, wirelessScreen(value)],
    });

    assert.equal(
      await readWirelessDebuggingAddress(runner),
      undefined,
      `must reject ${value}`,
    );
  }
});

test("dc-mobile settings discovery: S7c returns undefined when the row never appears", async () => {
  const { runner, calls } = createRunner({ dumps: [DEVELOPMENT_SCREEN] });

  const address = await readWirelessDebuggingAddress(runner);

  assert.equal(address, undefined);
  const swipes = calls.filter((args) => args.includes("swipe"));
  assert.equal(swipes.length, 6, "scrolling stops after six attempts");
  assert.ok(!calls.some((args) => args.includes("tap")), "nothing is tapped without the row");
  assert.deepEqual(calls.at(-1), BACK_ARGS, "the opened settings screen is closed");
  assert.equal(calls.filter((args) => args.join(" ") === BACK_ARGS.join(" ")).length, 1);
});

test("dc-mobile settings discovery: S7f never taps the wireless switch", async () => {
  const { runner, calls } = createRunner({ dumps: [DEVELOPMENT_SCREEN_SWITCH_ONLY] });

  assert.equal(await readWirelessDebuggingAddress(runner), undefined);
  assert.ok(
    !calls.some((args) => args.includes("tap")),
    "tapping the switch would turn wireless debugging off",
  );
});

test("dc-mobile settings discovery: S3 accepts the private and link-local ranges", async () => {
  for (const value of ["10.1.2.3:5555", "172.20.10.5:37000", "169.254.4.9:41234"]) {
    const { runner } = createRunner({
      dumps: [DEVELOPMENT_SCREEN_WITH_ROW, wirelessScreen(value)],
    });

    assert.equal((await readWirelessDebuggingAddress(runner))?.address, value);
  }
});

test("dc-mobile settings discovery: a failed settings intent is silent and opens no back", async () => {
  const { runner, calls } = createRunner({ dumps: [DEVELOPMENT_SCREEN], startOk: false });

  assert.equal(await readWirelessDebuggingAddress(runner), undefined);
  assert.deepEqual(calls, [DEVELOPMENT_SETTINGS_ARGS]);
});

test("dc-mobile settings discovery: the hierarchy dump is a host exec-out, not a shell command", async () => {
  const { runner, calls } = createRunner({
    dumps: [DEVELOPMENT_SCREEN_WITH_ROW, wirelessScreen("192.168.100.222:44523")],
  });

  await readWirelessDebuggingAddress(runner);

  const dumps = calls.filter((args) => args.includes("uiautomator"));
  assert.ok(dumps.length > 0, "at least one hierarchy dump is needed");
  for (const dump of dumps) {
    assert.deepEqual(dump, ["exec-out", "uiautomator", "dump", "/dev/tty"]);
  }
  assert.ok(
    !calls.some((args) => args[0] === "shell" && args[1] === "exec-out"),
    "exec-out is an adb host flag: inside adb shell the device answers 'not found'",
  );
});

test("dc-mobile settings discovery: the module never uses a synchronous child_process API", () => {
  const source = fs.readFileSync(
    "src/features/dc-mobile/core/dc-mobile-settings-discovery.ts",
    "utf8",
  );

  assert.doesNotMatch(source, /child_process/);
  assert.doesNotMatch(source, /execFileSync|execSync|spawnSync/);
});
