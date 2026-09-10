import type { Capability, Locator, Step } from '../src/schema.js';

const role = (value: string, name: string): Locator => ({ kind: 'role', value, name, frame: '/workspace' });
const recoveries: NonNullable<Step['recoveries']> = [
  { code: 'temporary_interruption', target: role('heading', 'Temporary service interruption'), text: 'Temporary service interruption', action: 'click', actionTarget: role('button', 'Retry'), maxAttempts: 2 },
  { code: 'operator_required', target: role('heading', 'Operator verification required'), text: 'Operator verification required', action: 'handoff', maxAttempts: 1 },
];

/** Hand-authored offline fixture, not evidence of LLM discovery. */
export const fixture: Capability = {
  schemaVersion: 1,
  name: 'get_savings_balance',
  description: 'Find a member and read the savings account balance.',
  inputs: { member_id: { type: 'string', description: 'Synthetic member identifier' } },
  outputs: { savings_balance: { type: 'string', description: 'Displayed savings balance' } },
  steps: [
    { id: 'enter_member', action: 'fill', target: { kind: 'label', value: 'Member ID', frame: '/workspace' }, value: '{{member_id}}', recoveries },
    { id: 'search_member', action: 'click', target: role('button', 'Search'), recoveries },
    { id: 'open_savings', action: 'click', target: role('link', 'Savings account'), recoveries },
    { id: 'read_balance', action: 'read', target: role('status', 'Account balance'), output: 'savings_balance', recoveries },
  ],
  checkpoint: { target: role('heading', 'Savings balance'), text: 'Savings balance' },
  outcomes: [{ code: 'member_not_found', target: role('heading', 'Member not found'), text: 'Member not found' }],
};
