import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilitySchema, type Step } from '../src/schema.js';
import { assertAllowedAction, assertAllowedUrl, defaultPolicy, redact } from '../src/policy.js';
import { fixture } from './fixture.js';

test('capability survives JSON serialization with reusable inputs and recovery rules', () => {
  assert.deepEqual(capabilitySchema.parse(JSON.parse(JSON.stringify(fixture))), fixture);
});

test('artifact rejects untrusted execution fields, unknown frames, and unsupported versions', () => {
  assert.equal(capabilitySchema.safeParse({ ...fixture, schemaVersion: 2 }).success, false);
  const candidate = structuredClone(fixture);
  Object.assign(candidate.steps[0]!, { script: 'process.exit()' });
  assert.equal(capabilitySchema.safeParse(candidate).success, false);
  assert.equal(capabilitySchema.safeParse({ ...fixture, checkpoint: { target: { kind: 'text', value: 'ok', frame: '/admin' }, text: 'ok' } }).success, false);
});

test('artifact rejects missing/unknown inputs, outputs, and duplicate step identifiers', () => {
  for (const change of [
    (c: typeof fixture) => { c.steps[0]!.value = '{{unknown}}'; },
    (c: typeof fixture) => { c.steps[0]!.value = '{{member_id'; },
    (c: typeof fixture) => { c.steps[0]!.value = 'hardcoded-member'; },
    (c: typeof fixture) => { c.steps[3]!.output = 'undeclared'; },
    (c: typeof fixture) => { c.outputs.extra = { type: 'string', description: 'No producer' }; },
    (c: typeof fixture) => { c.steps[1]!.id = c.steps[0]!.id; },
    (c: typeof fixture) => { delete c.steps[0]!.value; },
  ]) {
    const candidate = structuredClone(fixture);
    change(candidate);
    assert.equal(capabilitySchema.safeParse(candidate).success, false);
  }
});

test('recovery clicks require a target and retry budgets are bounded', () => {
  const candidate = structuredClone(fixture);
  delete candidate.steps[0]!.recoveries![0]!.actionTarget;
  assert.equal(capabilitySchema.safeParse(candidate).success, false);
  const excessive = structuredClone(fixture);
  excessive.steps[0]!.recoveries![0]!.maxAttempts = 100;
  assert.equal(capabilitySchema.safeParse(excessive).success, false);
});

test('destination policy requires exact origin and explicitly permitted routes', () => {
  const policy = defaultPolicy('http://127.0.0.1:3100');
  assert.doesNotThrow(() => assertAllowedUrl('http://127.0.0.1:3100/workspace', policy));
  for (const url of ['https://evil.example/workspace', 'http://127.0.0.1:3101/workspace', 'http://127.0.0.1:3100/admin', 'http://user:pass@127.0.0.1:3100/', 'file:///workspace']) {
    assert.throws(() => assertAllowedUrl(url, policy), /policy_denied_destination/);
  }
});

test('policy blocks risky and human-only targets including recovery actions', () => {
  const policy = defaultPolicy('http://127.0.0.1:3100');
  for (const step of fixture.steps) assert.doesNotThrow(() => assertAllowedAction(step, policy));
  for (const name of ['Transfer money', 'Delete member', 'Password', 'Verify session']) {
    const step: Step = { id: 'unsafe', action: 'click', target: { kind: 'role', value: 'button', name } };
    assert.throws(() => assertAllowedAction(step, policy), /policy_denied/);
    const recovery = structuredClone(fixture.steps[0]!);
    recovery.recoveries![0]!.actionTarget = step.target;
    assert.throws(() => assertAllowedAction(recovery, policy), /policy_denied/);
  }
  assert.throws(() => assertAllowedAction(fixture.steps[0]!, { ...policy, allowedActions: ['read'] }), /policy_denied_action/);
});

test('redaction removes nested sensitive keys, supplied inputs, and credential patterns', () => {
  const original = { member_id: '12345', nested: [{ authorization: 'secret', message: 'Member 12345: Bearer abc.def and sk-abcd1234; SSN 123-45-6789' }], balance: '$1,000', safe: 'completed' };
  const result = redact(original, ['12345']);
  const serialized = JSON.stringify(result);
  for (const secret of ['12345', 'abc.def', 'sk-abcd1234', '123-45-6789', '$1,000']) assert.equal(serialized.includes(secret), false);
  assert.equal((result as { safe: string }).safe, 'completed');
  assert.equal(original.member_id, '12345');
});
