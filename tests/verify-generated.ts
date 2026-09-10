/** Verify an actually discovered artifact on fresh sessions; operator below is explicitly simulated. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BrowserSurface } from '../src/surface.js';
import { replay } from '../src/replay.js';
const file = 'evidence/discovery/capability.json';
const bytes = await readFile(file, 'utf8');
const capability: unknown = JSON.parse(bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
for (const scenario of ['normal', 'not-found', 'transient', 'handoff', 'denied']) {
  const directory = scenario === 'normal' ? 'evidence/replay' : `evidence/generated-${scenario}`;
  const member_id = scenario === 'not-found' ? '99999' : '67890';
  const surface = new BrowserSurface({ url: `http://127.0.0.1:3100/?scenario=${scenario}`, directory, secrets: [member_id],
    operator: scenario === 'handoff' ? async s => {
      await s.page.frameLocator('iframe').getByRole('button', { name: 'Verify session', exact: true }).click();
      await s.page.frameLocator('iframe').getByRole('link', { name: 'Savings account', exact: true }).waitFor();
      s.resume();
    } : undefined,
  });
  try {
    await surface.open();
    await surface.log({ type: 'provenance', artifact: file, sha256, discovery: 'genuine local LLM', operator: scenario === 'handoff' ? 'simulated' : 'none' });
    const result = await replay(surface, capability, { member_id });
    console.log(scenario, result.status, result.code ?? '', result.outputs);
    const expected = scenario === 'denied' ? 'failed' : scenario === 'not-found' ? 'business_outcome' : 'success';
    if (result.status !== expected) throw new Error(`unexpected_${scenario}_result`);
    if (result.status === 'success' && !Object.values(result.outputs).includes('$8,420.50')) throw new Error('wrong_balance');
    await writeFile(`${directory}/verification.json`, JSON.stringify({ artifactSha256: sha256, scenario, status: result.status, code: result.code, outputsVerified: result.status === 'success', modelCallsDuringReplay: 0, operator: scenario === 'handoff' ? 'simulated' : 'none' }, null, 2) + '\n');
  } finally { await surface.close(); }
}
