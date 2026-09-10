import type { Step } from './schema.js';

export type Policy = {
  allowedOrigins: string[];
  allowedRoutes: string[];
  allowedActions: Step['action'][];
  blockedLabels: RegExp[];
};

export function defaultPolicy(baseUrl: string): Policy {
  return {
    allowedOrigins: [new URL(baseUrl).origin],
    allowedRoutes: ['/', '/workspace', '/member', '/balance', '/retry', '/verify'],
    allowedActions: ['click', 'fill', 'read', 'wait'],
    blockedLabels: [/\bverify session\b/i, /\b(transfer|withdraw|delete|remove|send|pay|purchase|submit payment|close account)\b/i, /\b(password|secret|token|ssn|social security)\b/i],
  };
}

export function assertAllowedUrl(rawUrl: string, policy: Policy): void {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !policy.allowedOrigins.includes(url.origin) || !policy.allowedRoutes.includes(url.pathname)) {
    throw new Error('policy_denied_destination');
  }
}

export function assertAllowedAction(step: Step, policy: Policy): void {
  if (!policy.allowedActions.includes(step.action)) throw new Error('policy_denied_action');
  const targets = [step.target, ...(step.recoveries ?? []).flatMap(r => r.actionTarget ? [r.actionTarget] : [])];
  for (const target of targets) {
    if (target.frame && !policy.allowedRoutes.includes(target.frame)) throw new Error('policy_denied_frame');
    const label = `${target.value} ${target.name ?? ''}`;
    if (policy.blockedLabels.some(pattern => { pattern.lastIndex = 0; return pattern.test(label); })) {
      throw new Error('policy_denied_sensitive_or_risky_target');
    }
  }
}

/** Apply to structured logs before serialization; callers supply runtime secrets and member inputs. */
export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[REDACTED]');
    return result
      .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /password|secret|authorization|api[_-]?key|access[_-]?token|ssn|balance|member[_-]?id/i.test(key) ? '[REDACTED]' : redact(item, secrets),
    ]));
  }
  return value;
}
