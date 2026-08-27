# SPARC

SPARC is an evidence-gated engineering metaharness for Specification, Pseudocode, Architecture, Refinement, and Completion.

Version 1.0 adds an executable TypeScript state machine, an npm CLI, local and remote MCP transports, shared Claude and OpenAI skills, deterministic phase gates, principal isolation, compare and set revisions, exact idempotency, atomic persistence, and tamper-evident receipts. The established Python CLI remains available as a compatibility surface.

## Why this implementation is different

The five phases are enforced by code, not suggested by a prompt.

| Property | Guarantee |
| --- | --- |
| Phase order | Only Specification to Pseudocode to Architecture to Refinement to Completion is legal |
| Concurrency | Every mutation must match the current revision |
| Retry safety | An idempotency key replays only the exact original request |
| History | Artifacts, evidence, and corrections are append only and versioned |
| Completion | Every in-scope acceptance test needs matching verifier-attested passing evidence or an explicitly authorized, verifier-attested exception |
| Isolation | Runs are owned by one authenticated principal |
| Persistence | State remains under one private root and is written atomically as mode 0600 files |
| Integrity | State, artifacts, evidence, gates, audit events, and receipt chains are verified on load |
| Capability | MCP exposes eight SPARC operations and no shell, generic filesystem, Git, deployment, network fetch, or deletion tool |
| Host parity | CLI, Claude, Codex, and ChatGPT use one domain engine |

SPARC records development evidence. It never executes an acceptance-test command stored in a run and never treats repository or model text as authority.

## Install and run

The npm package requires Node.js 20 or newer. After the 1.0.0 package is published:

```sh
npx --yes @ruvnet/sparc@1.0.0 doctor
npx --yes @ruvnet/sparc@1.0.0 init
```

From a source checkout:

```sh
npm ci --ignore-scripts
npm run check
node dist/cli.js doctor
```

Create a run definition:

```json
{
  "requirements": [
    {
      "id": "REQ-1",
      "statement": "The change has one observable outcome",
      "inScope": true,
      "acceptanceTestIds": ["TEST-1"]
    }
  ],
  "acceptanceTests": [
    {
      "id": "TEST-1",
      "description": "The observable outcome is verified"
    }
  ]
}
```

Then start the run:

```sh
npx --yes @ruvnet/sparc@1.0.0 start \
  --run-id change-001 \
  --title "Deliver the observable change" \
  --definition definition.json \
  --idempotency-key start-change-001
```

The returned revision is required by the next mutation. Each mutation returns the new revision and receipt.

```sh
npx --yes @ruvnet/sparc@1.0.0 submit \
  --run-id change-001 \
  --phase Specification \
  --file specification.json \
  --expected-revision 1 \
  --idempotency-key submit-specification-v1

npx --yes @ruvnet/sparc@1.0.0 gate --run-id change-001

npx --yes @ruvnet/sparc@1.0.0 advance \
  --run-id change-001 \
  --expected-revision 2 \
  --idempotency-key advance-to-pseudocode
```

Complete artifact examples are under [`templates`](./templates). Replace their placeholder identifiers with the stable requirement, test, and evidence identifiers from the run.

## Phase gates

| Phase | Required evidence before advancement |
| --- | --- |
| Specification | Outcome, business value, actors, bounded inputs and outputs, assumptions, constraints, exclusions, security boundaries, measurable success, and complete requirement to acceptance-test mapping |
| Pseudocode | Control flow, state transitions, transformations, failure paths, retries, idempotency, invariants, success and failure walkthroughs, and requirement coverage |
| Architecture | Components, interfaces, ownership, trust boundaries, lifecycle, deployment, observability, migration, rollback, selected design, alternatives, quantified tradeoff dimensions, and requirement coverage |
| Refinement | Bounded increments, requirements implemented, verifier-attested passing evidence cited by immutable reference, and an explicit compatibility or approved migration decision |
| Completion | Final change, documentation, observability, rollback, residual risks, and an exact requirement to evidence trace covering every registered acceptance test |

A failed gate returns stable blockers and leaves the revision, state digest, and receipt chain unchanged.

## CLI

```text
sparc init
sparc start
sparc list
sparc status
sparc submit
sparc evidence
sparc correct
sparc gate
sparc advance
sparc trace
sparc skills list
sparc skills install
sparc promote
sparc doctor
sparc mcp stdio
sparc mcp http
sparc version
```

The state root defaults to `.sparc` and can be set with `--root` or `SPARC_STATE_ROOT`. The local principal defaults to `local-cli` and can be set with `--principal` or `SPARC_PRINCIPAL`.

