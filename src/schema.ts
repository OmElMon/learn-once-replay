import { z } from 'zod';

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const locatorSchema = z.object({
  kind: z.enum(['role', 'label', 'text']),
  value: z.string().min(1).max(200),
  name: z.string().min(1).max(200).optional(),
  frame: z.literal('/workspace').optional(),
}).strict();
export type Locator = z.infer<typeof locatorSchema>;

const recoverySchema = z.object({
  code: identifier,
  target: locatorSchema,
  text: z.string().min(1).max(300),
  action: z.enum(['retry', 'click', 'handoff']),
  actionTarget: locatorSchema.optional(),
  maxAttempts: z.number().int().min(1).max(3),
}).strict().superRefine((recovery, ctx) => {
  if (recovery.action === 'click' && !recovery.actionTarget) {
    ctx.addIssue({ code: 'custom', path: ['actionTarget'], message: 'Click recovery requires an action target' });
  }
});

export const stepSchema = z.object({
  id: identifier,
  action: z.enum(['click', 'fill', 'read', 'wait']),
  target: locatorSchema,
  value: z.string().max(500).optional(),
  output: identifier.optional(),
  recoveries: z.array(recoverySchema).max(5).optional(),
}).strict().superRefine((step, ctx) => {
  if (step.action === 'fill' && step.value === undefined) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Fill requires a value' });
  }
  if (step.action !== 'fill' && step.value !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Only fill accepts a value' });
  }
  if (step.action === 'read' && !step.output) {
    ctx.addIssue({ code: 'custom', path: ['output'], message: 'Read requires an output name' });
  }
  if (step.action !== 'read' && step.output) {
    ctx.addIssue({ code: 'custom', path: ['output'], message: 'Only read declares an output' });
  }
});
export type Step = z.infer<typeof stepSchema>;

const parameter = z.object({ type: z.literal('string'), description: z.string().min(1).max(500) }).strict();
export const capabilitySchema = z.object({
  schemaVersion: z.literal(1),
  name: identifier,
  description: z.string().min(1).max(1000),
  inputs: z.record(identifier, parameter),
  outputs: z.record(identifier, parameter),
  steps: z.array(stepSchema).min(1).max(40),
  checkpoint: z.object({ target: locatorSchema, text: z.string().min(1).max(300) }).strict(),
  outcomes: z.array(z.object({ code: identifier, target: locatorSchema, text: z.string().min(1).max(300) }).strict()).max(10),
}).strict().superRefine((capability, ctx) => {
  const ids = new Set<string>();
  const written = new Set<string>();
  const used = new Set<string>();
  capability.steps.forEach((step, index) => {
    const issue = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: ['steps', index, field], message });
    if (ids.has(step.id)) issue('id', 'Step IDs must be unique');
    ids.add(step.id);
    if (step.output) {
      if (!Object.hasOwn(capability.outputs, step.output)) issue('output', 'Output is not declared');
      if (written.has(step.output)) issue('output', 'Output must have exactly one producer');
      written.add(step.output);
    }
    for (const match of (step.value ?? '').matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)) {
      if (!Object.hasOwn(capability.inputs, match[1]!)) issue('value', `Undeclared input: ${match[1]}`);
      used.add(match[1]!);
    }
    if ((step.value ?? '').replace(/\{\{[a-z][a-z0-9_]*\}\}/g, '').match(/[{}]/)) issue('value', 'Invalid template syntax');
  });
  for (const name of Object.keys(capability.outputs)) {
    if (!written.has(name)) ctx.addIssue({ code: 'custom', path: ['outputs', name], message: 'Output has no read step' });
  }
  for (const name of Object.keys(capability.inputs)) {
    if (!used.has(name)) ctx.addIssue({ code: 'custom', path: ['inputs', name], message: 'Input is never used' });
  }
  const codes = capability.outcomes.map(outcome => outcome.code);
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', path: ['outcomes'], message: 'Outcome codes must be unique' });
});
export type Capability = z.infer<typeof capabilitySchema>;

export type RunResult = {
  status: 'success' | 'business_outcome' | 'failed' | 'intervention_required';
  outputs: Record<string, string>;
  code?: string;
  error?: { stepId: string; expected: string; observed: string };
  artifact?: string;
};
