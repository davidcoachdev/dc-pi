import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, OverlayOptions } from "@earendil-works/pi-tui";
import type { TakeoverOutcome, TakeoverRequest } from "../src/features/dc-takeover/core/dc-takeover-types.ts";
import { DcTakeoverPanel, openDcTakeoverModal } from "../src/features/dc-takeover/views/dc-takeover-modal.ts";
import {
  DC_TAKEOVER_HEADLESS_NOTE,
  registerDcTakeoverTools,
} from "../src/features/dc-takeover/tools/dc-takeover-tools.ts";

const dummyTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function makeRequest(overrides: Partial<TakeoverRequest> = {}): TakeoverRequest {
  return {
    id: "takeover-test-1",
    title: "Autenticación 2FA requerida",
    reason: "El dispositivo solicita un código de verificación en dos pasos para continuar con la sesión.",
    suggestedAction: "Ingresá el código OTP en el dispositivo y tocá Continuar",
    createdAt: Date.now(),
    ...overrides,
  };
}

function makePanel(onDone: (outcome: TakeoverOutcome) => void = () => {}): DcTakeoverPanel {
  return new DcTakeoverPanel(makeRequest(), dummyTheme, onDone);
}

function clickRow(panel: DcTakeoverPanel, width: number, label: string): void {
  const lines = panel.render(width);
  const row = lines[lines.length - 1];
  const x = row.indexOf(label);
  assert.ok(x >= 0, `button label "${label}" must be rendered`);
  const res = panel.handleMouse({
    type: "click",
    button: "left",
    x,
    y: lines.length - 1,
    screenX: x,
    screenY: lines.length - 1,
    width,
    height: lines.length,
    shift: false,
    alt: false,
    ctrl: false,
  });
  assert.deepEqual(res, { handled: true, render: true });
}

test("DcTakeoverPanel renders title, reason, suggested action and the three buttons", () => {
  const panel = makePanel();
  const lines = panel.render(78);
  const text = lines.join("\n");

  assert.ok(text.includes("Autenticación 2FA requerida"));
  assert.ok(text.includes("El dispositivo solicita un código de verificación"));
  assert.ok(text.includes("Ingresá el código OTP"));
  assert.ok(text.includes("Continuar"));
  assert.ok(text.includes("Reintentar"));
  assert.ok(text.includes("Abortar"));

  // Default selection is highlighted on the first button.
  assert.ok(lines[lines.length - 1].includes("[▶ Continuar ◀]"));
});

test("DcTakeoverPanel navigates with arrows and confirms the focused outcome on Enter", () => {
  let outcome: TakeoverOutcome | undefined;
  const panel = makePanel((value) => { outcome = value; });

  panel.render(78);
  panel.handleInput("right");
  panel.handleInput("enter");
  assert.equal(outcome, "retry");

  let leftOutcome: TakeoverOutcome | undefined;
  const leftPanel = makePanel((value) => { leftOutcome = value; });
  leftPanel.render(78);
  leftPanel.handleInput("left");
  leftPanel.handleInput("enter");
  assert.equal(leftOutcome, "aborted");
});

test("DcTakeoverPanel cycles with Tab and Shift-Tab", () => {
  let tabOutcome: TakeoverOutcome | undefined;
  const tabPanel = makePanel((value) => { tabOutcome = value; });
  tabPanel.render(78);
  tabPanel.handleInput("tab");
  tabPanel.handleInput("enter");
  assert.equal(tabOutcome, "retry");

  let shiftTabOutcome: TakeoverOutcome | undefined;
  const shiftTabPanel = makePanel((value) => { shiftTabOutcome = value; });
  shiftTabPanel.render(78);
  shiftTabPanel.handleInput("shift+tab");
  const rendered = shiftTabPanel.render(78);
  assert.ok(rendered[rendered.length - 1].includes("[▶ Abortar ◀]"));
  shiftTabPanel.handleInput("enter");
  assert.equal(shiftTabOutcome, "aborted");
});

test("DcTakeoverPanel confirms continued on Enter for the default selection", () => {
  let outcome: TakeoverOutcome | undefined;
  const panel = makePanel((value) => { outcome = value; });
  panel.render(78);
  panel.handleInput("enter");
  assert.equal(outcome, "continued");
});

