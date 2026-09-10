import test from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/discovery.js';
import type { Surface } from '../src/surface.js';

// Offline fault injection only: no model server, browser, or published discovery evidence.
test('provider failures preserve evidence and invalid decisions reach bounded handoff', async t => {
  const originalFetch = globalThis.fetch;
  const originalProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = 'ollama';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = originalProvider;
  });
  const cases: Array<{ name: string; response: () => Promise<Response>; code: string; calls: number; handoffs: number }> = [
    { name: 'transport refusal', response: async () => { throw new TypeError('connection refused'); }, code: 'model_transport_error', calls: 1, handoffs: 0 },
    { name: 'HTTP failure', response: async () => new Response('unavailable', { status: 503 }), code: 'model_api_error', calls: 1, handoffs: 0 },
    { name: 'malformed model JSON', response: async () => Response.json({ message: { content: '{invalid' } }), code: 'discovery_incomplete', calls: 2, handoffs: 1 },
    { name: 'unobserved control', response: async () => Response.json({ message: { content: JSON.stringify({ action: 'click', control: 'button: Invented', value: null, output: null, reason: 'offline', checkpointText: null }) } }), code: 'discovery_incomplete', calls: 2, handoffs: 1 },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const failures: string[] = [];
    const events: Record<string, unknown>[] = [];
    let calls = 0; let handoffs = 0;
    globalThis.fetch = async () => { calls++; return scenario.response(); };
    const surface: Surface = {
      observe: async () => '/workspace:\n- textbox "Member ID"\n- button "Search"',
      act: async () => { assert.fail('Invalid provider responses must not execute UI actions'); },
      matches: async () => false,
      log: async event => { events.push(event); },
      failure: async code => { failures.push(code); },
      handoff: async () => { handoffs++; return false; },
    };
    await assert.rejects(discover(surface, { goal: 'Read savings balance', inputs: { member_id: '12345' }, name: 'get_savings_balance', maxSteps: 2 }));
    assert.equal(calls, scenario.calls);
    assert.equal(handoffs, scenario.handoffs);
    assert.deepEqual(failures, [scenario.code]);
    if (scenario.handoffs) assert.equal(events.filter(event => event.event === 'decision_rejected').length, 2);
  });
});
