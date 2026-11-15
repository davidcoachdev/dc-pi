import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DC_ADB_UNAVAILABLE_MESSAGE,
  DC_EMPTY_TEXT_MESSAGE,
  DcAdbDriver,
} from "../core/dc-adb-driver.ts";
import {
  formatElementMap,
  parseUiHierarchy,
  type DcMobileElement,
} from "../core/dc-ui-hierarchy-parser.ts";
import { openLiveViewer, saveFrame } from "../core/dc-mobile-viewer.ts";
import {
  connectUsb,
  connectWifi,
  pairWifi,
  saveConnectionPrefs,
} from "../core/dc-mobile-connection.ts";
import {
  createDcMobileSupervisedDriver,
  discoverMdnsAddresses,
  ensureConnection,
  ensureUsbAutoAttach,
  type DcMobileSupervisorResult,
} from "../core/dc-mobile-supervisor.ts";
import { recordMobileActivity } from "../core/dc-mobile-activity.ts";

/** Last inspect per serial, used to resolve `@eN` element ids in tap (S4). */
export interface DcMobileInspection {
  serial: string;
  elements: DcMobileElement[];
  framePath: string;
  latestPath: string;
  capturedAt: number;
}

const inspections = new Map<string, DcMobileInspection>();

export function getLastInspection(serial: string): DcMobileInspection | undefined {
  return inspections.get(serial.trim());
}

export function getInspections(): DcMobileInspection[] {
  return [...inspections.values()];
}