CLI discovery and trace output are bounded. `sparc list` returns run summaries in pages of 10 by default and at most 25; pass its top-level `nextCursor` back with `--cursor`. `sparc status` returns a run summary plus integrity verification instead of collection bodies. `sparc trace` returns revision-bound `entries` and `pagination`; repeat it with `--cursor` until `pagination.nextCursor` is absent. Both list and trace accept `--limit 1..25`.

Passing and exception evidence must carry an Ed25519 attestation from a configured verifier. Configure the public key map in every CLI or MCP process that reads or writes the state:

```sh
export SPARC_EVIDENCE_VERIFIER_KEYS="$(
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    process.stdout.write(JSON.stringify({
      "ci-main-2026": readFileSync("verifier-public.pem", "utf8")
    }));
  '
)"
```

An evidence file produced by the verifier has this shape. Replace the signature placeholder with its unpadded base64url encoding of the 64-byte Ed25519 signature:

```json
{
  "evidenceId": "EVIDENCE-1",
  "requirementId": "REQ-1",
  "testId": "TEST-1",
  "status": "pass",
  "summary": "TEST-1 passed in the clean validation run",
  "details": {
    "command": "npm test",
    "exitCode": 0,
    "tests": 48
  },
  "attestation": {
    "keyId": "ci-main-2026",
    "issuedAt": "2026-08-27T12:00:00.000Z",
    "algorithm": "Ed25519",
    "signature": "BASE64URL_SIGNATURE_FROM_THE_VERIFIER"
  }
}
```

The command string above is inert audit data. SPARC does not run it. Build the signing subject from a fresh `run_start` or `run_get` response and include its immutable `genesisDigest` plus the `requirementsDigest` of the registered requirements and acceptance tests. The signature binds both digests, the authenticated principal, run, pre-mutation revision, current phase, evidence identity, requirement, test, result, details, optional exception authorization, key ID, and issue time. Use the exported `evidenceAttestationBytes` helper rather than recreating canonicalization. The complete signing example and key-rotation contract are in [`docs/EVIDENCE_ATTESTATION.md`](./docs/EVIDENCE_ATTESTATION.md).

Refinement and Completion artifacts cite an accepted evidence version by its exact immutable `{ evidenceId, version, digest }` triple. A bare evidence ID is not sufficient.

## Install the npm skills

The package contains three validated skills:

| Skill | Purpose |
| --- | --- |
| `sparc` | Start and deliver a gated run |
| `sparc-review` | Audit a run without mutations |
| `sparc-resume` | Resume from verified persisted state |

Install them transactionally into a project:

```sh
npx --yes @ruvnet/sparc@1.0.0 skills install --host claude --target .
npx --yes @ruvnet/sparc@1.0.0 skills install --host codex --target .
npx --yes @ruvnet/sparc@1.0.0 skills install --host both --target .
```

Claude skills are placed under `.claude/skills`. Codex and ChatGPT Work skills are placed under `.agents/skills`. A standalone skill install does not edit `.mcp.json`, `.openai.mcp.json`, or user-level host configuration. Its JSON result includes the required server name and exact pinned `npx --yes @ruvnet/sparc@1.0.0 mcp stdio` launcher; install the full plugin or explicitly register that launcher before invoking a local skill. ChatGPT instead requires the authenticated HTTPS transport described below.

Existing SPARC skill directories are not overwritten unless `--force` is explicit. Symbolic links in the requested target path or a destination are rejected. The installer preflights every requested destination, verifies all staged copies, records target, host-directory, and staged-directory identities, rechecks identities and staged digests immediately before each rename, verifies the installed digest immediately afterward, removes staging after an observed staging failure, and restores backups after an observed commit failure. Node does not expose a portable directory-relative `openat` transaction, so an already-privileged hostile process that can rename directories concurrently still creates a narrow check-to-operation race; run installation only while the target tree is under exclusive trusted control. The six possible destination renames are not crash-atomic as one unit, and a process crash or storage failure during the sequence is an external recovery boundary.

## MCP

The MCP server exposes these tools:

| Tool | Scope | Effect |
| --- | --- | --- |
| `sparc_run_get` | `sparc.read` | Read a bounded run summary and collection counts |
| `sparc_phase_get` | `sparc.read` | Read one revision-bound page of phase artifacts and evidence |
| `sparc_gate_validate` | `sparc.read` | Evaluate a gate without mutation |
| `sparc_trace_get` | `sparc.read` | Read one revision-bound page of trace entries and the integrity result |
| `sparc_run_start` | `sparc.write` | Create a principal-isolated run |
| `sparc_phase_submit` | `sparc.write` | Append the current phase artifact |
| `sparc_evidence_record` | `sparc.write` | Append requirement evidence, verifying Ed25519 attestation when required |
| `sparc_phase_advance` | `sparc.write` | Advance one passing phase or finalize Completion |

