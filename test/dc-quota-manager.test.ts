import test from 'node:test';
import assert from 'node:assert';
import { QuotaManager, CandidateQuotaStatus } from '../src/features/dc-quota/core/dc-quota-manager.js';

test('QuotaManager selects first eligible candidate below threshold', () => {
  const qm = new QuotaManager({ quotaThresholdPercent: 95 });
  const slots = ['provider/model-a', 'provider/model-b'];
  const statuses: CandidateQuotaStatus[] = [
    { candidateId: 'provider/model-a', windows: [{ usedPercent: 98, limitWindowSeconds: 18000 }], isVerified: true },
    { candidateId: 'provider/model-b', windows: [{ usedPercent: 40, limitWindowSeconds: 18000 }], isVerified: true }
  ];

  const selected = qm.selectBestCandidate(slots, statuses);
  assert.strictEqual(selected, 'provider/model-b');
});

test('QuotaManager skips unverified or insufficient quota candidates', () => {
  const qm = new QuotaManager({ quotaThresholdPercent: 95 });
  const slots = ['provider/model-a', 'provider/model-b'];
  const statuses: CandidateQuotaStatus[] = [
    { candidateId: 'provider/model-a', windows: [{ usedPercent: 10, limitWindowSeconds: 18000 }], isVerified: false },
    { candidateId: 'provider/model-b', windows: [{ usedPercent: 20, limitWindowSeconds: 18000 }], isVerified: true, insufficientQuota: true }
  ];

  const selected = qm.selectBestCandidate(slots, statuses);
  assert.strictEqual(selected, null);
});

test('QuotaManager respects strict numeric 95% boundary', () => {
  const qm = new QuotaManager({ quotaThresholdPercent: 95 });
  const slots = ['provider/model-a'];
  const statuses: CandidateQuotaStatus[] = [
    { candidateId: 'provider/model-a', windows: [{ usedPercent: 95.0, limitWindowSeconds: 18000 }], isVerified: true }
  ];

  const selected = qm.selectBestCandidate(slots, statuses);
  assert.strictEqual(selected, null);
});
