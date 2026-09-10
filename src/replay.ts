import { capabilitySchema, type Capability, type RunResult, type Step } from './schema.js';
import type { Surface } from './surface.js';

export function validateInputs(capability: Capability, inputs: Record<string, string>) {
  const expected = Object.keys(capability.inputs).sort();
  if (JSON.stringify(Object.keys(inputs).sort()) !== JSON.stringify(expected) || Object.values(inputs).some(v => typeof v !== 'string' || v.length > 500)) throw new Error('invalid_inputs');
  if ('member_id' in inputs && !/^\d{5}$/.test(inputs.member_id!)) throw new Error('invalid_member_id');
}
export async function replay(surface: Surface, raw: unknown, inputs: Record<string, string>): Promise<RunResult> {
  const capability = capabilitySchema.parse(raw);
  try { validateInputs(capability, inputs); } catch {
    const result: RunResult = { status: 'business_outcome', code: 'validation_error', outputs: {} };
    await surface.log({ type: 'result', ...result }); return result;
  }
  const outputs: Record<string, string> = {};
  const finish = async (result: RunResult) => { await surface.log({ type: 'result', ...result }); return result; };
  const outcome = async (): Promise<RunResult | undefined> => {
    for (const rule of capability.outcomes) if (await surface.matches(rule.target, rule.text)) return { status: 'business_outcome', code: rule.code, outputs: {} };
  };
  let current = 'start';
  try {
    for (const step of capability.steps) {
      current = step.id;
      let completed = false;
      const attempts = new Map<string, number>();
      let genericHandoffs = 0;
      while (!completed) {
        const known = await outcome(); if (known) return finish(known);
        if (await surface.matches({ kind: 'role', value: 'heading', name: 'Permission denied', frame: '/workspace' }, 'Permission denied')) throw new Error('permission_denied');
        const recovery = (await Promise.all((step.recoveries ?? []).map(async rule => ({ rule, active: await surface.matches(rule.target, rule.text) })))).find(r => r.active)?.rule;
        if (recovery) {
          const count = attempts.get(recovery.code) ?? 0;
          if (count >= recovery.maxAttempts) throw new Error('recovery_exhausted');
          attempts.set(recovery.code, count + 1);
          await surface.log({ type: 'recovery', stepId: step.id, code: recovery.code, attempt: count + 1 });
          if (recovery.action === 'handoff') {
            if (!await surface.handoff(recovery.code, step.id)) return finish({ status: 'intervention_required', code: 'handoff_aborted_or_expired', outputs: {} });
          } else if (recovery.action === 'click') await surface.act({ id: `${step.id}_recovery`, action: 'click', target: recovery.actionTarget! }, inputs);
          else await new Promise(resolve => setTimeout(resolve, 200 * (count + 1)));
          continue;
        }
        try {
          const value = await surface.act(step, inputs);
          if (step.output && value !== undefined) outputs[step.output] = value;
          completed = true;
        } catch (error) {
          // No blind re-click: an operator can restore the expected precondition once.
          if (genericHandoffs++ > 0 || !await surface.handoff('unrecoverable_step', step.id)) throw error;
        }
      }
    }
    const known = await outcome(); if (known) return finish(known);
    current = 'checkpoint';
    if (!await surface.matches(capability.checkpoint.target, capability.checkpoint.text)) throw new Error('checkpoint_mismatch');
    if (Object.keys(capability.outputs).some(name => !Object.hasOwn(outputs, name))) throw new Error('missing_outputs');
    return finish({ status: 'success', outputs });
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'execution_failed';
    await surface.failure(code, current, current === 'checkpoint' ? capability.checkpoint.text : 'declared step and preconditions');
    return finish({ status: 'failed', outputs: {}, code, error: { stepId: current, expected: 'declared step and checkpoint', observed: (await surface.observe().catch(() => 'unavailable')) } });
  }
}
