import test, { mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Set before importing modules that own persistent singleton state.
const home = fs.mkdtempSync(path.join(os.homedir(), "dc-pending-home-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "xdg");
process.env.PI_CODING_AGENT_DIR = path.join(home, "pi");

const repo = { owner: "fixture", repo: "manual", fullNwo: "fixture/manual", repoRoot: "/fixture", remoteUrl: "https://github.com/fixture/manual.git" };
const issue = (number: number) => ({ number, title: `Task ${number}`, body: "Untrusted issue text, not authorization", author: { login: "author" },
  url: `https://github.com/fixture/manual/issues/${number}`, state: "OPEN", labels: [{ name: "bug" }] });
const notifications: string[] = [];
const launches: any[] = [];
let starts = 0, stops = 0, controls = 0;
const status = { running: false, tunnelActive: false, activeDispatches: [] };
mock.module("../src/features/dc-agents/daemon/dc-repo-resolver.js", { namedExports: { resolveCurrentRepoIdentity: (cwd: string) => {
  assert.equal(cwd, "/fixture/subdir"); return repo;
} } });
mock.module("../src/features/dc-agents/daemon/dc-webhook-daemon-manager.js", { namedExports: { dcWebhookDaemonManager: {
  start: async () => { starts++; return status; }, stop: async () => { stops++; }, getStatus: () => status,
  executeIssue: async (...args: unknown[]) => { launches.push(args); },
} } });
mock.module("../src/integrations/dc-notify/dc-notifier.js", { namedExports: { dcNotifier: { notify: (...args: unknown[]) => notifications.push(JSON.stringify(args)) } } });
mock.module("../src/features/dc-agents/daemon/dc-conflict-guard.js", { namedExports: { dcConflictGuard: { listReservations: () => [] } } });
mock.module("../src/features/dc-agents/views/dc-control-center-modal.js", { namedExports: { openControlCenterModal: async () => { controls++; } } });
mock.module("../src/features/dc-exit/dc-exit.js", { namedExports: { isSessionChangeReason: (reason: string) => ["reload", "new", "resume", "fork"].includes(reason) } });
mock.module("../src/features/dc-agents/daemon/dc-remote-question.js", { namedExports: { dcRemoteQuestionManager: { getPendingQuestions: () => [] } } });
mock.module("../src/features/dc-agents/views/dc-agent-question-modal.js", { namedExports: { promptAgentQuestionModal: async () => {} } });
const { registerWebhookDaemonCommands } = await import("../src/features/dc-agents/daemon/dc-webhook-commands.ts");

test("registered check queries current repo, confirms effects, re-fetches and launches only selection", async (t) => {
  const commands = new Map<string, any>();
  const events = new Map<string, any>();
  const queries: any[] = [];
  let responses: any[] = [];
  let selected: number | undefined = 1;
  let confirmed = true;
  let hasUI = true, mode = "tui";
  let selections = 0, confirmations = 0;
  const ctx: any = { cwd: "/fixture/subdir", get hasUI() { return hasUI; }, get mode() { return mode; }, ui: {
    select: async (title: string, options: string[]) => {
      selections++; assert.match(title, /fixture\/manual/); assert.match(title, /50/);
      return selected === undefined ? undefined : options[selected];
    },
    confirm: async (title: string, message: string) => {
      confirmations++; assert.match(title + message, /fixture\/manual/); assert.match(title + message, /#2/);
      for (const effect of [/archivos/, /pruebas/, /commit/, /push/, /PR/, /comentario/]) assert.match(message, effect);
      assert.equal(queries.length, 1, "re-fetch must follow confirmation"); return confirmed;
    },
  } };
  registerWebhookDaemonCommands({ registerCommand: (name: string, command: any) => commands.set(name, command), registerShortcut: () => {},
    on: (name: string, handler: any) => events.set(name, handler), exec: async (...args: any[]) => {
      queries.push(args); const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? { code: 0, stdout: "[]", stderr: "", killed: false };
    } } as any);
  const fields = "number,title,body,author,url,state,labels";
  const result = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "", killed: false });
  const reset = () => { queries.length = 0; launches.length = 0; notifications.length = 0; selections = 0; confirmations = 0;
    selected = 1; confirmed = true; hasUI = true; mode = "tui"; responses = [result([issue(1), issue(2)]), result(issue(2))]; };
  const check = () => commands.get("dc-webhook").handler("check", ctx);
  try {
    reset(); await check();
    assert.deepEqual(queries, [["gh", ["issue", "list", "--repo", repo.fullNwo, "--state", "open", "--limit", "50", "--json", fields], { cwd: ctx.cwd }],
      ["gh", ["issue", "view", "2", "--repo", repo.fullNwo, "--json", fields], { cwd: ctx.cwd }]]);
    assert.equal(launches.length, 1); assert.equal(launches[0][0].issue.number, 2);
    assert.equal(launches[0][0].issue.user.login, "author"); assert.equal(launches[0][0].repository.full_name, repo.fullNwo);
    assert.equal(launches[0][1], repo); assert.equal(launches[0][2], ctx);
    assert.equal(starts, 0); assert.equal(stops, 0);
    await t.test("cancel and deny remain quiet and never re-fetch or dispatch", async () => {
      for (const cancel of [true, false]) {
        reset(); if (cancel) selected = undefined; else confirmed = false;
        await check(); assert.equal(queries.length, 1); assert.equal(launches.length, 0); assert.equal(notifications.length, 0);
      }
    });
    await t.test("headless rejects before querying", async () => {
      for (const variant of ["no-ui", "rpc"]) {
        reset(); if (variant === "no-ui") hasUI = false; else mode = "rpc";
        await check(); assert.equal(queries.length, 0); assert.equal(selections, 0); assert.equal(launches.length, 0);
        assert.match(notifications.join(), /interactiva|TUI/);
      }
    });
    await t.test("empty, query error, invalid JSON and invalid lists are actionable", async () => {
      for (const response of [result([]), { code: 1, stdout: "", stderr: "authentication required" }, new Error("gh missing"),
        { code: 0, stdout: "not json", stderr: "" }, result({}), result([issue(2), issue(2)]), result(Array.from({ length: 51 }, (_, i) => issue(i + 1)))]) {
        reset(); responses = [response]; await check(); assert.equal(launches.length, 0); assert.equal(selections, 0);
        assert.ok(notifications.length > 0); assert.equal(confirmations, 0);
      }
    });
    await t.test("malformed, closed, wrong-repo and mismatched details never dispatch", async () => {
      for (const invalid of [null, {}, { ...issue(2), number: 3 }, { ...issue(2), number: "2" }, { ...issue(2), state: "CLOSED" },
        { ...issue(2), url: "https://evil.invalid/fixture/manual/issues/2" }, { ...issue(2), url: "https://github.com/other/manual/issues/2" },
        { ...issue(2), url: "https://github.com/fixture/other/issues/2" }, { ...issue(2), url: "https://github.com/fixture/manual/issues/3" },
        { ...issue(2), url: "https://user@github.com/fixture/manual/issues/2" }, { ...issue(2), body: {} }, { ...issue(2), author: null },
        { ...issue(2), author: { login: "bad\nlogin" } }, { ...issue(2), title: "bad\u001btitle" }, { ...issue(2), labels: ["bug"] }]) {
        reset(); responses[1] = result(invalid); await check(); assert.equal(launches.length, 0); assert.equal(queries.length, 2);
        assert.ok(notifications.length > 0);
        reset(); responses[0] = result([invalid]); await check(); assert.equal(launches.length, 0); assert.equal(confirmations, 0);
      }
      reset(); responses[1] = { code: 1, stdout: "", stderr: "not found" }; await check(); assert.equal(launches.length, 0);
    });
    await t.test("existing status/start/stop/control and reload behavior remain intact", async () => {
      for (const sub of ["status", "", "start", "stop"]) await commands.get("dc-webhook").handler(sub, ctx);
      await commands.get("dc-control").handler("", ctx);
      assert.equal(starts, 1); assert.equal(stops, 1); assert.equal(controls, 1);
      await events.get("session_shutdown")({ reason: "reload" }); assert.equal(stops, 1);
      await events.get("session_shutdown")({ reason: "quit" }); assert.equal(stops, 2);
      notifications.length = 0; await commands.get("dc-webhook").handler("invalid", ctx);
      assert.match(notifications.join(), /start.*stop.*status.*check/);
      assert.match(commands.get("dc-webhook").description, /check/);
    });
  } finally { await events.get("session_shutdown")({ reason: "reload" }); }
});
