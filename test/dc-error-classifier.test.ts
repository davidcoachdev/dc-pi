import test from 'node:test';
import assert from 'node:assert';
import { ErrorClassifier } from '../src/features/dc-quota/core/dc-error-classifier.js';

test('ErrorClassifier classifies hard quota correctly', () => {
  const classifier = new ErrorClassifier(3, 1000);
  const result = classifier.classify(new Error('insufficient_quota: you exceeded your current quota'), 'openai/gpt-4o');
  assert.strictEqual(result.action, 'hard_quota_abort');
  assert.ok(result.reason.includes('Hard quota exhaustion'));
});

test('ErrorClassifier handles transient errors and triggers failover after threshold', () => {
  const classifier = new ErrorClassifier(2, 1000);
  const err = { status: 503, message: 'Service Unavailable' };

  const r1 = classifier.classify(err, 'anthropic/claude-3-5-sonnet');
  assert.strictEqual(r1.action, 'retry');

  const r2 = classifier.classify(err, 'anthropic/claude-3-5-sonnet');
  assert.strictEqual(r2.action, 'failover');
});

test('ErrorClassifier detects fatal auth errors', () => {
  const classifier = new ErrorClassifier(3, 1000);
  const result = classifier.classify({ status: 401, message: 'Unauthorized API key' }, 'openai/gpt-4o');
  assert.strictEqual(result.action, 'fatal_halt');
});

test('ErrorClassifier isolates account validation errors into quarantine_account instead of fatal_halt', () => {
  const classifier = new ErrorClassifier(3, 1000);
  const err = { status: 403, message: 'Your current account is not eligible for Antigravity: VALIDATION_REQUIRED' };
  const result = classifier.classify(err, 'gemini-3.8-flash-high', 'acc-user1@gmail.com');
  assert.strictEqual(result.action, 'quarantine_account');
  assert.ok(result.reason.includes('validation or eligibility required'));
});

test('ErrorClassifier isolates invalid_grant or revoked OAuth tokens into quarantine_account', () => {
  const classifier = new ErrorClassifier(3, 1000);
  const err = { status: 400, message: 'invalid_grant: Token has been expired or revoked.' };
  const result = classifier.classify(err, 'gemini-3.8-flash-high', 'acc-user2@gmail.com');
  assert.strictEqual(result.action, 'quarantine_account');
  assert.ok(result.reason.includes('OAuth grant expired or revoked'));
});

test('ErrorClassifier ignores non-critical errors', () => {
  const classifier = new ErrorClassifier(3, 1000);
  const result = classifier.classify(new Error('Some minor warning message'), 'openai/gpt-4o');
  assert.strictEqual(result.action, 'ignore');
});
