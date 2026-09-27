import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { DcQuotaPanel } from "../src/features/dc-quota/dc-quota-panel.ts";
import type { QuotaSection } from "../src/features/dc-quota/dc-quota-types.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("DcQuotaPanel auto-selects the currently active model account on load", () => {
  const sections: QuotaSection[] = [
    { id: "cliproxy-ac01", title: "[AC01 - user1@example.com]", rows: [] },
    { id: "cliproxy-ac08", title: "[AC08 - sitetoonline@gmail.com]", rows: [] },
    { id: "cliproxy-cc1", title: "[CC1]", rows: [] },
  ];

  // Simular que el modelo en uso es ac08/gemini-3.8-flash-high
  const panel = new DcQuotaPanel({
    theme: dummyTheme,
    loading: true,
    currentModelId: "ac08/gemini-3.8-flash-high",
    requestRender: () => {},
  });

  // Antes de cargar los datos, el panel está en skeleton/loading
  assert.equal(panel.isLoading(), true);

  // Llegan las secciones de la API
  panel.setSections(sections);

  // La cuenta activa debe ser AC08 (índice 1), no la primera (AC01)
  assert.equal(panel.isLoading(), false);
  assert.equal(panel.getActiveSection().id, "cliproxy-ac08");
  assert.ok(panel.getActiveSection().title.includes("AC08"));
});
