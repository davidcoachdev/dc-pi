import test from "node:test";
import assert from "node:assert/strict";

import {
  DcAdbDriver,
  DcAdbError,
  DC_EMPTY_TEXT_MESSAGE,
  DC_INVALID_TEXT_CONTROL_CHARS_MESSAGE,
  escapeAdbInputText,
  resolveAdbKeycode,
  type DcAdbExecFn,
  type DcAdbExecOptions,
} from "../src/features/dc-mobile/core/dc-adb-driver.ts";
import {
  formatElementMap,
  parseUiHierarchy,
} from "../src/features/dc-mobile/core/dc-ui-hierarchy-parser.ts";
import { DcMobileConnectWizard } from "../src/features/dc-mobile/views/dc-mobile-connect-modal.ts";

interface RecordedCall {
  file: string;
  args: string[];
  options: DcAdbExecOptions;
}

function recordingExecFn(response: string | Buffer = ""): {
  execFn: DcAdbExecFn;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const execFn: DcAdbExecFn = (file, args, options) => {
    calls.push({ file, args, options });
    return response;
  };
  return { execFn, calls };
}

const HIERARCHY_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" clickable="false" bounds="[0,0][1080,1920]">
    <node index="0" text="Iniciar sesión" resource-id="com.demo:id/login" clickable="true" bounds="[40,400][1040,480]" />
    <node index="1" text="" resource-id="" content-desc="Menú" clickable="false" bounds="[960,0][1080,120]" />
    <node index="2" text="" resource-id="com.demo:id/spacer" clickable="false" bounds="[0,120][1080,400]" />
    <node index="3" text="Roto" resource-id="com.demo:id/broken" clickable="true" bounds="[abc,def][1080,480]" />
    <node index="4" text="" resource-id="com.demo:id/card" clickable="true" bounds="[0,600][540,900]" />
    <node index="5" text="A &amp; B &lt;3" resource-id="com.demo:id/amp" clickable="true" bounds="[0,900][540,1000]" />
  </node>
