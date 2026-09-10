import { chromium, type Browser, type BrowserContext, type Page, type Locator as PWLocator } from 'playwright';
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertAllowedAction, assertAllowedUrl, defaultPolicy, redact, type Policy } from './policy.js';
import type { Locator, Step } from './schema.js';

export type SurfaceOptions = {
  url: string; directory: string; headless?: boolean; secrets?: string[]; policy?: Policy;
  timeoutMs?: number; handoffTimeoutMs?: number;
  // Test-only operator: exercises the actual control transfer, clearly labelled in evidence.
  operator?: (surface: BrowserSurface) => Promise<void>;
};
/** Flow engines depend on this seam; a desktop adapter can implement the same operations. */
export interface Surface {
  observe(): Promise<string>;
  act(step: Step, inputs: Record<string, string>): Promise<string | undefined>;
  matches(target: Locator, text: string): Promise<boolean>;
  log(event: Record<string, unknown>): Promise<void>;
  failure(code: string, stepId: string, expected: string): Promise<void>;
  handoff(reason: string, stepId: string): Promise<boolean>;
}
export class BrowserSurface implements Surface {
  readonly sessionId = randomUUID();
  owner: 'automation' | 'human' | 'closed' = 'automation';
  readonly policy: Policy;
  browser!: Browser; context!: BrowserContext; page!: Page;
  private resolveHandoff?: (resume: boolean) => void;
  private violation?: string;
  private logQueue: Promise<void> = Promise.resolve();
  constructor(readonly options: SurfaceOptions) { this.policy = options.policy ?? defaultPolicy(options.url); }
  async open() {
    assertAllowedUrl(this.options.url, this.policy);
    await mkdir(this.options.directory, { recursive: true });
    this.browser = await chromium.launch({ headless: this.options.headless ?? true });
    this.context = await this.browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await this.context.route('**/*', async route => {
      try {
        assertAllowedUrl(route.request().url(), this.policy);
        if (new URL(route.request().url()).pathname === '/verify' && this.owner !== 'human') throw new Error('operator_only_route');
        await route.continue();
      } catch { this.violation = 'policy_denied_destination'; await route.abort(); }
    });
    await this.context.exposeBinding('lorHumanEvent', async (_source, event: unknown) => {
      if (this.owner === 'human') await this.log({ type: 'human_action', actor: this.options.operator ? 'simulated_operator' : 'human', event });
    });
    await this.context.exposeBinding('lorResume', async (_source, resume: boolean) => { this.resume(resume); });
    await this.context.addInitScript(() => {
      const win = window as unknown as { lorHumanEvent: (event: unknown) => Promise<void> };
      for (const kind of ['click', 'change']) document.addEventListener(kind, event => {
        const target = event.target as HTMLElement;
        void win.lorHumanEvent({ kind, tag: target.tagName, control: target.getAttribute('aria-label') ?? (target.tagName === 'BUTTON' ? target.textContent : target.id), value: '[OMITTED]' });
      }, true);
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.options.timeoutMs ?? 2500);
    this.context.on('page', page => { if (page !== this.page) { this.violation = 'unexpected_popup'; void page.close(); } });
    this.page.on('dialog', dialog => { this.violation = 'unexpected_dialog'; void dialog.dismiss(); });
    await this.page.goto(this.options.url, { waitUntil: 'load' });
    await this.log({ type: 'session_opened', mode: 'browser', route: new URL(this.options.url).pathname });
    return this;
  }
  private clean(value: unknown) {
    return redact(value, [...(this.options.secrets ?? []), process.env.OPENAI_API_KEY ?? '', 'Alex Morgan', 'Sam Rivera']);
  }
  async log(event: Record<string, unknown>) {
    const line = JSON.stringify(this.clean({ timestamp: new Date().toISOString(), sessionId: this.sessionId, owner: this.owner, ...event })) + '\n';
    this.logQueue = this.logQueue.then(() => appendFile(join(this.options.directory, 'events.jsonl'), line));
    await this.logQueue;
  }
  locate(target: Locator): PWLocator {
    // /workspace is a logical frame identity, not its current navigation URL.
    const root = target.frame ? this.page.frameLocator('iframe[title="Banking workspace"]') : this.page;
    if (target.kind === 'label') return root.getByLabel(target.value, { exact: true });
    if (target.kind === 'text') return root.getByText(target.value, { exact: true });
    return root.getByRole(target.value as Parameters<Page['getByRole']>[0], { ...(target.name ? { name: target.name, exact: true } : {}) });
  }
  async observe(): Promise<string> {
    const observations: string[] = [];
    for (const frame of this.page.frames()) {
      if (frame.url() === 'about:blank') continue;
      assertAllowedUrl(frame.url(), this.policy);
      const snapshot = await frame.locator('body').ariaSnapshot({ timeout: 1500 });
      observations.push(`${frame === this.page.mainFrame() ? 'main' : '/workspace'}:\n${snapshot}`);
    }
    // Values needed by the caller are read directly, never included in model observations/logs.
    return String(this.clean(observations.join('\n'))).replace(/\$[\d,.]+/g, '[AMOUNT]').slice(0, 9000);
  }
  async matches(target: Locator, text: string) {
    const loc = this.locate(target);
    return await loc.count() === 1 && await loc.isVisible() && (await loc.innerText()).trim() === text;
  }
  async act(step: Step, inputs: Record<string, string>): Promise<string | undefined> {
    if (this.owner !== 'automation') throw new Error('automation_does_not_own_session');
    if (this.violation) throw new Error(this.violation);
    assertAllowedAction(step, this.policy);
    for (const frame of this.page.frames()) if (frame.url() !== 'about:blank') assertAllowedUrl(frame.url(), this.policy);
    const loc = this.locate(step.target);
    await loc.waitFor({ state: 'visible' });
    if (await loc.count() !== 1) throw new Error('ambiguous_target');
    await this.log({ type: 'action_started', stepId: step.id, action: step.action, target: step.target });
    let output: string | undefined;
    if (step.action === 'fill') {
      const value = step.value!.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, key: string) => {
        if (!Object.hasOwn(inputs, key)) throw new Error('missing_input');
        return inputs[key]!;
      });
      await loc.fill(value);
    } else if (step.action === 'click') {
      // Verify actual control identity as well as model-provided locator.
      const label = await loc.evaluate(el => el.getAttribute('aria-label') || el.textContent || '');
      assertAllowedAction({ ...step, target: { kind: 'text', value: label } }, this.policy);
      const navigation = await loc.evaluate(el => {
        const a = el.closest('a');
        const form = el.closest('form');
        return a?.getAttribute('href') ?? (el.tagName === 'BUTTON' && form ? form.getAttribute('action') : null);
      });
      if (navigation !== null) {
        const frame = await (await loc.elementHandle())!.ownerFrame();
        if (!frame) throw new Error('missing_frame');
        assertAllowedUrl(new URL(navigation, frame.url()).href, this.policy);
        await Promise.all([frame.waitForNavigation({ waitUntil: 'load', timeout: this.options.timeoutMs ?? 2500 }), loc.click()]);
      } else await loc.click();
    } else if (step.action === 'read') output = (await loc.innerText()).trim();
    if (this.violation) throw new Error(this.violation);
    await this.log({ type: 'action_completed', stepId: step.id, action: step.action, outputPresent: output !== undefined });
    return output;
  }
  async failure(code: string, stepId: string, expected: string) {
    const observed = await this.observe().catch(() => '[observation unavailable]');
    await this.log({ type: 'failure', code, stepId, expected, observed });
    await writeFile(join(this.options.directory, 'failure-state.json'), JSON.stringify(this.clean({ code, stepId, expected, accessibilitySnapshot: observed }), null, 2));
  }
  resume(proceed = true) { if (this.owner === 'human') this.resolveHandoff?.(proceed); }
  async handoff(reason: string, stepId: string): Promise<boolean> {
    if (this.owner !== 'automation') throw new Error('invalid_control_transfer');
    await this.failure(reason, stepId, 'operator intervention');
    this.owner = 'human';
    await this.log({ type: 'intervention_requested', reason, stepId });
    let timer: ReturnType<typeof setTimeout>;
    const waiting = new Promise<boolean>(resolve => {
      this.resolveHandoff = resolve;
      timer = setTimeout(() => resolve(false), this.options.handoffTimeoutMs ?? 120000);
    });
    await this.page.evaluate(() => {
      document.querySelector('#lor-handoff')?.remove();
      const box = document.createElement('aside'); box.id = 'lor-handoff';
      box.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;padding:14px;background:#fff3cc;border:2px solid #725600;font:16px sans-serif';
      box.textContent = 'Human control — complete the manual step in this browser. ';
      for (const [label, proceed] of [['Resume automation', true], ['Abort run', false]] as const) {
        const button = document.createElement('button'); button.textContent = label;
        button.onclick = () => void (window as unknown as { lorResume: (value: boolean) => Promise<void> }).lorResume(proceed);
        box.appendChild(button);
      }
      document.body.appendChild(box);
    });
    await this.log({ type: 'control_transferred', from: 'automation', to: 'human', simulated: Boolean(this.options.operator) });
    if (this.options.operator) void this.options.operator(this).catch(async () => { await this.log({ type: 'operator_error' }); this.resume(false); });
    const accepted = await waiting;
    clearTimeout(timer!); this.resolveHandoff = undefined;
    await this.page.evaluate(() => document.querySelector('#lor-handoff')?.remove()).catch(() => {});
    this.owner = 'automation';
    await this.log({ type: 'control_transferred', from: 'human', to: 'automation', resumed: accepted });
    return accepted;
  }
  async close() { this.owner = 'closed'; await this.browser?.close(); await this.logQueue; }
}