function textResult(text: string, details: Record<string, unknown> = {}): any {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function errorResult(text: string, details: Record<string, unknown> = {}): any {
  return {
    content: [{ type: "text", text }],
    details: { error: text, ...details },
    isError: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A guided supervisor answer is a next step, not a tool failure; everything
 * else is surfaced as `isError: true` (S15).
 */
function supervisorFailure(result: DcMobileSupervisorResult): any {
  // S3/S10: the sidebar timeline mirrors what the supervisor decided.
  recordMobileActivity(result.guided ? "discover" : "error", result.message);

  if (result.guided) {
    return textResult(result.message, {
      guided: true,
      ...(result.serial ? { serial: result.serial } : {}),
      ...(result.transport ? { transport: result.transport } : {}),
    });
  }

  return errorResult(result.message, {
    ...(result.serial ? { serial: result.serial } : {}),
    ...(result.transport ? { transport: result.transport } : {}),
  });
}

function normalizeElementId(value: string): string {
  const trimmed = value.trim();
  return /^e\d+$/i.test(trimmed) ? `@${trimmed.toLowerCase()}` : trimmed;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function deviceLines(devices: Array<{ serial: string; state: string; model: string }>): string {
  if (devices.length === 0) return "No hay dispositivos conectados.";
  return devices.map((device) => `- ${device.serial} · ${device.state} · ${device.model}`).join("\n");
}

export function registerDcMobileTools(pi: ExtensionAPI): void {
  // S2 — dc_adb_devices
  pi.registerTool({
    name: "dc_adb_devices",
    label: "DC ADB Devices",
    description:
      "Lista los dispositivos Android conectados vía adb (serial, estado y modelo).",
    parameters: {
      type: "object",
      properties: {},
    } as any,
    async execute(): Promise<any> {
      const driver = new DcAdbDriver();

      if (!driver.isAvailable()) {
        recordMobileActivity("error", "adb no disponible");
        return errorResult(DC_ADB_UNAVAILABLE_MESSAGE, { adbAvailable: false });
      }

      recordMobileActivity("discover", "buscando dispositivos");

      // S15: the supervisor runs before any device-specific call.
      const connection = ensureConnection(createDcMobileSupervisedDriver());
      if (!connection.ok) {
        return supervisorFailure(connection);
      }

      try {
        const devices = driver.listDevices();
        const online = devices.find((device) => device.state === "device");
        recordMobileActivity(
          online ? "connect" : "discover",
          online ? "conectado (device)" : "sin dispositivos",
        );

        return textResult(
          `Dispositivos conectados (${devices.length}):\n${deviceLines(devices)}`,
          { adbAvailable: true, devices },
        );
      } catch (error) {
        recordMobileActivity("error", errorMessage(error));
        return errorResult(`Error en dc_adb_devices: ${errorMessage(error)}`);
      }
    },
  });

  // S3 — dc_mobile_screen_inspect
  pi.registerTool({
    name: "dc_mobile_screen_inspect",
    label: "DC Mobile Screen Inspect",
    description:
      "Captura la pantalla y la jerarquía de UI de un dispositivo Android, guarda el PNG y devuelve el mapa semántico de elementos accionables (@e1…@eN).",
    parameters: {
      type: "object",
      properties: {
        serial: { type: "string", description: "Serial del dispositivo (ver dc_adb_devices)" },
        preview: {
          type: "boolean",
          description: "Abrir o refrescar el visor en vivo en una ventana Kitty",
        },
      },
      required: ["serial"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      const serial = String(params?.serial ?? "").trim();
      if (!serial) {
        return errorResult("serial vacío: indicá el serial del dispositivo.");
      }

      const driver = new DcAdbDriver();
      if (!driver.isAvailable()) {
        recordMobileActivity("error", "adb no disponible");
        return errorResult(DC_ADB_UNAVAILABLE_MESSAGE, { adbAvailable: false });
      }

      // S15: the supervisor runs before any device-specific call.
      const connection = ensureConnection(createDcMobileSupervisedDriver());
      if (!connection.ok) {
        return supervisorFailure(connection);
      }

      try {
        recordMobileActivity("inspect", "capturando pantalla");
        const png = driver.captureScreen(serial);
        const saved = saveFrame(serial, png);
        const xml = driver.dumpHierarchy(serial);
        const elements = parseUiHierarchy(xml);

        const inspection: DcMobileInspection = {
          serial,
          elements,
          framePath: saved.framePath,
          latestPath: saved.latestPath,
          capturedAt: Date.now(),
        };
        inspections.set(serial, inspection);

        const viewer =
          params?.preview === true
            ? openLiveViewer(serial, { framePath: saved.framePath })
            : undefined;

        if (viewer) {
          recordMobileActivity(
            "viewer",
            typeof viewer.pid === "number"
              ? `visor abierto (pid ${viewer.pid})`
              : viewer.message,
          );
        }

        return textResult(formatElementMap(elements), {
          serial,
          elementCount: elements.length,
          framePath: saved.framePath,
          latestPath: saved.latestPath,
          elements,
          ...(viewer ? { viewer } : {}),
        });
      } catch (error) {
        recordMobileActivity("error", errorMessage(error));
        return errorResult(`Error en dc_mobile_screen_inspect: ${errorMessage(error)}`);
      }
    },
  });

  // S4 — dc_mobile_action
  pi.registerTool({
    name: "dc_mobile_action",
    label: "DC Mobile Action",
    description:
      "Ejecuta una acción sobre un dispositivo Android: tap, text, key, swipe, launch o stop.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["tap", "text", "key", "swipe", "launch", "stop"],
          description: "Acción a ejecutar",
        },
        serial: { type: "string", description: "Serial del dispositivo" },
        elementId: { type: "string", description: "Id semántico del último inspect (@e3)" },
        x: { type: "number", description: "Coordenada X para tap" },
        y: { type: "number", description: "Coordenada Y para tap" },
        text: { type: "string", description: "Texto a escribir" },
        key: { type: "string", description: "Tecla: back, home, enter o tab" },
        x1: { type: "number", description: "Swipe: X inicial" },
        y1: { type: "number", description: "Swipe: Y inicial" },
        x2: { type: "number", description: "Swipe: X final" },
        y2: { type: "number", description: "Swipe: Y final" },
        durationMs: { type: "number", description: "Swipe: duración en milisegundos" },
        package: { type: "string", description: "Paquete Android para launch/stop" },
      },
      required: ["action", "serial"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      const action = String(params?.action ?? "").trim().toLowerCase();
      const serial = String(params?.serial ?? "").trim();

      if (!serial) {
        return errorResult("serial vacío: indicá el serial del dispositivo.");
      }

      const driver = new DcAdbDriver();
      if (!driver.isAvailable()) {
        recordMobileActivity("error", "adb no disponible");
        return errorResult(DC_ADB_UNAVAILABLE_MESSAGE, { adbAvailable: false });
      }

      // S15: the supervisor runs before any device-specific call.
      const connection = ensureConnection(createDcMobileSupervisedDriver());
      if (!connection.ok) {
        return supervisorFailure(connection);
      }

      try {
        switch (action) {
          case "tap": {
            let x: number | undefined;
            let y: number | undefined;
            let elementId: string | undefined;

            if (typeof params?.elementId === "string" && params.elementId.trim()) {
              elementId = normalizeElementId(params.elementId);
              const inspection = inspections.get(serial);
              const element = inspection?.elements.find((item) => item.id === elementId);

              if (!element) {
                return errorResult(
                  `elemento ${elementId} desconocido. Ejecutá dc_mobile_screen_inspect primero.`,
                  { serial, elementId },
                );
              }

              x = element.center.x;
              y = element.center.y;
              recordMobileActivity("action", `eligiendo ${elementId} en pantalla`);
            } else {
              x = readNumber(params?.x);
              y = readNumber(params?.y);
            }

            if (x === undefined || y === undefined) {
              return errorResult("tap requiere elementId o coordenadas x/y.", { serial });
            }

            driver.inputTap(serial, x, y);
            recordMobileActivity("action", `tocando (${x}, ${y})`);
            return textResult(`tap en (${x}, ${y}) ejecutado en ${serial}.`, {
              serial,
              action,
              elementId,
              x,
              y,
            });
          }

          case "text": {
            const text = typeof params?.text === "string" ? params.text : "";
            if (text.trim().length === 0) {
              return errorResult(DC_EMPTY_TEXT_MESSAGE, { serial });
            }

            driver.inputText(serial, text);
            recordMobileActivity("action", "escribiendo texto");
            return textResult(`texto escrito en ${serial}.`, { serial, action });
          }

          case "key": {
            const key = String(params?.key ?? "").trim();
            driver.inputKey(serial, key);
            recordMobileActivity("action", `tecla ${key}`);
            return textResult(`tecla ${key} enviada a ${serial}.`, { serial, action, key });
          }

          case "swipe": {
            const x1 = readNumber(params?.x1);
            const y1 = readNumber(params?.y1);
            const x2 = readNumber(params?.x2);
            const y2 = readNumber(params?.y2);

            if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
              return errorResult("swipe requiere x1, y1, x2, y2.", { serial });
            }

            const durationMs = readNumber(params?.durationMs) ?? 300;
            driver.swipe(serial, x1, y1, x2, y2, durationMs);
            recordMobileActivity(
              "action",
              `deslizando (${x1}, ${y1}) → (${x2}, ${y2})`,
            );

            return textResult(
              `swipe (${x1}, ${y1}) → (${x2}, ${y2}) en ${durationMs}ms ejecutado en ${serial}.`,
              { serial, action, x1, y1, x2, y2, durationMs },
            );
          }

          case "launch": {
            const packageName = String(params?.package ?? "").trim();
            if (!packageName) {
              return errorResult("package requerido para launch.", { serial });
            }

            driver.launch(serial, packageName);
            recordMobileActivity("action", `lanzando ${packageName}`);
            return textResult(`paquete ${packageName} lanzado en ${serial}.`, {
              serial,
              action,
              package: packageName,
            });
          }

          case "stop": {
            const packageName = String(params?.package ?? "").trim();
            if (!packageName) {
              return errorResult("package requerido para stop.", { serial });
            }

            driver.forceStop(serial, packageName);
            recordMobileActivity("action", `deteniendo ${packageName}`);
            return textResult(`paquete ${packageName} detenido en ${serial}.`, {
              serial,
              action,
              package: packageName,
            });
          }

          default:
            return errorResult(
              `acción desconocida: ${action || "(vacía)"}. Usá tap, text, key, swipe, launch o stop.`,
              { serial },
            );
        }
      } catch (error) {
        recordMobileActivity("error", errorMessage(error));
        return errorResult(`Error en dc_mobile_action: ${errorMessage(error)}`);
      }
    },
  });

  // S14 — dc_mobile_connect
  pi.registerTool({
    name: "dc_mobile_connect",
    label: "DC Mobile Connect",
    description:
      "Conecta un dispositivo Android por USB (detección automática) o por Wi-Fi (dirección IP:puerto, opcionalmente con código de vinculación de 6 dígitos).",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["usb", "wifi"],
          description: "Modo de conexión: usb o wifi",
        },
        address: {
          type: "string",
          description: "Wi-Fi: dirección host:puerto (ej. 192.168.1.50:5555)",
        },
        code: {
          type: "string",
          description: "Wi-Fi: código de vinculación de 6 dígitos (opcional, ejecuta adb pair)",
        },
      },
      required: ["mode"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      const mode = String(params?.mode ?? "").trim().toLowerCase();

      if (mode !== "usb" && mode !== "wifi") {
        return errorResult("modo inválido: usá usb o wifi.", { mode });
      }

      const driver = createDcMobileSupervisedDriver();

      try {
        if (!driver.isAvailable()) {
          recordMobileActivity("error", "adb no disponible");
          return errorResult(DC_ADB_UNAVAILABLE_MESSAGE, { adbAvailable: false });
        }

        if (mode === "usb") {
          recordMobileActivity("discover", "buscando dispositivos");
          const outcome = connectUsb(driver);

          if (!outcome.ok) {
            recordMobileActivity(outcome.guided ? "discover" : "error", outcome.message);
            if (outcome.guided) {
              // A pending RSA fingerprint is a guided next step, not an error.
              return textResult(outcome.message, {
                mode: "usb",
                needsAuthorization: true,
                ...(outcome.serial ? { serial: outcome.serial } : {}),
              });
            }
            return errorResult(outcome.message, { mode: "usb" });
          }

          const serial = outcome.serial ?? "";
          recordMobileActivity("connect", "conectado (device)");
          saveConnectionPrefs({ lastSerial: serial, mode: "usb" });
          ensureUsbAutoAttach();

          return textResult(outcome.message, { serial, mode: "usb" });
        }

        let address = String(params?.address ?? "").trim();
        if (!address) {
          // S17: offer the mDNS-discovered address before requiring typing.
          address = discoverMdnsAddresses()[0] ?? "";
        }
        if (!address) {
          recordMobileActivity("error", "address requerido para mode wifi.");
          return errorResult("address requerido para mode wifi.", { mode: "wifi" });
        }

        const code = String(params?.code ?? "").trim();
        recordMobileActivity(
          code ? "pair" : "connect",
          code ? `vinculando ${address}` : `conectando ${address}`,
        );
        const outcome = code
          ? pairWifi(driver, address, code)
          : connectWifi(driver, address);

        if (!outcome.ok) {
          recordMobileActivity("error", outcome.message);
          return errorResult(outcome.message, {
            mode: "wifi",
            address,
            ...(outcome.paired ? { paired: true } : {}),
          });
        }

        recordMobileActivity("connect", "conectado (device)");
        saveConnectionPrefs({
          lastSerial: outcome.serial,
          mode: "wifi",
          lastWifiAddress: address,
        });

        return textResult(`Conectado por Wi-Fi a ${outcome.serial}.`, {
          serial: outcome.serial,
          mode: "wifi",
          address,
        });
      } catch (error) {
        recordMobileActivity("error", errorMessage(error));
        return errorResult(`Error en dc_mobile_connect: ${errorMessage(error)}`, {
          mode,
        });
      }
    },
  });
}
