import test from 'node:test';
import assert from 'node:assert';
import { SubagentPool } from '../src/features/dc-agents/core/dc-subagent-pool.js';

test('SubagentPool acquires least loaded candidate model', () => {
  const pool = new SubagentPool();
  const candidates = ['model-1', 'model-2'];
  const currentPid = process.pid;

  const modelA = pool.acquire('session-1', currentPid, candidates);
  assert.ok(candidates.includes(modelA!));

  const modelB = pool.acquire('session-2', currentPid, candidates);
  assert.ok(candidates.includes(modelB!));
  
  // Active leases should be 2
  assert.strictEqual(pool.getActiveLeases().length, 2);
});

test('SubagentPool releases lease correctly', () => {
  const pool = new SubagentPool();
  const candidates = ['model-1'];
  const currentPid = process.pid;

  pool.acquire('session-1', currentPid, candidates);
  assert.strictEqual(pool.getActiveLeases().length, 1);

  const released = pool.release('session-1', currentPid);
  assert.strictEqual(released, true);
  assert.strictEqual(pool.getActiveLeases().length, 0);
});

test('SubagentPool reclaims lease from dead process pid', () => {
  const pool = new SubagentPool();
  const candidates = ['model-1'];
  const deadPid = 999999; // non-existent PID guaranteed to throw ESRCH

  // Forcefully insert lease with dead pid via acquire or internal state simulation
  // We can test acquire with dead pid owner by mocking or testing release/prune behavior
  const model = pool.acquire('session-dead', deadPid, candidates);
  assert.strictEqual(model, 'model-1');
  
  // Since deadPid is not alive, acquiring or getting active leases should prune it
  const active = pool.getActiveLeases();
  assert.strictEqual(active.length, 0);
});
