/**
 * DC Studio - Adversarial Testing Suite (Zero-Dependencies)
 * Property-Based Testing (PBT), Havoc Fuzzing & Anti-Hang Watchdog.
 */

// Property-Based Testing (PBT)
export {
  PRNG,
  type Tree,
  tree,
  type Arbitrary,
  integer,
  boolean,
  string,
  array,
  record,
  constant,
  oneOf,
  type PropertySuccess,
  type PropertyFailure,
  type PropertyResult,
  type CheckOptions,
  check,
  assertProperty
} from "./pbt.ts";

// Fuzzing & Watchdog
export {
  type ByteBuffer,
  type FuzzCrash,
  type FuzzOptions,
  type WatchdogOptions,
  type MutatorFn,
  FuzzMutator,
  fuzzInProcess,
  fuzzWithWatchdog
} from "./fuzzer.ts";
