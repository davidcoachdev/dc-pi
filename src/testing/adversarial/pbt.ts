/**
 * DC Studio - Native Property-Based Testing (PBT) Engine
 * Zero-Dependencies, Seedable PRNG (Mulberry32) & Integrated Rose Tree Shrinking.
 */

export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = (seed ^ 0x6d2b79f5) >>> 0;
  }

  /** Retorna un entero de 32 bits sin signo en el rango [0, 0xFFFFFFFF] */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Retorna un número flotante en el rango [0, 1) */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Retorna un entero uniforme en el rango [min, max] ambos inclusivos */
  nextInt(min: number, max: number): number {
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    const range = max - min + 1;
    return min + Math.floor(this.nextFloat() * range);
  }

  /** Retorna un valor booleano pseudoaleatorio */
  boolean(): boolean {
    return (this.nextUint32() & 1) === 1;
  }

  /** Selecciona un elemento aleatorio de un arreglo */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty array");
    }
    const idx = this.nextInt(0, items.length - 1);
    return items[idx];
  }
}

/**
 * Lazy Rose Tree para Integrated Shrinking.
 * Contiene el valor actual y una función generadora que evalúa perezosamente
 * los árboles hijos simplificados (shrunk candidates).
 */
export interface Tree<T> {
  readonly value: T;
  shrinks(): IterableIterator<Tree<T>>;
}

export function tree<T>(value: T, shrinks: () => IterableIterator<Tree<T>>): Tree<T> {
  return { value, shrinks };
}

export interface Arbitrary<T> {
  generate(rng: PRNG): Tree<T>;
}

// -----------------------------------------------------------------------------
// ARBITRARIOS PRIMITIVOS & SHRUNK GENERATORS
// -----------------------------------------------------------------------------

/**
 * Arbitrario de enteros con reducción por bisección (búsqueda binaria hacia target).
 */
export function integer(min = -1000, max = 1000): Arbitrary<number> {
  return {
    generate(rng: PRNG): Tree<number> {
      const val = rng.nextInt(min, max);
      const target = (min <= 0 && max >= 0) ? 0 : min;
      return shrinkInteger(val, target);
    }
  };
}

function shrinkInteger(val: number, target: number): Tree<number> {
  return tree(val, function* () {
    if (val === target) return;

    // 1. Probar el valor target canónico de inmediato (ej: 0)
    yield shrinkInteger(target, target);

    // 2. Bisección: reducir la distancia a la mitad iterativamente
    let diff = Math.trunc((val - target) / 2);
    while (Math.abs(diff) > 0) {
      const candidate = val - diff;
      if (candidate !== target) {
        yield shrinkInteger(candidate, target);
      }
      diff = Math.trunc(diff / 2);
    }
  });
}

/**
 * Arbitrario booleano: true reduce a false.
 */
export function boolean(): Arbitrary<boolean> {
  return {
    generate(rng: PRNG): Tree<boolean> {
      const val = rng.boolean();
      return tree(val, function* () {
        if (val === true) {
          yield tree(false, function* () {});
        }
      });
    }
  };
}

/**
 * Arbitrario de cadenas de texto con reducción por longitud y caracteres.
 */
const DEFAULT_CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.:,;/";

export function string(options: { minLength?: number; maxLength?: number; charset?: string } = {}): Arbitrary<string> {
  const minLen = options.minLength ?? 0;
  const maxLen = options.maxLength ?? 20;
  const charset = options.charset ?? DEFAULT_CHARSET;

  return {
    generate(rng: PRNG): Tree<string> {
      const len = rng.nextInt(minLen, maxLen);
      const chars: string[] = [];
      for (let i = 0; i < len; i++) {
        chars.push(charset[rng.nextInt(0, charset.length - 1)]);
      }
      return shrinkString(chars.join(""), minLen);
    }
  };
}

function shrinkString(val: string, minLen: number): Tree<string> {
  return tree(val, function* () {
    if (val.length <= minLen) return;

    // 1. Intentar de inmediato longitud mínima o vacía
    if (minLen === 0) {
      yield shrinkString("", 0);
    }

    // 2. Halving: primera mitad y segunda mitad
    const half = Math.floor(val.length / 2);
    if (half >= minLen) {
      yield shrinkString(val.slice(0, half), minLen);
      yield shrinkString(val.slice(half), minLen);
    }

    // 3. Quitar un carácter secuencialmente
    for (let i = 0; i < val.length; i++) {
      if (val.length - 1 >= minLen) {
        const candidate = val.slice(0, i) + val.slice(i + 1);
        yield shrinkString(candidate, minLen);
      }
    }
  });
}

/**
 * Arbitrario de arreglos homogéneos con reducción estructural (longitud + elementos).
 */
export function array<T>(elementArb: Arbitrary<T>, options: { minLength?: number; maxLength?: number } = {}): Arbitrary<T[]> {
  const minLen = options.minLength ?? 0;
  const maxLen = options.maxLength ?? 10;

  return {
    generate(rng: PRNG): Tree<T[]> {
      const len = rng.nextInt(minLen, maxLen);
      const itemTrees: Tree<T>[] = [];
      for (let i = 0; i < len; i++) {
        itemTrees.push(elementArb.generate(rng));
      }
      return shrinkArray(itemTrees, minLen);
    }
  };
}

