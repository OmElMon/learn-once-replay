# learn-once-replay

This project lets an AI learn a task in a browser, save the steps, and run them again without calling the model.

I used a small banking demo: find a member, open their savings account, and return the balance. The demo has fake data, server-rendered forms, tables, and an iframe. It also has a few things that can go wrong, including a missing member, a temporary service error, and a session that needs an operator to step in.

Discovery runs locally with Ollama and Qwen2.5 3B. You do not need an API key or a paid service. The repository includes a real discovery run, the capability it generated, and replays of that same capability with different inputs.

## Start here

You need Node.js 22 or newer. Install the dependencies and browser:

```sh
npm ci
npx playwright install chromium
```

Start the demo and leave it running:

```sh
npm run demo
```

In another terminal, try the saved capability:

```sh
npm run replay -- \
  --artifact evidence/discovery/capability.json \
  --inputs '{"member_id":"67890"}' \
  --out runs/replay
```

The result should contain `savings_balance_amount: "$8,420.50"`. This uses the browser, but no model. You do not need Ollama for replay.

## Record a new capability

Install and start [Ollama](https://ollama.com), then download the model once. The download is about 1.9 GB.

```sh
ollama pull qwen2.5:3b
```

With the demo still running:

```sh
npm run discover -- \
  --goal 'Look up the supplied member and read their current savings balance.' \
  --inputs '{"member_id":"12345"}' \
  --out runs/discovery \
  --headed

npm run replay -- \
  --artifact runs/discovery/capability.json \
  --inputs '{"member_id":"67890"}' \
  --out runs/new-replay
```

The model sees a compact accessibility snapshot and chooses an action against a named control. The executor checks that action before running it. Once the requested output has been read, the model chooses a success checkpoint, which the executor verifies against the live page.

Only successful runs produce a capability. The saved JSON contains input placeholders, output names, locators, recovery rules, and the checkpoint. It does not contain the model conversation or the member's balance.

The local discovery path handles one output per run. It allows at most 10 model calls, with up to 1,000 output tokens and a 120-second timeout per call. `--max-steps` can lower the call limit. Set `OLLAMA_MODEL` to try another installed model. For this submission, the successful run took six calls and produced four steps.

## Try the failure cases

These commands use the saved model-generated capability:

```sh
# A missing member is a normal business outcome.
npm run replay -- --artifact evidence/discovery/capability.json \
  --inputs '{"member_id":"99999"}' --out runs/not-found

# A known service interruption gets a bounded retry.
npm run replay -- --artifact evidence/discovery/capability.json \
  --url 'http://127.0.0.1:3100/?scenario=transient' --out runs/transient

# Permission denial stops the run and records diagnostic state.
npm run replay -- --artifact evidence/discovery/capability.json \
  --url 'http://127.0.0.1:3100/?scenario=denied' --out runs/denied
```

Results distinguish `success`, `business_outcome`, `failed`, and `intervention_required`. Failures include the step and observed state. The CLI exits nonzero for failures and unresolved interventions.

## Take over a session

```sh
npm run replay -- --artifact evidence/discovery/capability.json \
  --url 'http://127.0.0.1:3100/?scenario=handoff' \
  --out runs/handoff --headed
```

Wait for the yellow banner. Click **Verify session** inside the banking page, then **Resume automation** in the banner. You have two minutes. You can also choose **Abort run**.

This is the same browser session the automation was using. Automation pauses while the operator owns it, and manual clicks and changes are recorded without field values. After resume, the executor continues from the pending step. A headless run cannot accept manual input and returns an unresolved intervention for this case.

## Tests and evidence

```sh
npm run check
npm test
```

Tests use local browsers and scripted model responses. They make no paid API calls. To check the genuinely discovered artifact across all five scenarios, leave the demo running and run:

```sh
node --import tsx tests/verify-generated.ts
```

`npm run evidence` is a separate offline demonstration. It starts its own server and uses a hand-authored fixture. Those files are clearly labelled and are not presented as AI discovery.

See [evidence/README.md](evidence/README.md) for the saved runs and their origins. Earlier failed discovery attempts are included too. Getting a small model to select the right controls and stop after reading the output took refinement. One successful discovery is not a claim that arbitrary workflows are reliable.

## Design and limitations

[REPORT.md](REPORT.md) explains the architecture and trade-offs. The main pieces are:

- `discovery.ts`: model decisions and capability recording.
- `schema.ts`: the typed capability contract.
- `replay.ts`: execution, outcomes, and recovery.
- `surface.ts`: browser interaction, evidence, and session handoff.
- `policy.ts`: permitted routes/actions and redaction.
- `demo.ts`: the synthetic banking application.

The policy checks destinations and actions. Logs redact supplied inputs, known synthetic names, secrets, and selected patterns. Failures include a redacted accessibility snapshot. These controls are enough to demonstrate the design on fake data; they are not a complete authorization or privacy system for real banking applications. Declared outputs are returned to the caller, so avoid redirecting sensitive output into logs.

Desktop support and reuse across institutions are design proposals in the report. They are not implemented features.

## Optional OpenAI adapter

The default path stays local. To use the optional hosted adapter, explicitly set `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL` in your shell. That path uses separately billed API access and a 45-second request timeout. The program does not load `.env` files. Never commit a key.
