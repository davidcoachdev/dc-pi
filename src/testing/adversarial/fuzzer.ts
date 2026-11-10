/**
 * DC Studio - Native Fuzzing Engine & Isolated Watchdog Harness
 * Zero-Dependencies, Havoc Mutator on Buffers & Anti-Hang Worker Supervision.
 */

import { Worker } from "node:worker_threads";
import { PRNG } from "./pbt.ts";

export type ByteBuffer = Buffer<ArrayBufferLike>;

export interface FuzzCrash {
  type: "CRASH_EXCEPTION" | "CPU_HANG_TIMEOUT";
  input: ByteBuffer;
  inputString: string;
  error?: string;
  iteration: number;
}

export interface FuzzOptions {
  iterations?: number;
  seed?: number;
  initialCorpus?: (ByteBuffer | string)[];
  maxMutationRounds?: number;
}

export type MutatorFn = (buf: ByteBuffer, rng: PRNG) => ByteBuffer;

/**
 * Motor de mutación destructiva inspirado en el modo Havoc de AFL/libFuzzer.
 */
export class FuzzMutator {
  private dictionary: ByteBuffer[] = [];
  private mutators: MutatorFn[] = [];

  constructor(customDictionary?: (string | ByteBuffer)[]) {
    this.registerDefaultMutators();
    this.loadHostileDictionary();

    if (customDictionary) {
      for (const item of customDictionary) {
        this.dictionary.push(Buffer.isBuffer(item) ? item : Buffer.from(item, "utf-8"));
      }
    }
  }

  /**
   * Aplica de 1 a N mutaciones Havoc encadenadas sobre un Buffer.
   */
  mutate(input: ByteBuffer, rng: PRNG, maxRounds = 4): ByteBuffer {
    if (input.length === 0) {
      return Buffer.from([rng.nextInt(0, 255)]);
    }

    const rounds = rng.nextInt(1, Math.max(1, maxRounds));
    let output: ByteBuffer = Buffer.from(input);

    for (let i = 0; i < rounds; i++) {
      const mutator = this.mutators[rng.nextInt(0, this.mutators.length - 1)];
      output = mutator(output, rng);
    }

    return output;
  }

  /**
   * Atajo para mutar strings manteniendo codificación UTF-8.
   */
  mutateString(input: string, rng: PRNG, maxRounds = 4): string {
    const buf = Buffer.from(input, "utf-8");
    const mutated = this.mutate(buf, rng, maxRounds);
    return mutated.toString("utf-8");
  }

  private registerDefaultMutators(): void {
    // 1. Bit Flip: Invertir 1 bit arbitrario
    this.mutators.push((buf, rng) => {
      const out = Buffer.from(buf);
      const byteIdx = rng.nextInt(0, out.length - 1);
      const bitIdx = rng.nextInt(0, 7);
      out[byteIdx] ^= (1 << bitIdx);
      return out;
    });

    // 2. Byte Overwrite: Sobrescribir un byte con un valor aleatorio
    this.mutators.push((buf, rng) => {
      const out = Buffer.from(buf);
      const byteIdx = rng.nextInt(0, out.length - 1);
      out[byteIdx] = rng.nextInt(0, 255);
      return out;
    });

    // 3. Byte Deletion: Suprimir un fragmento contiguo
    this.mutators.push((buf, rng) => {
      if (buf.length <= 1) return buf;
      const start = rng.nextInt(0, buf.length - 1);
      const len = rng.nextInt(1, Math.min(16, buf.length - start));
      return Buffer.concat([buf.subarray(0, start), buf.subarray(start + len)]);
    });

    // 4. Byte Insertion: Insertar una secuencia aleatoria de bytes
    this.mutators.push((buf, rng) => {
      const pos = rng.nextInt(0, buf.length);
      const insertLen = rng.nextInt(1, 16);
      const chunk = Buffer.alloc(insertLen);
      for (let i = 0; i < insertLen; i++) {
        chunk[i] = rng.nextInt(0, 255);
      }
      return Buffer.concat([buf.subarray(0, pos), chunk, buf.subarray(pos)]);
    });

    // 5. Block Duplication: Clonar e insertar un bloque existente
    this.mutators.push((buf, rng) => {
      if (buf.length <= 1) return buf;
      const start = rng.nextInt(0, buf.length - 1);
      const len = rng.nextInt(1, Math.min(32, buf.length - start));
      const chunk = buf.subarray(start, start + len);
      const insertPos = rng.nextInt(0, buf.length);
      return Buffer.concat([buf.subarray(0, insertPos), chunk, buf.subarray(insertPos)]);
    });

    // 6. Hostile Dictionary Injection: Inserción o reemplazo con token hostil
    this.mutators.push((buf, rng) => {
      if (this.dictionary.length === 0) return buf;
      const token = this.dictionary[rng.nextInt(0, this.dictionary.length - 1)];
      const pos = rng.nextInt(0, buf.length);

      // 50% reemplazar, 50% insertar
      if (rng.boolean() && pos + token.length <= buf.length) {
        const out = Buffer.from(buf);
        token.copy(out, pos);
        return out;
      } else {
        return Buffer.concat([buf.subarray(0, pos), token, buf.subarray(pos)]);
      }
    });
  }

