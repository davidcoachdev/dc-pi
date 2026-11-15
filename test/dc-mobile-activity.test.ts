import test from "node:test";
import assert from "node:assert/strict";

import {
  DC_MOBILE_ACTIVITY_LIMIT,
  clearMobileActivity,
  formatMobileActivity,
  getMobileActivity,
  recordMobileActivity,
  subscribeMobileActivity,
} from "../src/features/dc-mobile/core/dc-mobile-activity.ts";

test("dc-mobile-activity: keeps at most 200 events and drops the oldest", () => {
  clearMobileActivity();

  for (let index = 0; index < DC_MOBILE_ACTIVITY_LIMIT + 5; index += 1) {
    recordMobileActivity("action", `event ${index}`, 1000 + index);
  }

  const log = getMobileActivity();
  assert.equal(DC_MOBILE_ACTIVITY_LIMIT, 200);
  assert.equal(log.length, 200);
  assert.equal(log[0]?.message, "event 5");
  assert.equal(log[log.length - 1]?.message, "event 204");
});

test("dc-mobile-activity: orders oldest first and newest last", () => {
  clearMobileActivity();

  recordMobileActivity("discover", "buscando dispositivos", 10);
  recordMobileActivity("connect", "conectado (device)", 20);
  recordMobileActivity("viewer", "visor abierto (pid 1234)", 30);

  const log = getMobileActivity();
  assert.deepEqual(
    log.map((event) => event.message),
    ["buscando dispositivos", "conectado (device)", "visor abierto (pid 1234)"],
  );
  assert.deepEqual(
    log.map((event) => event.at),
    [10, 20, 30],
  );
});

test("dc-mobile-activity: formatMobileActivity pads local time to HH:MM:SS", () => {
  clearMobileActivity();

  const early = recordMobileActivity("connect", "conectando", new Date(2026, 0, 2, 9, 8, 7).getTime());
  assert.equal(formatMobileActivity(early), "09:08:07 conectando");

  const afternoon = recordMobileActivity("action", "capturando pantalla",
    new Date(2026, 0, 2, 15, 4, 3).getTime());
  assert.equal(formatMobileActivity(afternoon), "15:04:03 capturando pantalla");
  assert.match(formatMobileActivity(afternoon), /^\d{2}:\d{2}:\d{2} /);
});

test("dc-mobile-activity: unsubscribe stops delivery", () => {
  clearMobileActivity();

  const received: string[] = [];
  const unsubscribe = subscribeMobileActivity((event) => received.push(event.message));

  recordMobileActivity("connect", "primero");
  unsubscribe();
  recordMobileActivity("connect", "segundo");

  assert.deepEqual(received, ["primero"]);
});

test("dc-mobile-activity: a throwing listener does not stop the next one", () => {
  clearMobileActivity();

  const received: string[] = [];
  subscribeMobileActivity(() => {
    throw new Error("listener roto");
  });
  subscribeMobileActivity((event) => received.push(event.message));

  const activity = recordMobileActivity("error", "falló adb");

  assert.deepEqual(received, ["falló adb"]);
  assert.equal(getMobileActivity().length, 1);
  assert.deepEqual(getMobileActivity()[0], activity);
});

test("dc-mobile-activity: rejects an empty message and returns the previous head", () => {
  clearMobileActivity();

  const received: string[] = [];
  subscribeMobileActivity((event) => received.push(event.message));

  const first = recordMobileActivity("discover", "buscando dispositivos", 10);
  const rejected = recordMobileActivity("error", "   ", 20);

  assert.equal(rejected, first);
  assert.equal(getMobileActivity().length, 1);
  assert.deepEqual(received, ["buscando dispositivos"]);

  clearMobileActivity();
  const placeholder = recordMobileActivity("error", "", 30);

  assert.equal(placeholder.message, "");
  assert.equal(placeholder.at, 30);
  assert.equal(getMobileActivity().length, 0);
});

test("dc-mobile-activity: trims the message and keeps the injected timestamp", () => {
  clearMobileActivity();

  const activity = recordMobileActivity("viewer", "  visor abierto (pid 1234)  ", 4242);

  assert.equal(activity.message, "visor abierto (pid 1234)");
  assert.equal(activity.at, 4242);
  assert.equal(activity.kind, "viewer");
  assert.deepEqual(getMobileActivity(), [activity]);
});

test("dc-mobile-activity: snapshots and records are immutable for callers", () => {
  clearMobileActivity();

  recordMobileActivity("connect", "conectado (device)", 10);

  const log = getMobileActivity();
  assert.ok(Object.isFrozen(log));
  assert.ok(Object.isFrozen(log[0]));
  assert.throws(() => {
    (log as { length: number }).length = 0;
  }, TypeError);
});
