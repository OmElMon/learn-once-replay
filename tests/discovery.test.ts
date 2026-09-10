import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startDemo } from '../src/demo.js';
import { BrowserSurface } from '../src/surface.js';
import { discover } from '../src/discovery.js';
import { capabilitySchema } from '../src/schema.js';
import { replay } from '../src/replay.js';

// Scripted provider responses exercise integration only; never published as live LLM evidence.
const role = (value: string, name: string) => ({ kind: 'role', value, name, frame: '/workspace' });
const decision = (action: string, fields: Record<string, unknown> = {}) => ({
  action, locator: null, value: null, output: null, reason: 'Offline test decision', checkpoint: null, ...fields,
});

test('offline discovery integration: scripted provider, real browser, reusable artifact and bounded failure', async t => {
  const server = startDemo(0); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  const root = await mkdtemp(join(tmpdir(), 'lor-offline-discovery-'));
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  const originalProvider = process.env.LLM_PROVIDER;
  const originalOllamaModel = process.env.OLLAMA_MODEL;
  process.env.OPENAI_API_KEY = 'offline-test-key';
  process.env.OPENAI_MODEL = 'offline-test-model';
  process.env.LLM_PROVIDER = 'openai';
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel;
    if (originalProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = originalProvider;
    if (originalOllamaModel === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = originalOllamaModel;
    server.close(); await rm(root, { recursive: true, force: true });
  });

  for (const provider of ['openai', 'ollama']) await t.test(`${provider}: discovers parameter templates then replays a different member without model calls`, async () => {
    if (provider === 'ollama') {
      delete process.env.LLM_PROVIDER;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OLLAMA_MODEL;
    } else process.env.LLM_PROVIDER = 'openai';
    const scripted = [
      decision('fill', { locator: provider === 'ollama' ? role('textbox', 'Member ID') : { kind: 'label', value: 'Member ID', name: null, frame: '/workspace' }, value: '{{member_id}}' }),
      decision('click', { locator: role('button', 'Search') }),
      decision('click', { locator: role('link', 'Savings account') }),
      decision('read', { locator: role('status', 'Account balance'), output: 'savings_balance' }),
      decision('done', { checkpoint: { locator: role('heading', 'Savings balance'), text: 'Savings balance' } }),
    ];
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      assert.equal(init?.method, 'POST');
      const body = String(init?.body); assert.ok(!body.includes('12345'));
      const request = JSON.parse(body);
      assert.ok(calls < scripted.length, 'Unexpected extra model call');
      if (provider === 'ollama') {
        assert.equal(input, 'http://127.0.0.1:11434/api/chat');
        assert.equal(new Headers(init?.headers).has('Authorization'), false);
        assert.equal(request.model, 'qwen2.5:3b');
        assert.equal(request.stream, false);
        assert.equal(request.options.num_predict, 1000);
        assert.equal(request.format.type, 'object');
        assert.ok(request.format.properties.action);
        assert.ok(request.format.properties.control);
        assert.ok(Array.isArray(request.messages));
        const screen = JSON.parse(request.messages[1].content.split('\nCURRENT SCREEN')[0]);
        const next = scripted[calls++]!;
        const checkpoint = next.checkpoint as { locator: Record<string, unknown>; text: string } | null;
        const target = (next.locator ?? checkpoint?.locator) as Record<string, unknown>;
        const selected = screen.visibleControls.find((control: Record<string, unknown>) =>
          ['kind', 'value', 'name', 'frame'].every(key => (control[key] ?? null) === (target[key] ?? null)));
        assert.ok(selected, 'Scripted action must reference a currently visible control');
        assert.equal(typeof selected.id, 'string');
        const compact = { action: next.action, control: selected.id, value: next.value, output: next.output,
          reason: next.reason, checkpointText: checkpoint?.text ?? null };
        return Response.json({ message: { content: JSON.stringify(compact) }, prompt_eval_count: 1, eval_count: 1, done: true });
      }
      assert.equal(input, 'https://api.openai.com/v1/responses');
      assert.equal(request.store, false); assert.ok(request.max_output_tokens <= 1000);
      assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.text.format.strict, true);
      assert.equal(request.model, 'offline-test-model');
      return Response.json({ id: `offline_${++calls}`, usage: { input_tokens: 1, output_tokens: 1 },
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(scripted[calls - 1]) }] }] });
    };
    const discovery = new BrowserSurface({ url, directory: join(root, provider, 'discovery'), headless: true, secrets: ['12345'], handoffTimeoutMs: 1 });
    const playback = new BrowserSurface({ url, directory: join(root, provider, 'replay'), headless: true, secrets: ['67890'], handoffTimeoutMs: 1 });
    try {
      await discovery.open();
      const artifact = capabilitySchema.parse(await discover(discovery, {
        goal: 'Retrieve savings balance for member 12345', inputs: { member_id: '12345' }, name: 'get_savings_balance', maxSteps: 5,
      }));
      assert.equal(calls, 5); assert.equal(artifact.steps.length, 4);
      assert.equal(artifact.steps[0]?.value, '{{member_id}}');
      const serialized = JSON.stringify(artifact);
      for (const privateValue of ['12345', '67890', '$1,250.75', '$8,420.50']) assert.ok(!serialized.includes(privateValue));
      await playback.open();
      const result = await replay(playback, artifact, { member_id: '67890' });
      assert.equal(result.status, 'success', JSON.stringify(result));
      assert.equal(result.outputs.savings_balance, '$8,420.50');
      assert.equal(calls, 5, 'Replay must not call the model');
      const logs = await readFile(join(root, provider, 'discovery', 'events.jsonl'), 'utf8');
      assert.ok(!logs.includes('12345')); assert.ok(!logs.includes('offline-test-key'));
    } finally { await discovery.close(); await playback.close(); }
  });

  await t.test('invalid literal fill exhausts one-call budget without producing a capability', async () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'offline-test-key';
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(
        decision('fill', { locator: { kind: 'label', value: 'Member ID', name: null, frame: '/workspace' }, value: '12345' }),
      ) }] }] });
    };
    const directory = join(root, 'bounded-failure');
    const surface = new BrowserSurface({ url, directory, headless: true, secrets: ['12345'], handoffTimeoutMs: 1 });
    try {
      await surface.open();
      await assert.rejects(discover(surface, { goal: 'Read savings balance', inputs: { member_id: '12345' }, name: 'get_savings_balance', maxSteps: 1 }), /bounded budget/);
      assert.equal(calls, 1);
      const files = await readdir(directory);
      assert.deepEqual(files.sort(), ['events.jsonl', 'failure-state.json']);
      const failure = JSON.parse(await readFile(join(directory, 'failure-state.json'), 'utf8'));
      assert.equal(failure.code, 'discovery_incomplete');
      assert.equal(await surface.page.frameLocator('iframe').getByLabel('Member ID', { exact: true }).inputValue(), '');
    } finally { await surface.close(); }
  });
});