test("DcTakeoverPanel confirms aborted on Escape", () => {
  let outcome: TakeoverOutcome | undefined;
  const panel = makePanel((value) => { outcome = value; });
  panel.render(78);
  panel.handleInput("escape");
  assert.equal(outcome, "aborted");
});

test("DcTakeoverPanel selects each button by mouse hitbox", () => {
  let continued: TakeoverOutcome | undefined;
  const continuePanel = makePanel((value) => { continued = value; });
  clickRow(continuePanel, 78, "Continuar");
  assert.equal(continued, "continued");

  let retry: TakeoverOutcome | undefined;
  const retryPanel = makePanel((value) => { retry = value; });
  clickRow(retryPanel, 78, "Reintentar");
  assert.equal(retry, "retry");

  let aborted: TakeoverOutcome | undefined;
  const abortPanel = makePanel((value) => { aborted = value; });
  clickRow(abortPanel, 78, "Abortar");
  assert.equal(aborted, "aborted");
});

test("openDcTakeoverModal resolves with the outcome selected in the TUI", async () => {
  const mockCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async <T>(
        factory: (tui: TUI, theme: Theme, kb: unknown, done: (val?: T) => void) => unknown,
        options: { overlay: boolean; overlayOptions: () => OverlayOptions },
      ): Promise<T | undefined> => {
        assert.equal(options.overlay, true);
        const mockTui = {
          requestRender() {},
          terminal: { rows: 40, columns: 80 },
        } as unknown as TUI;
        let resultVal: T | undefined;
        const done = (value?: T) => { resultVal = value; };
        const component = factory(mockTui, dummyTheme, {}, done) as {
          render: (width: number) => string[];
          handleInput: (data: string) => void;
        };
        component.render(60);
        component.handleInput("right");
        component.handleInput("enter");
        return resultVal;
      },
    },
  } as unknown as ExtensionContext;

  const outcome = await openDcTakeoverModal(mockCtx, makeRequest());
  assert.equal(outcome, "retry");
});

test("dc_takeover_request is registered and returns aborted in headless mode", async () => {
  let tool: any;
  const mockPi = {
    registerTool(definition: unknown) {
      tool = definition;
    },
  } as unknown as ExtensionAPI;

  registerDcTakeoverTools(mockPi);
  assert.equal(tool.name, "dc_takeover_request");
  assert.deepEqual(tool.parameters.required, ["title", "reason", "suggestedAction"]);

  const headlessCtx = { hasUI: false } as ExtensionContext;
  const result = await tool.execute(
    "call-headless",
    { title: "2FA", reason: "Código requerido", suggestedAction: "Ingresá el OTP" },
    undefined,
    undefined,
    headlessCtx,
  );

  assert.equal(result.details.outcome, "aborted");
  assert.equal(result.details.note, DC_TAKEOVER_HEADLESS_NOTE);
  assert.ok(result.content[0].text.includes("aborted"));
});

test("dc_takeover_request opens the modal in TUI mode and returns the decision", async () => {
  let tool: any;
  const mockPi = {
    registerTool(definition: unknown) {
      tool = definition;
    },
  } as unknown as ExtensionAPI;
  registerDcTakeoverTools(mockPi);

  let modalTitle = "";
  const tuiCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async <T>(
        factory: (tui: TUI, theme: Theme, kb: unknown, done: (val?: T) => void) => unknown,
        options: { overlay: boolean; overlayOptions: () => OverlayOptions },
      ): Promise<T | undefined> => {
        assert.equal(options.overlay, true);
        const mockTui = {
          requestRender() {},
          terminal: { rows: 40, columns: 80 },
        } as unknown as TUI;
        let resultVal: T | undefined;
        const done = (value?: T) => { resultVal = value; };
        const component = factory(mockTui, dummyTheme, {}, done) as {
          render: (width: number) => string[];
          handleInput: (data: string) => void;
        };
        const lines = component.render(60);
        modalTitle = lines.join("\n");
        component.handleInput("enter");
        return resultVal;
      },
    },
  } as unknown as ExtensionContext;

  const result = await tool.execute(
    "call-ui",
    { title: "Intervención física", reason: "Aprobá la huella", suggestedAction: "Tocá Continuar" },
    undefined,
    undefined,
    tuiCtx,
  );

  assert.ok(modalTitle.includes("Intervención Humana Requerida"));
  assert.ok(modalTitle.includes("Intervención física"));
  assert.equal(result.details.outcome, "continued");
});