function shrinkArray<T>(itemTrees: Tree<T>[], minLen: number): Tree<T[]> {
  const currentVal = itemTrees.map(t => t.value);

  return tree(currentVal, function* () {
    // 1. Reducción de tamaño: array de longitud mínima
    if (itemTrees.length > minLen) {
      yield shrinkArray(itemTrees.slice(0, minLen), minLen);

      // 2. Bisección de longitud: primera y segunda mitad
      const half = Math.floor(itemTrees.length / 2);
      if (half >= minLen) {
        yield shrinkArray(itemTrees.slice(0, half), minLen);
        yield shrinkArray(itemTrees.slice(half), minLen);
      }

      // 3. Quitar un elemento individual
      for (let i = 0; i < itemTrees.length; i++) {
        if (itemTrees.length - 1 >= minLen) {
          const removed = [...itemTrees.slice(0, i), ...itemTrees.slice(i + 1)];
          yield shrinkArray(removed, minLen);
        }
      }
    }

    // 4. Shrinking en profundidad de cada elemento individual
    for (let i = 0; i < itemTrees.length; i++) {
      for (const shrunkChild of itemTrees[i].shrinks()) {
        const nextItems = [...itemTrees];
        nextItems[i] = shrunkChild;
        yield shrinkArray(nextItems, minLen);
      }
    }
  });
}

/**
 * Combinador de objetos / registros tipados.
 */
export function record<T extends Record<string, any>>(shape: { [K in keyof T]: Arbitrary<T[K]> }): Arbitrary<T> {
  const keys = Object.keys(shape) as (keyof T)[];

  return {
    generate(rng: PRNG): Tree<T> {
      const currentObj = {} as T;
      const currentTrees = {} as { [K in keyof T]: Tree<T[K]> };

      for (const k of keys) {
        const t = shape[k].generate(rng);
        currentTrees[k] = t;
        currentObj[k] = t.value;
      }

      return shrinkRecord(currentTrees, keys);
    }
  };
}

function shrinkRecord<T extends Record<string, any>>(
  trees: { [K in keyof T]: Tree<T[K]> },
  keys: (keyof T)[]
): Tree<T> {
  const val = {} as T;
  for (const k of keys) {
    val[k] = trees[k].value;
  }

  return tree(val, function* () {
    for (const k of keys) {
      for (const shrunkField of trees[k].shrinks()) {
        const nextTrees = { ...trees, [k]: shrunkField };
        yield shrinkRecord(nextTrees, keys);
      }
    }
  });
}

/**
 * Arbitrario de valor constante (no reducible).
 */
export function constant<T>(value: T): Arbitrary<T> {
  return {
    generate(): Tree<T> {
      return tree(value, function* () {});
    }
  };
}

/**
 * Selecciona pseudoaleatoriamente entre múltiples arbitrarios.
 */
export function oneOf<T>(...arbs: Arbitrary<T>[]): Arbitrary<T> {
  if (arbs.length === 0) {
    throw new Error("oneOf requires at least one Arbitrary");
  }

  return {
    generate(rng: PRNG): Tree<T> {
      const selected = rng.pick(arbs);
      return selected.generate(rng);
    }
  };
}

// -----------------------------------------------------------------------------
// RUNNER & SHRINK LOOP
// -----------------------------------------------------------------------------

export interface PropertySuccess {
  ok: true;
  runs: number;
  seed: number;
}

export interface PropertyFailure<T> {
  ok: false;
  runs: number;
  seed: number;
  counterexample: T;
  shrinkSteps: number;
  error: string;
}

export type PropertyResult<T> = PropertySuccess | PropertyFailure<T>;

export interface CheckOptions {
  numRuns?: number;
  seed?: number;
  maxShrinkSteps?: number;
}

/**
 * Ejecuta una prueba de propiedad basada en invariantes con reducción automática a contraejemplo mínimo.
 */
export function check<T>(
  arb: Arbitrary<T>,
  predicate: (val: T) => boolean | void,
  options: CheckOptions = {}
): PropertyResult<T> {
  const seed = options.seed ?? ((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
  const numRuns = options.numRuns ?? 100;
  const maxShrinkSteps = options.maxShrinkSteps ?? 1000;
  const rng = new PRNG(seed);

  for (let run = 1; run <= numRuns; run++) {
    const rootTree = arb.generate(rng);
    let failed = false;
    let failureMsg = "";

    try {
      const res = predicate(rootTree.value);
      if (res === false) {
        failed = true;
      }
    } catch (err: any) {
      failed = true;
      failureMsg = err?.message || String(err);
    }

    if (failed) {
      // Iniciar el Greedy Shrink Loop
      let currentFailingTree = rootTree;
      let shrinkSteps = 0;
      let deepened = true;

      while (deepened && shrinkSteps < maxShrinkSteps) {
        deepened = false;
        for (const child of currentFailingTree.shrinks()) {
          let childFailed = false;
          try {
            if (predicate(child.value) === false) {
              childFailed = true;
            }
          } catch {
            childFailed = true;
          }

          if (childFailed) {
            currentFailingTree = child;
            shrinkSteps++;
            deepened = true;
            break; // Avanzar codiciosamente por la rama que reproduce la falla
          }
        }
      }

      return {
        ok: false,
        runs: run,
        seed,
        counterexample: currentFailingTree.value,
        shrinkSteps,
        error: failureMsg || "Invariant predicate returned false"
      };
    }
  }

  return { ok: true, runs: numRuns, seed };
}

/**
 * Validador estricto que lanza una aserción si la propiedad es falseada.
 */
export function assertProperty<T>(
  arb: Arbitrary<T>,
  predicate: (val: T) => boolean | void,
  options: CheckOptions = {}
): void {
  const result = check(arb, predicate, options);
  if (!result.ok) {
    throw new Error(
      `Property falsified after ${result.runs} runs (Seed: ${result.seed}, Shrink steps: ${result.shrinkSteps}):\n` +
      `Counterexample: ${JSON.stringify(result.counterexample)}\n` +
      `Cause: ${result.error}`
    );
  }
}
