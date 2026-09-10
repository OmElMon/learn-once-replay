import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startDemo } from './demo.js';
import { BrowserSurface } from './surface.js';
import { replay } from './replay.js';
import { capabilitySchema } from './schema.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  url: { type: 'string', default: 'http://127.0.0.1:3100' }, goal: { type: 'string' },
  inputs: { type: 'string', default: '{"member_id":"12345"}' }, artifact: { type: 'string' },
  out: { type: 'string', default: 'runs/latest' }, name: { type: 'string', default: 'get_savings_balance' },
  headed: { type: 'boolean', default: false }, 'max-steps': { type: 'string', default: '10' },
} });
async function main() {
  const command = positionals[0];
  if (command === 'demo') {
    const server = startDemo();
    server.on('listening', () => console.log('Synthetic banking UI: http://127.0.0.1:3100'));
    process.on('SIGINT', () => server.close()); return;
  }
  if (command !== 'discover' && command !== 'replay') throw new Error('Use demo, discover, or replay. See README.md.');
  const inputs: unknown = JSON.parse(values.inputs!);
  if (!inputs || Array.isArray(inputs) || typeof inputs !== 'object' || Object.values(inputs).some(v => typeof v !== 'string')) throw new Error('inputs must be a JSON object of strings');
  const params = inputs as Record<string, string>;
  if (command === 'discover') {
    const provider = process.env.LLM_PROVIDER ?? 'ollama';
    if (provider !== 'ollama' && provider !== 'openai') throw new Error('LLM_PROVIDER must be ollama or openai');
    if (provider === 'openai' && (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)) {
      throw new Error('OpenAI discovery requires OPENAI_API_KEY and OPENAI_MODEL. Default local Ollama discovery requires neither.');
    }
  }
  const artifact = command === 'replay' ? capabilitySchema.parse(JSON.parse(await readFile(values.artifact ?? 'tests/example-capability.json', 'utf8'))) : undefined;
  await mkdir(values.out!, { recursive: true });
  const surface = new BrowserSurface({ url: values.url!, directory: values.out!, headless: !values.headed, secrets: Object.values(params), handoffTimeoutMs: values.headed ? 120000 : 1 });
  try {
    await surface.open();
    if (command === 'discover') {
      const { discover } = await import('./discovery.js');
      const capability = await discover(surface, { goal: values.goal ?? 'Look up the supplied member and read their current savings balance.', inputs: params, name: values.name!, maxSteps: Number(values['max-steps']) });
      const path = join(values.out!, 'capability.json');
      await writeFile(path, JSON.stringify(capability, null, 2) + '\n');
      console.log(JSON.stringify({ status: 'success', artifact: path }));
    } else {
      const result = await replay(surface, artifact, params);
      // Returned values belong to the caller; evidence logs redact them. Do not redirect real financial data to disk.
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'failed' || result.status === 'intervention_required') process.exitCode = 1;
    }
  } finally { await surface.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Run failed'); process.exitCode = 1; });
