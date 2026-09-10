import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startDemo } from '../src/demo.js';
import { BrowserSurface } from '../src/surface.js';
import { replay } from '../src/replay.js';
import { fixture } from './fixture.js';

test('browser replay: parameter reuse, outcome taxonomy, recovery, control transfer, checkpoints', async t => {
  const server = startDemo(0); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const root = await mkdtemp(join(tmpdir(), 'lor-tests-'));
  t.after(async () => { server.close(); await rm(root, { recursive: true, force: true }); });
  for (const scenario of ['normal', 'not-found', 'transient', 'handoff', 'handoff-abort', 'denied', 'invalid', 'checkpoint']) {
    await t.test(scenario, async () => {
      const directory = join(root, scenario);
      const member_id = scenario === 'not-found' ? '99999' : scenario === 'invalid' ? 'x' : '67890';
      const surface = new BrowserSurface({ url: `${base}/?scenario=${scenario === 'handoff-abort' ? 'handoff' : scenario}`, directory, secrets: [member_id], headless: true, handoffTimeoutMs: 50,
        operator: scenario === 'handoff' ? async s => {
          assert.equal(s.owner, 'human');
          await assert.rejects(s.act(fixture.steps[0]!, { member_id }), /does_not_own/);
          await s.page.frameLocator('iframe').getByRole('button', { name: 'Verify session', exact: true }).click();
          await s.page.frameLocator('iframe').getByRole('link', { name: 'Savings account', exact: true }).waitFor();
          s.resume();
        } : scenario === 'handoff-abort' ? async s => { s.resume(false); } : undefined,
      });
      surface.options.handoffTimeoutMs = scenario === 'handoff' ? 5000 : 50;
      try {
        await surface.open();
        const cap = structuredClone(fixture);
        if (scenario === 'checkpoint') cap.checkpoint.text = 'Wrong checkpoint';
        const result = await replay(surface, cap, { member_id });
        if (['normal', 'transient', 'handoff'].includes(scenario)) {
          assert.equal(result.status, 'success', JSON.stringify(result));
          assert.equal(result.outputs.savings_balance, '$8,420.50');
        } else if (scenario === 'not-found') { assert.equal(result.status, 'business_outcome'); assert.equal(result.code, 'member_not_found'); }
        else if (scenario === 'invalid') { assert.equal(result.status, 'business_outcome'); assert.equal(result.code, 'validation_error'); }
        else if (scenario === 'handoff-abort') { assert.equal(result.status, 'intervention_required'); assert.equal(result.code, 'handoff_aborted_or_expired'); }
        else { assert.equal(result.status, 'failed'); assert.equal(result.code, scenario === 'denied' ? 'permission_denied' : 'checkpoint_mismatch'); }
        const logs = await readFile(join(directory, 'events.jsonl'), 'utf8');
        assert.ok(!logs.includes('67890')); assert.ok(!logs.includes('$8,420.50')); assert.ok(!logs.includes('Sam Rivera'));
        if (scenario === 'handoff') { assert.match(logs, /human_action/); assert.match(logs, /"resumed":true/); }
        if (scenario === 'transient') assert.match(logs, /"type":"recovery"/);
      } finally { await surface.close(); }
    });
  }
});
