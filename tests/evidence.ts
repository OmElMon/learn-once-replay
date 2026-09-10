import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { startDemo } from '../src/demo.js';
import { BrowserSurface } from '../src/surface.js';
import { replay } from '../src/replay.js';
import { fixture } from './fixture.js';
const server = startDemo(0); await once(server, 'listening');
const address = server.address(); if (!address || typeof address === 'string') throw new Error('no_port');
await mkdir('evidence/offline', { recursive: true });
await writeFile('tests/example-capability.json', JSON.stringify(fixture, null, 2) + '\n');
await writeFile('evidence/offline/capability.json', JSON.stringify(fixture, null, 2) + '\n');
try {
  for (const scenario of ['normal', 'not-found', 'transient', 'handoff', 'denied']) {
    const member_id = scenario === 'not-found' ? '99999' : '67890';
    const surface = new BrowserSurface({ url: `http://127.0.0.1:${address.port}/?scenario=${scenario}`, directory: `evidence/offline/${scenario}`, secrets: [member_id],
      operator: scenario === 'handoff' ? async s => {
        await s.page.frameLocator('iframe').getByRole('button', { name: 'Verify session', exact: true }).click();
        await s.page.frameLocator('iframe').getByRole('link', { name: 'Savings account', exact: true }).waitFor(); s.resume();
      } : undefined,
    });
    try {
      await surface.open();
      await surface.log({ type: 'provenance', artifact: 'hand-authored test fixture', discovery: false, operator: scenario === 'handoff' ? 'simulated' : 'none' });
      const result = await replay(surface, fixture, { member_id });
      console.log(scenario, result.status, result.code ?? '');
      if (result.status === 'intervention_required' || (result.status === 'failed' && scenario !== 'denied')) throw new Error(`Unexpected evidence result: ${scenario}`);
    } finally { await surface.close(); }
  }
} finally { server.close(); }