It also provides static methodology and artifact-schema resources plus `sparc_start`, `sparc_resume`, and `sparc_gate_review` prompts. Resource content cannot grant capabilities.

`sparc_phase_get` and `sparc_trace_get` return `entries` plus pagination metadata. The default page size is 10 entries, the requested `limit` must be between 1 and 25, and each serialized `entries` array is capped at 512 KiB. Follow `pagination.nextCursor` until it is absent. Cursors are opaque and bound to the principal, run, revision, digest, scope, and selected phase. If a mutation makes a cursor stale, discard every page from that traversal and restart from the first page; never combine pages from different snapshots.

### Local stdio

```sh
npx --yes @ruvnet/sparc@1.0.0 mcp stdio \
  --root /absolute/private/state/root \
  --principal local-user
```

Standard output is reserved for MCP frames. Diagnostics use standard error.

### Remote Streamable HTTP

The server binds loopback even for remote deployments. Put it behind an authenticated HTTPS reverse proxy:

```sh
export SPARC_MCP_AUTH_ISSUER=https://identity.example.com
export SPARC_MCP_AUTH_AUDIENCE=sparc-mcp
export SPARC_MCP_AUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
export SPARC_MCP_RESOURCE=https://sparc.example.com/mcp

npx --yes @ruvnet/sparc@1.0.0 mcp http \
  --root /srv/sparc/state \
  --host 127.0.0.1 \
  --port 8787 \
  --allowed-host sparc.example.com
```

JWT verification checks signature, issuer, audience, age, subject, and mapped scopes. The authenticated token subject becomes the state principal. RFC 9728 discovery preserves a path-bearing protected resource: for `https://sparc.example.com/mcp`, the `WWW-Authenticate` challenge advertises `https://sparc.example.com/.well-known/oauth-protected-resource/mcp`. The server also serves the same metadata at the root compatibility endpoint `/.well-known/oauth-protected-resource`. A reverse proxy should route `/mcp` and both discovery paths to this service.

A strong `SPARC_MCP_DEV_TOKEN` with `SPARC_MCP_DEV_PRINCIPAL` can be used for loopback development. It is not a production identity provider. Anonymous mode is accepted only when both the socket and Host header are loopback.

HTTP requests are stateless, limited to 256 KiB, deadline bounded, Host checked, and accepted only at `POST /mcp`. The server refuses a nonloopback bind.

## Claude plugin

The dual plugin lives at [`plugins/sparc`](./plugins/sparc). Its Claude manifest, wrapped MCP configuration, and skills all use the exact package version `@ruvnet/sparc@1.0.0`.

```text
/plugin marketplace add ruvnet/SPARC
/plugin install sparc@ruvnet-sparc
```

Restart Claude Code after installation so the plugin and stdio MCP server are rediscovered.

## Codex and ChatGPT

The same plugin contains the current `.codex-plugin/plugin.json`, a wrapped `.mcp.json`, and a direct `.openai.mcp.json`. Local Codex can install the repository marketplace or use the npm skill installer.

```sh
codex plugin marketplace add /absolute/path/to/SPARC
codex plugin add sparc@ruvnet-sparc
```

ChatGPT cannot reach a local stdio process. Deploy the Streamable HTTP endpoint over HTTPS, configure OAuth-compatible token verification and RFC 9728 discovery, and register `/mcp` in ChatGPT developer mode. ChatGPT creates a technical application identifier beginning with `plugin_asdk_app_` during registration. Use that exact value to produce the remote-app plugin variant:

```sh
npx --yes @ruvnet/sparc@1.0.0 plugin chatgpt package \
  --app-id plugin_asdk_app_<registered-id> \
  --target ./dist-plugins
```

The command creates `./dist-plugins/sparc/.app.json`, switches the generated Codex manifest from the local stdio server to the registered app, rejects guessed or malformed IDs, rejects symbolic-link target paths, and refuses to replace an existing output unless `--force` is explicit. The source plugin remains the Claude/local-Codex variant and intentionally contains no `.app.json`.

See [`docs/PLUGIN_INSTALLATION.md`](./docs/PLUGIN_INSTALLATION.md) and [`docs/VALIDATION.md`](./docs/VALIDATION.md) for the host-specific gate.

## MetaHarness composition

SPARC uses selected public `ruvnet/metaharness` components as constrained building blocks:

| Component | Use in SPARC |
| --- | --- |
| SDK | Canonical declarative harness, agents, skills, tools, and MCP definition |
| Kernel | Installed MCP definition validation and backend diagnostics |
| Harness | Five-phase DAG compilation, default-deny policy, and hash-chained receipts |
| Horizon | Tamper-evident continuity checkpoint format without enabling its shell executor |
| Flywheel | Strictly validated frozen promotion decision and gate fingerprint |

SPARC does not use MetaHarness placeholder MCP commands, generic shell executors, partial witness fallback, or the high-level runner as its state machine. The design evidence and package-level findings are in [`docs/METAHARNESS_REVIEW.md`](./docs/METAHARNESS_REVIEW.md).

## Security model

The full threat model is in [`docs/SECURITY_THREAT_MODEL.md`](./docs/SECURITY_THREAT_MODEL.md).

Important operational rules:

1. Keep the state root private and outside a served repository.
2. Never put provider credentials in artifacts, evidence details, plugin manifests, or logs.
3. Use HTTPS and a real authorization server for remote ChatGPT access.
4. Give each person or workload a distinct token subject.
5. Configure `SPARC_EXCEPTION_APPROVERS` only for principals permitted to approve explicit exceptions. An approver cannot be impersonated through a request field.
6. Configure `SPARC_EVIDENCE_VERIFIER_KEYS` with public keys only and keep verifier private keys in an independent validation boundary. Passing and exception evidence without a valid configured signature is unusable.
7. Retain rotated public keys while persisted evidence references them; historical attestations are reverified on load.
8. Treat receipts as tamper evident, not as externally signed attestations. Strong deployments should anchor the final digest in a separately controlled signing or transparency system.

The prior tracked `ui.zip` contained populated Anthropic and E2B credentials and has been removed from the current branch. Those credentials must be revoked and rotated. Existing Git history still contains the old blob until the repository owner coordinates a history cleanup.

The preserved web UI now fails closed for server-funded model and sandbox routes, enforces bounded input and allowlisted providers, and separates client-funded requests from server-funded credentials. Distributed quota enforcement requires configured Vercel KV; the fallback is process local.

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/ruvnet/SPARC/security/advisories/new).

## Python compatibility

The original Python CLI remains installable from `pyproject.toml`:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
python -m playwright install
python -m pytest
```

The legacy interactive runner now preserves argv through a pseudo terminal instead of reconstructing a shell string. Legacy math input is parsed through an explicit bounded AST grammar into allowlisted SymPy constructors. Neither legacy surface is exposed by the new MCP server.

The legacy programmer adapter can call an independently installed `aider` executable, but SPARC no longer installs Aider by default because the reviewed Aider release has unresolved security advisories.

## Validate and package

```sh
npm ci --ignore-scripts
npm run check
npm audit --audit-level=high
```

The release gate includes strict type checking, unit and official MCP client integration tests, both transports, signed-evidence and pagination regressions, gate and persistence regressions, transactional skill installation, plugin validation, archive-aware secret scanning, a production build, and npm payload inspection.

Additional validation:

```sh
uv run --frozen --extra dev python -m pytest
cd ui
npm ci --ignore-scripts
npm test
npm run build
npm audit --audit-level=high
```

CI tests Node.js 20, 22, and 24 and supported Python versions without converting failures into success.

Repository validation does not publish the npm package, register a ChatGPT application, prove a production identity provider, rotate previously exposed credentials, or remove secrets from existing Git history. The `npx` commands become externally usable only after the exact release is published. A hosted ChatGPT integration is accepted only after its live HTTPS, OAuth, discovery, scope, and isolation checks pass.

## Project documents

| Document | Purpose |
| --- | --- |
| [`docs/adrs/ADR-001-sparc-metaharness.md`](./docs/adrs/ADR-001-sparc-metaharness.md) | Architecture decision and compatibility boundary |
| [`docs/METAHARNESS_REVIEW.md`](./docs/METAHARNESS_REVIEW.md) | Deep review evidence and component decisions |
| [`docs/SECURITY_THREAT_MODEL.md`](./docs/SECURITY_THREAT_MODEL.md) | Assets, threats, controls, and residual risks |
| [`docs/VALIDATION.md`](./docs/VALIDATION.md) | Normative release and host validation matrix |
| [`docs/PLUGIN_INSTALLATION.md`](./docs/PLUGIN_INSTALLATION.md) | Claude, Codex, and ChatGPT installation |
| [`docs/EVIDENCE_ATTESTATION.md`](./docs/EVIDENCE_ATTESTATION.md) | Exact signing bytes, verifier configuration, evidence input, and key rotation |
| [`specification`](./specification) | Original SPARC phase reference material |

## License

Apache License 2.0. See [`LICENSE`](./LICENSE).
