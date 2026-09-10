# Architecture

The implementation is a single TypeScript process with a local synthetic banking target. Discovery observes the live browser accessibility tree, asks a local Ollama model for one structured action (or optionally the OpenAI Responses API), validates that action, and executes it through `BrowserSurface`. Successful actions become a capability only after the model proposes a static checkpoint that matches the live UI and at least one output has been captured. The goal, declared input names, observation, prior successful steps, and failure feedback inform each decision. Model requests are bounded; there is no provider call in replay. The local provider chooses exact named controls from the current accessibility snapshot and, after capturing one output, enters a separate model-driven completion/checkpoint phase. This deliberate single-output scope makes a small local model viable without a prewritten action sequence.

The target deliberately includes a nested frame, server-rendered forms, and tables without test IDs. Accessible roles and labels keep the exercise focused on the recording contract, errors, and handoff. This is a modest legacy-web proxy, not evidence that the implementation already handles arbitrary inaccessible applications. A local app also makes exceptional states repeatable without real financial data or third-party side effects.

`BrowserSurface` owns observation, targeting, actions, policy checks, diagnostic capture, and live-session ownership. Replay owns ordered execution, input validation, outcomes, recoveries, and checkpoint verification. The flow engines depend on a small Surface interface; BrowserSurface implements it.

# Artifact schema

A strict, serializable Zod schema defines `schemaVersion: 1`, a capability name and description, named string inputs and outputs, ordered steps, business outcomes, and a success checkpoint. Version 1 supports string values only; the example balance remains formatted UI text rather than a calculated monetary amount. The version denotes the serialization contract, not capability release history.

Each step contains a stable ID, action, and locator; fill steps reference declared inputs using `{{member_id}}`, while read steps bind text to a declared output name. Locators contain role, label, or exact text, plus an optional logical frame identity. They contain no executable code or generated CSS. Schema checks reject invalid action fields, unresolved templates, and inconsistent output declarations. Discovery also rejects input-dependent locators and checkpoints so a member ID does not accidentally become a permanent target.

The logical `/workspace` frame maps to the named banking iframe even as its document navigates between routes. Exact accessible names and unique-target checks favor understandable targeting over silent fallback. Recovery rules declare the recognized state, allowed recovery action, and maximum attempts. Demo-specific outcomes and recoveries come from explicit policy rather than pretending that one successful discovery run learned unseen errors.

# Determinism & error handling

Replay parses the artifact, validates inputs, executes its declared steps, extracts outputs, and checks the final checkpoint. It never invokes a model. Determinism means fixed actions and bounded policy branches; it does not guarantee identical runtime timing or data. Playwright waits for visible targets and refuses ambiguous matches. Unexpected state does not trigger speculative alternative clicks.

Errors separate into three classes. Invalid input and a missing member are business outcomes returned to the caller. A known temporary interruption permits one Retry action before retrying the pending step. Operator verification initiates handoff. Permission denial, exhausted recovery, missing outputs, or a failed final checkpoint produce hard failures. An otherwise unrecognized step error offers one human restoration attempt before failing. Session ownership, action starts/completions, recovery attempts, and final results are recorded in JSONL. Failures include the pending step, expectation, and redacted observed accessibility state.

This makes unsupported UI changes visible rather than silently accepting a different result. Per-step expected values and richer vendor-specific transient classifications would strengthen the current visible-target checks. Test fixtures exercise the local scenarios independently of paid model calls. They cannot establish that discovery itself succeeded.

# Heterogeneity & multi-tenant

The Surface interface separates observation, action, state matching, evidence, and handoff from the recorded flow. Browser-specific locator resolution stays inside BrowserSurface. A future locator union could represent OS accessibility identifiers or screenshot anchors with bounded coordinate offsets. Desktop support would preserve the same workflow and outcome contract while implementing perception, control, and live-session exposure in a different adapter. Screenshot targeting needs explicit confidence thresholds and an operator path; the current role-based adapter does not solve that problem.

For tenant reuse, keep vendor capability releases immutable and maintain separate tenant bindings: permitted origins, credentials references, logical frames, and reviewed locator overrides. Bind releases to vendor product/version and record which tenant/version combinations have passed replay checks. A tenant cannot broaden safety policy through an artifact override. A failed preflight or checkpoint quarantines that binding for review instead of rewriting the shared artifact. These catalog, binding, migration, and drift mechanisms are design proposals, not implemented multi-tenancy.

# Escalation & handoff

A known blocked state or repeated inability to proceed creates an intervention event with diagnostic context. The process transfers ownership from automation to human, leaves the same browser/context/cookies open, and presents Resume automation and Abort run buttons. In the headed demo, a person performs Verify session and then resumes; automation is forbidden from taking that action. Click/change events during human ownership are logged without field values. The pending step is attempted only after control returns.

The local operator has 120 seconds. Abort or expiry prevents further progress. Discovery may offer one handoff after repeated invalid or failed decisions; it reobserves the browser afterward. A full operator console, authenticated operator identity, and distributed session leases are omitted. Automated evidence explicitly labels its operator as simulated: it validates the ownership mechanism, not an actual person's involvement.

# Safety

The browser context enforces configured allowed origins and routes at network interception, with service workers blocked. Action kinds and sensitive/risky labels are checked before execution; click checks also inspect the actual target's label. The verification route is human-only. Popups and unexpected dialogs mark a violation. The model receives instructions to treat UI content as untrusted data, while executable policy remains outside its control.

Inputs and the API key are redacted from logs; observations also mask amounts and known synthetic names. Human event values are omitted. Failure evidence uses redacted accessibility snapshots instead of broad screenshots. Declared outputs still reach the caller, so stdout must be handled appropriately. These controls are tailored to this synthetic demo: name lists and regular expressions are not comprehensive financial-data redaction, and label checks are not a production authorization system. Production use requires vendor-specific semantic action permissions, credential isolation, operator authentication, audited retention, and reviewed DLP before connecting real accounts.

# Cuts

The deliberately narrow scope is one read-only web workflow, a local provider with an optional hosted adapter, string contracts, a local operator UI, and a single process. Desktop execution, tenant catalogs, capability signing/approval, artifact release migrations, screenshot perception, distributed scheduling, production DLP, and authenticated co-browsing are not implemented. No stretch feature substitutes for the core flow.

The separately labelled offline capability remains hand-authored test data. Genuine local Qwen2.5 3B discovery evidence is now included: six model calls generated four steps, and that exact artifact passed all five replay scenarios. Nine earlier unsuccessful development runs are preserved transparently; this is not a claim of discovery stability. A real-person headed handoff also passed and is recorded separately. Broader model reliability checks remain future work. This repository is a demonstrable prototype, not a production banking integration.