</hierarchy>`;

test("dc-mobile: parseUiHierarchy numbers actionable nodes in document order", () => {
  const elements = parseUiHierarchy(HIERARCHY_XML);

  assert.deepEqual(
    elements.map((element) => element.id),
    ["@e1", "@e2", "@e3", "@e4"],
  );
});

test("dc-mobile: parseUiHierarchy filters non-actionable and malformed nodes", () => {
  const elements = parseUiHierarchy(HIERARCHY_XML);
  const resourceIds = elements.map((element) => element.resourceId);

  assert.ok(!resourceIds.includes("com.demo:id/spacer"), "spacer must be filtered out");
  assert.ok(!resourceIds.includes("com.demo:id/broken"), "malformed bounds must be skipped");
  assert.equal(elements.length, 4);
});

test("dc-mobile: parseUiHierarchy falls back to content-desc and computes the center", () => {
  const elements = parseUiHierarchy(HIERARCHY_XML);
  const menu = elements[1];
  const decorativeCard = elements[2];
  const entityText = elements[3];

  assert.equal(menu.text, "Menú");
  assert.deepEqual(menu.bounds, { x1: 960, y1: 0, x2: 1080, y2: 120 });
  assert.deepEqual(menu.center, { x: 1020, y: 60 });
  assert.equal(decorativeCard.text, "", "clickable node without copy keeps an empty label");
  assert.equal(decorativeCard.clickable, true);
  assert.equal(entityText.text, "A & B <3");
});

test("dc-mobile: parseUiHierarchy survives empty or invalid input", () => {
  assert.deepEqual(parseUiHierarchy(""), []);
  assert.deepEqual(parseUiHierarchy("<hierarchy/>"), []);
});

test("dc-mobile: formatElementMap renders one semantic line per element", () => {
  const elements = parseUiHierarchy(HIERARCHY_XML);
  const lines = formatElementMap(elements).split("\n");

  assert.equal(lines.length, 4);
  assert.match(lines[0], /^@e1 "Iniciar sesión" resource-id=com\.demo:id\/login bounds=\[40,400\]\[1040,480\] center=\(540, 440\) clickable=true$/);
  assert.equal(formatElementMap([]), "No se encontraron elementos accionables.");
});

test("dc-mobile: escapeAdbInputText turns spaces into %s and escapes shell metacharacters", () => {
  assert.equal(escapeAdbInputText("hola mundo"), "hola%smundo");
  assert.equal(escapeAdbInputText("a;b&c$d"), "a\\;b\\&c\\$d");
  assert.equal(escapeAdbInputText("say 'hi'"), "say%s\\'hi\\'");
});

test("dc-mobile: escapeAdbInputText rejects empty and blank text", () => {
  for (const text of ["", "   ", "\n\t"]) {
    assert.throws(
      () => escapeAdbInputText(text),
      (error: unknown) =>
        error instanceof DcAdbError &&
        error.code === "INVALID_ARGUMENT" &&
        error.message === DC_EMPTY_TEXT_MESSAGE,
    );
  }
});

test("dc-mobile (S6): escapeAdbInputText and inputText reject newline, CR, tab, NUL and control-char injection", () => {
  const payloads = [
    "hola\nid",
    "hola\rid",
    "hola\r\nrm -rf /",
    "hola\tmundo",
    "hola\0mundo",
    "hola\x1b[31m",
    "hola\x7fmundo",
    "hola\u2028id",
    "hola\u2029id",
  ];

  for (const payload of payloads) {
    assert.throws(
      () => escapeAdbInputText(payload),
      (error: unknown) =>
        error instanceof DcAdbError &&
        error.code === "INVALID_ARGUMENT" &&
        error.message === DC_INVALID_TEXT_CONTROL_CHARS_MESSAGE,
    );
  }

  assert.equal(escapeAdbInputText("hi!"), "hi\\!");

  const { execFn, calls } = recordingExecFn();
  const driver = new DcAdbDriver({ execFn });
  for (const payload of payloads) {
    assert.throws(() => driver.inputText("emulator-5554", payload), DcAdbError);
  }
  assert.equal(calls.length, 0, "control-char injection payloads must never reach adb");
});

test("dc-mobile: resolveAdbKeycode maps names case-insensitively and rejects unknown keys", () => {
  assert.equal(resolveAdbKeycode("BACK"), "KEYCODE_BACK");
  assert.equal(resolveAdbKeycode(" enter "), "KEYCODE_ENTER");
  assert.throws(
    () => resolveAdbKeycode("volume_up"),
    (error: unknown) =>
      error instanceof DcAdbError &&
      error.code === "INVALID_ARGUMENT" &&
      error.message === "key desconocido: volume_up. Usá back, home, enter o tab.",
  );
});

test("dc-mobile: listDevices parses serial, state and model from adb devices -l", () => {
  const output = [
    "List of devices attached",
    "emulator-5554          device product:sdk_gphone64 model:sdk_gphone64_x86_64 device:emu64xa",
    "R58M123ABC             unauthorized usb:1-1 model:SM_G991B",
    "",
  ].join("\n");

  const { execFn, calls } = recordingExecFn(output);
  const driver = new DcAdbDriver({ execFn });

  assert.deepEqual(driver.listDevices(), [
    { serial: "emulator-5554", state: "device", model: "sdk gphone64 x86 64" },
    { serial: "R58M123ABC", state: "unauthorized", model: "SM G991B" },
  ]);
  assert.deepEqual(calls[0]?.args, ["devices", "-l"]);
  assert.ok(calls[0]!.options.timeout > 0, "every adb call must carry a timeout");
});

test("dc-mobile: captureScreen requests a binary screencap with an extended timeout", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const { execFn, calls } = recordingExecFn(png);
  const driver = new DcAdbDriver({ execFn });

  const frame = driver.captureScreen("emulator-5554");

  assert.deepEqual(frame, png);
  assert.deepEqual(calls[0]?.args, ["-s", "emulator-5554", "exec-out", "screencap", "-p"]);
  assert.equal(calls[0]?.options.encoding, "buffer");
  assert.ok(calls[0]!.options.timeout >= 30_000);
});

test("dc-mobile: input actions build the exact adb shell arguments", () => {
  const { execFn, calls } = recordingExecFn();
  const driver = new DcAdbDriver({ execFn });

  driver.inputTap("emulator-5554", 540, 440);
  driver.inputText("emulator-5554", "hola mundo");
  driver.inputKey("emulator-5554", "back");
  driver.swipe("emulator-5554", 100, 900, 100, 200, 250);

  assert.deepEqual(calls.map((call) => call.args), [
    ["-s", "emulator-5554", "shell", "input", "tap", "540", "440"],
    ["-s", "emulator-5554", "shell", "input", "text", "hola%smundo"],
    ["-s", "emulator-5554", "shell", "input", "keyevent", "KEYCODE_BACK"],
    ["-s", "emulator-5554", "shell", "input", "swipe", "100", "900", "100", "200", "250"],
  ]);
});

test("dc-mobile: invalid coordinates and swipe durations never reach adb", () => {
  const { execFn, calls } = recordingExecFn();
  const driver = new DcAdbDriver({ execFn });

  assert.throws(() => driver.inputTap("emulator-5554", Number.NaN, 10), DcAdbError);
  assert.throws(() => driver.swipe("emulator-5554", 0, 0, 10, 10, 0), DcAdbError);
  assert.throws(() => driver.inputText("emulator-5554", "  "), DcAdbError);
  assert.equal(calls.length, 0, "rejected input must not touch the device");
});

test("dc-mobile: isAvailable is false when the adb binary is missing", () => {
  const execFn: DcAdbExecFn = () => {
    const error = new Error("spawn adb ENOENT") as Error & { code: string };
    error.code = "ENOENT";
    throw error;
  };

  assert.equal(new DcAdbDriver({ execFn }).isAvailable(), false);
});

test("dc-mobile: isAvailable is true when adb answers", () => {
  const { execFn } = recordingExecFn("Android Debug Bridge version 1.0.41");

  assert.equal(new DcAdbDriver({ execFn }).isAvailable(), true);
});


test("dc-mobile wizard: the address step prefills `host:` so only the port is typed", () => {
  const wizard = new DcMobileConnectWizard({
    driver: {} as never,
    prefs: {
      mode: "wifi",
      lastSerial: "",
      lastWifiAddress: "192.168.100.222:41779",
      pairedHosts: [],
    } as never,
    theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never,
    done: () => {},
    requestRender: () => {},
    runner: (() => "") as never,
  });
  const view = wizard as unknown as { step: string; address: string };

  wizard.handleInput("\r");

  assert.equal(view.step, "address");
  assert.equal(view.address, "192.168.100.222:", "the rotating port is never prefilled");

  for (const char of "44523") wizard.handleInput(char);

  assert.equal(view.address, "192.168.100.222:44523", "typing appends only the port");
});

test("dc-mobile wizard: `d` is ordinary text, not a command", () => {
  const build = (lastWifiAddress: string) => {
    const wizard = new DcMobileConnectWizard({
      driver: {} as never,
      prefs: { mode: "wifi", lastSerial: "", lastWifiAddress, pairedHosts: [] } as never,
      theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never,
      done: () => {},
      requestRender: () => {},
      runner: (() => "") as never,
    });
    wizard.handleInput("\r");
    return { wizard, view: wizard as unknown as { address: string } };
  };

  const empty = build("");
  empty.wizard.handleInput("d");
  assert.equal(empty.view.address, "d", "an empty field takes the letter");

  const prefilled = build("192.168.100.222:41779");
  prefilled.wizard.handleInput("d");
  assert.equal(prefilled.view.address, "192.168.100.222:d", "the prefilled host takes the letter too");
});
