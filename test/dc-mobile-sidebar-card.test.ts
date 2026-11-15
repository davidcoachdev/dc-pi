import test from "node:test";
import assert from "node:assert/strict";

import type { DcAdbDevice } from "../src/features/dc-mobile/core/dc-adb-driver.ts";
import {
  clearMobileActivity,
  getMobileActivity,
  recordMobileActivity,
} from "../src/features/dc-mobile/core/dc-mobile-activity.ts";
import {
  createDcMobileSidebarCard,
  flushMobileSidebarActions,
  flushMobileSidebarSnapshot,
  refreshMobileSidebarSnapshot,
  resetDcMobileSidebarStateForTesting,
  type DcMobileSidebarDeps,
} from "../src/features/dc-mobile/views/dc-mobile-sidebar-card.ts";

const ANSI = /\x1b\[[0-9;]*m/g;

function plain(lines: string[]): string[] {
  return lines.map((line) => line.replace(ANSI, ""));
}

function reset(): void {
  resetDcMobileSidebarStateForTesting();
  clearMobileActivity();
}

function baseDeps(overrides: Partial<DcMobileSidebarDeps> = {}): DcMobileSidebarDeps {
  return {
    isAdbAvailable: () => true,
    listDevices: () => [],
    loadPrefs: () => ({ lastSerial: "", mode: "usb", lastWifiAddress: "", pairedHosts: [] }),
    reconnect: () => ({
      ok: true,
      serial: "USB123",
      message: "Dispositivo ya conectado: USB123.",
    }),
    disconnect: (serial: string) => `disconnected ${serial}`,
    openViewer: (serial: string) => ({
      serial,
      framePath: "/tmp/frame.png",
      latestPath: "/tmp/latest.png",
      viewer: "started",
      pid: 4321,
      message: "Visor en vivo iniciado.",
    }),
    getViewerPid: () => undefined,
    getLastFrameAt: () => undefined,
    now: () => 1_000_000,
    ...overrides,
  };
}

function clickLine(card: unknown, lines: string[], needle: string): unknown {
  const y = lines.findIndex((line) => line.includes(needle));
  assert.ok(y >= 0, `missing clickable row: ${needle}`);

  return (card as { handleMouse?: (event: unknown) => unknown }).handleMouse?.({
    type: "click",
    button: "left",
    x: 5,
    y,
  });
}

test("card S2: header counts devices and dominant transport, one row per device", async () => {
  reset();

  const devices: DcAdbDevice[] = [
    { serial: "USB123", state: "device", model: "Pixel 7" },
    { serial: "192.168.1.50:5555", state: "offline", model: "-" },
  ];

  const card = createDcMobileSidebarCard(undefined, baseDeps({ listDevices: () => devices }));
  await flushMobileSidebarSnapshot();

  const lines = plain(card.render(50));

  assert.ok(lines.some((line) => line.includes("2 dispositivos")), "device count");
  assert.ok(lines.some((line) => line.includes("mixto")), "mixed transport");
  assert.ok(
    lines.some(
      (line) =>
        line.includes("USB123") && line.includes("device") && line.includes("Pixel 7"),
    ),
    "serial, state and reported model on the same row",
  );
  assert.ok(
    lines.some((line) => line.includes("192.168.1.50:5555") && line.includes("offline")),
    "wifi device row",
  );
  // The driver's default model marker is not a real model name.
  assert.ok(lines.every((line) => !line.includes(" - ")), "no empty model marker");
});

test("card S2: a single USB device renders 1 dispositivo and USB", async () => {
  reset();

  const card = createDcMobileSidebarCard(
    undefined,
    baseDeps({
      listDevices: () => [{ serial: "USB123", state: "unauthorized", model: "Pixel 7" }],
    }),
  );
  await flushMobileSidebarSnapshot();

  const lines = plain(card.render(50));

  assert.ok(lines.some((line) => line.includes("1 dispositivo")), "singular count");
  assert.ok(lines.some((line) => line.includes("USB")), "USB transport");
  assert.ok(lines.some((line) => line.includes("unauthorized")), "device state is visible");
  assert.ok(!lines.some((line) => line.includes("dispositivos")), "no plural count");
});

test("card S3: renders the newest 8 activity lines with HH:MM:SS and drops older events", async () => {
  reset();

  const card = createDcMobileSidebarCard(
    undefined,
    baseDeps({ listDevices: () => [{ serial: "USB123", state: "device", model: "Pixel 7" }] }),
  );
  await flushMobileSidebarSnapshot();

  // Start the timeline after the mount snapshot so the assertions are exact.
  clearMobileActivity();

  const base = new Date(2026, 0, 2, 9, 8, 7).getTime();
  for (let index = 0; index < 10; index += 1) {
    recordMobileActivity("action", `evento ${index + 1}`, base + index * 1000);
  }

  const lines = plain(card.render(50));
  const logLines = lines.filter((line) => /\d{2}:\d{2}:\d{2}\s+evento/.test(line));

  assert.equal(logLines.length, 8, "only the last 8 events fit");
  assert.match(logLines[0] ?? "", /09:08:09\s+evento 3/);
  assert.match(logLines[7] ?? "", /09:08:16\s+evento 10/);
  assert.ok(
    !lines.some((line) => /evento [12]\s/.test(line)),
    "oldest events are dropped",
  );
});

test("card S4: render never calls adb; the mount snapshot is asynchronous", async () => {
  reset();

  let availableCalls = 0;
  let listCalls = 0;

  const card = createDcMobileSidebarCard(
    undefined,
    baseDeps({
      isAdbAvailable: () => {
        availableCalls += 1;
        return true;
      },
      listDevices: () => {
        listCalls += 1;
        return [];
      },
    }),
  );

  card.render(50);
  assert.equal(availableCalls, 0, "render must not probe adb");
  assert.equal(listCalls, 0, "render must not list devices");

  await flushMobileSidebarSnapshot();
  assert.equal(availableCalls, 1);
  assert.equal(listCalls, 1);
});

test("card S4: repaints through requestRender on activity events and refreshes", async () => {
  reset();

  let repaints = 0;
  const card = createDcMobileSidebarCard(() => {
    repaints += 1;
  }, baseDeps());

  await flushMobileSidebarSnapshot();
  assert.ok(repaints >= 1, "snapshot completion repaints");

  const before = repaints;
  recordMobileActivity("connect", "conectado (device)");
  assert.ok(repaints > before, "activity events repaint");

  card.render(50);
});

test("card S5: Reconectar, Apagar vínculo and Abrir visor run the injected actions", async () => {
  reset();

  let reconnects = 0;
  const disconnects: string[] = [];
  const opened: string[] = [];
  let viewerPid: number | undefined;

  const deps = baseDeps({
    listDevices: () => [{ serial: "USB123", state: "device", model: "Pixel 7" }],
    reconnect: () => {
      reconnects += 1;
      return { ok: true, serial: "USB123", message: "Dispositivo ya conectado: USB123." };
    },
    disconnect: (serial: string) => {
      disconnects.push(serial);
      return `disconnected ${serial}`;
    },
    openViewer: (serial: string) => {
      opened.push(serial);
      viewerPid = 4321;
      return {
        serial,
        framePath: "/tmp/frame.png",
        latestPath: "/tmp/latest.png",
        viewer: "started",
        pid: 4321,
        message: "Visor en vivo iniciado.",
      };
    },
    getViewerPid: () => viewerPid,
  });

  const card = createDcMobileSidebarCard(undefined, deps);
  await flushMobileSidebarSnapshot();

  // Reconectar
  let lines = plain(card.render(50));
  assert.deepEqual(clickLine(card, lines, "[Reconectar]"), { handled: true });
  await flushMobileSidebarActions();

  assert.equal(reconnects, 1);
  assert.ok(getMobileActivity().some((event) => event.message === "reconectando"));
  assert.ok(
    getMobileActivity().some((event) =>
      event.message.includes("Dispositivo ya conectado: USB123"),
    ),
  );

  // Apagar vínculo
  lines = plain(card.render(50));
  assert.deepEqual(clickLine(card, lines, "[Apagar vínculo]"), { handled: true });
  await flushMobileSidebarActions();

  assert.deepEqual(disconnects, ["USB123"]);
  assert.ok(getMobileActivity().some((event) => event.message === "vínculo apagado"));

  // Abrir visor
  lines = plain(card.render(50));
  assert.deepEqual(clickLine(card, lines, "[Abrir visor]"), { handled: true });
  await flushMobileSidebarActions();

  assert.deepEqual(opened, ["USB123"]);
  assert.ok(
    getMobileActivity().some((event) => event.message === "visor abierto (pid 4321)"),
  );

  lines = plain(card.render(50));
  assert.ok(lines.some((line) => /visor:\s+abierto \(pid 4321\)/.test(line)));
});

test("card S6: viewer line shows the pid, the age of the last frame, or sin frames", async () => {
  reset();

  const now = 1_000_000;
  let viewerPid: number | undefined = 1234;

  const deps = baseDeps({
    now: () => now,
    listDevices: () => [{ serial: "USB123", state: "device", model: "Pixel 7" }],
    getViewerPid: () => viewerPid,
    getLastFrameAt: () => now - 5_000,
  });

  const card = createDcMobileSidebarCard(undefined, deps);
  await flushMobileSidebarSnapshot();

  let lines = plain(card.render(50));
  assert.ok(lines.some((line) => /visor:\s+abierto \(pid 1234\)/.test(line)));

  viewerPid = undefined;
  await refreshMobileSidebarSnapshot(deps);

  lines = plain(card.render(50));
  assert.ok(lines.some((line) => /visor:\s+último frame hace 5s/.test(line)));

  reset();
  const noFrames = createDcMobileSidebarCard(
    undefined,
    baseDeps({
      now: () => now,
      listDevices: () => [{ serial: "USB123", state: "device", model: "Pixel 7" }],
      getViewerPid: () => undefined,
      getLastFrameAt: () => undefined,
    }),
  );
  await flushMobileSidebarSnapshot();

  const noFrameLines = plain(noFrames.render(50));
  assert.ok(noFrameLines.some((line) => /visor:\s+sin frames/.test(line)));
});

test("card S9: adb unavailable renders a notice and disables every action", async () => {
  reset();

  let actions = 0;

  const card = createDcMobileSidebarCard(
    undefined,
    baseDeps({
      isAdbAvailable: () => false,
      listDevices: () => {
        throw new Error("listDevices must not run when adb is unavailable");
      },
      reconnect: () => {
        actions += 1;
        return { ok: true, serial: "USB123", message: "noop" };
      },
      disconnect: () => {
        actions += 1;
        return "noop";
      },
      openViewer: () => {
        actions += 1;
        return {
          serial: "USB123",
          framePath: "/tmp/frame.png",
          latestPath: "/tmp/latest.png",
          viewer: "unavailable",
          message: "noop",
        };
      },
    }),
  );

  await flushMobileSidebarSnapshot();

  const lines = plain(card.render(50));
  assert.ok(lines.some((line) => line.includes("adb no disponible")));

  for (const label of ["[Reconectar]", "[Apagar vínculo]", "[Abrir visor]"]) {
    const y = lines.findIndex((line) => line.includes(label));
    assert.ok(y >= 0, `disabled buttons are still rendered: ${label}`);

    const result = (card as { handleMouse?: (event: unknown) => unknown }).handleMouse?.({
      type: "click",
      button: "left",
      x: 5,
      y,
    });
    assert.equal(result, undefined, `${label} must not be clickable`);
  }

  assert.equal(actions, 0, "no action ran");
  assert.doesNotThrow(() => card.render(50), "render never throws");
});