  private loadHostileDictionary(): void {
    const hostileTokens: string[] = [
      // Prototype Pollution
      "__proto__",
      "constructor",
      "prototype",
      "{\"__proto__\":{\"polluted\":true}}",
      // C-strings & Null bytes
      "\0",
      "%00",
      "\\0",
      "\x00",
      // ANSI escapes y terminal control
      "\x1b[2J",
      "\x1b[31m",
      "\x1b]0;pwned\x07",
      "\u001b[0m",
      // IEEE-754 y representaciones numéricas anómalas
      "NaN",
      "Infinity",
      "-Infinity",
      "-0",
      "9007199254740992", // MAX_SAFE_INTEGER + 1
      "1e309",
      "1e-324",
      // Path Traversal
      "../",
      "..\\",
      "../../../../etc/passwd",
      "..\\..\\..\\windows\\win.ini",
      // ReDoS triggers (backtracking exponencial)
      "a".repeat(1000) + "!",
      "((((((a+)+)+)+)+)+)",
      // Unicode & Caracteres de control
      "\u202E", // RTL Override
      "\u200B", // Zero-width space
      "\uFEFF", // BOM
      "\uD800", // High surrogate huérfano
      "\uDFFF"  // Low surrogate huérfano
    ];

    this.dictionary = hostileTokens.map(s => Buffer.from(s, "utf-8"));
  }
}

// -----------------------------------------------------------------------------
// ARNESES DE EJECUCIÓN: IN-PROCESS & ISOLATED WATCHDOG
// -----------------------------------------------------------------------------

/**
 * Arnés rápido síncrono in-process para targets con ejecución acotada.
 * Excelente para parsers, serializadores y funciones puras (>20k ops/seg).
 */
export function fuzzInProcess(
  target: (data: ByteBuffer, dataStr: string) => void,
  options: FuzzOptions = {}
): FuzzCrash | null {
  const seed = options.seed ?? ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
  const iters = options.iterations ?? 1000;
  const maxRounds = options.maxMutationRounds ?? 4;
  const rng = new PRNG(seed);
  const mutator = new FuzzMutator();

  let corpus: ByteBuffer[] = [];
  if (options.initialCorpus && options.initialCorpus.length > 0) {
    corpus = options.initialCorpus.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c, "utf-8"));
  } else {
    corpus = [Buffer.from("seed_initial_state_12345", "utf-8")];
  }

  for (let i = 1; i <= iters; i++) {
    const parent = rng.pick(corpus);
    const mutated = mutator.mutate(parent, rng, maxRounds);
    const str = mutated.toString("utf-8");

    try {
      target(mutated, str);
    } catch (err: any) {
      return {
        type: "CRASH_EXCEPTION",
        input: mutated,
        inputString: str,
        error: err?.stack || String(err),
        iteration: i
      };
    }

    // Rotar corpus periódicamente para ampliar cobertura de exploración
    if (i % 50 === 0 && corpus.length < 50) {
      corpus.push(mutated);
    }
  }

  return null;
}

export interface WatchdogOptions extends FuzzOptions {
  timeoutMs?: number;
}

/**
 * Arnés de aislamiento en Worker Thread con temporizador Watchdog.
 * Previene congelamientos del Event Loop causados por ReDoS o bucles infinitos.
 */
export async function fuzzWithWatchdog(
  targetScriptSource: string,
  options: WatchdogOptions = {}
): Promise<FuzzCrash | null> {
  const seed = options.seed ?? ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
  const iters = options.iterations ?? 100;
  const timeoutMs = options.timeoutMs ?? 250;
  const rng = new PRNG(seed);
  const mutator = new FuzzMutator();

  let corpus: ByteBuffer[] = [];
  if (options.initialCorpus && options.initialCorpus.length > 0) {
    corpus = options.initialCorpus.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c, "utf-8"));
  } else {
    corpus = [Buffer.from("safe_initial_payload", "utf-8")];
  }

  // Código del Worker en Node.js que ejecuta la función bajo prueba
  const workerWrapperCode = `
    const { parentPort } = require("node:worker_threads");
    ${targetScriptSource}

    if (typeof targetFn !== "function") {
      throw new Error("targetScriptSource must define a function named 'targetFn(buf, str)'");
    }

    parentPort.on("message", (msg) => {
      if (msg.type === "EXEC") {
        try {
          const buf = Buffer.from(msg.payload, "base64");
          const str = buf.toString("utf-8");
          targetFn(buf, str);
          parentPort.postMessage({ type: "OK" });
        } catch (err) {
          parentPort.postMessage({
            type: "ERROR",
            error: err && err.stack ? err.stack : String(err)
          });
        }
      }
    });
  `;

  for (let i = 1; i <= iters; i++) {
    const parent = rng.pick(corpus);
    const mutated = mutator.mutate(parent, rng);
    const str = mutated.toString("utf-8");
    const payloadBase64 = mutated.toString("base64");

    const crash = await new Promise<FuzzCrash | null>((resolve) => {
      let worker: Worker | null = new Worker(workerWrapperCode, { eval: true });
      let timer: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (worker) {
          worker.terminate().catch(() => {});
          worker = null;
        }
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          type: "CPU_HANG_TIMEOUT",
          input: mutated,
          inputString: str,
          error: `Watchdog triggered: Execution exceeded limit of ${timeoutMs}ms (ReDoS / Unbounded Loop)`,
          iteration: i
        });
      }, timeoutMs);

      worker.on("message", (msg) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (msg.type === "ERROR") {
          resolve({
            type: "CRASH_EXCEPTION",
            input: mutated,
            inputString: str,
            error: msg.error,
            iteration: i
          });
        } else {
          resolve(null);
        }
      });

      worker.on("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          type: "CRASH_EXCEPTION",
          input: mutated,
          inputString: str,
          error: err.stack || String(err),
          iteration: i
        });
      });

      worker.postMessage({ type: "EXEC", payload: payloadBase64 });
    });

    if (crash) {
      return crash;
    }
  }

  return null;
}
