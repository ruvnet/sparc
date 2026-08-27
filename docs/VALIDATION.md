# SPARC 1.0 validation

This document defines the release gate. A green result means the behavior was exercised; file existence alone is not acceptance evidence.

## One-command gate

From a clean checkout with Node.js 20 or newer:

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` must scan tracked content for secrets, validate plugin and skill structure, type-check, run the TypeScript tests, build the distributable package, and inspect the npm payload. No step may mask a failure.

Run the preserved Python suite in a clean Python 3.10 or newer environment:

```sh
python -m pytest
```

## Acceptance matrix

| Area | Required proof |
|---|---|
| Reproducible install | `npm ci --ignore-scripts` succeeds from the committed lockfile; the package defines no install lifecycle script |
| Type safety | `npm run typecheck` succeeds with strict TypeScript settings |
| Domain gates | Tests reject phase skipping, missing artifacts, missing completion evidence, unauthorized exceptions, and incomplete acceptance-test coverage |
| Concurrency | Tests reject a stale expected revision and preserve both state and receipts |
| Idempotency | Exact replay returns the original result; changed replay fails |
| Run identity | `sparc_run_start` and `sparc_run_get` expose `genesisDigest` and `requirementsDigest`; identical recreation keeps the requirements digest but receives a new random-bound genesis |
| Evidence authenticity | `pass` and `exception` require Ed25519 public keys configured through `SPARC_EVIDENCE_VERIFIER_KEYS` for CLI and MCP; tests reject missing, forged, unknown-key, changed-field, changed-revision, changed-definition, and cross-recreation signatures |
| Evidence citations | Refinement and Completion accept only exact `{ evidenceId, version, digest }` references and reject a bare ID, changed digest, wrong version, or requirement/test rebinding |
| Immutability | Artifact and evidence versions remain addressable; corrections do not erase history |
| Isolation | A principal cannot enumerate or read another principal's run |
| Persistence | Tests cover private permissions, atomic writes, root containment, size limits, and symbolic-link rejection |
| Integrity | Receipt or state tampering is detected before a run is returned; prerelease pre-genesis state fails closed even when its legacy integrity hash is self-consistent |
| Read purity | Run, phase, gate, and trace reads leave the state digest unchanged |
| MCP stdio | An official MCP client initializes, lists tools, and completes a golden lifecycle |
| MCP HTTP | An official MCP client initializes over Streamable HTTP and enforces method, host, body, timeout, authentication, and scope rules |
| Bounded reads | MCP run reads and CLI status return summaries; CLI run lists are paginated; phase and trace pages enforce count and 512 KiB serialized-entry bounds, return opaque cursors, reject malformed or stale cursors, and make forward progress |
| OAuth discovery | The advertised RFC 9728 metadata URL preserves the complete protected-resource path and the root compatibility endpoint returns the same resource document |
| Closed capability set | Tool listing contains only the eight documented SPARC operations and no generic shell, file, Git, deployment, reset, or delete tool |
| Plugin structure | Claude and Codex manifests validate, both MCP files parse, skill mirrors are byte-identical, and all skill frontmatter validates |
| Skill installation | A dual-host install preflights and stages all copies, rejects target-path and destination symbolic links, rechecks directory identities, preserves existing skills without `--force`, leaves MCP configuration untouched, reports the exact pinned MCP prerequisite, and rolls back handled partial failures |
| Version pinning | Plugin MCP arguments contain exactly `@ruvnet/sparc@1.0.0`; no `@latest` appears |
| Package hygiene | `npm pack --dry-run` contains the documented runtime, plugins, and skills, but no state, credentials, fixtures, caches, or development database; secret scanning enforces one entry and expanded-byte budget across all nested archives in the scan |
| Legacy safety | Python tests cover argument-preserving subprocess execution and reject executable mathematical expressions |

## Golden lifecycle

The integration suite must prove this sequence through the public API and again through MCP:

1. Start a run with requirements and acceptance tests. Capture `value.genesisDigest` and `value.requirementsDigest` from `sparc_run_start`, then confirm the same values in `sparc_run_get.run`.
2. Submit a Specification artifact and validate its gate.
3. Advance through Pseudocode and Architecture with versioned artifacts, then enter Refinement.
4. From a separately controlled Ed25519 verifier, sign `evidenceAttestationBytes` for the exact `genesisDigest`, `requirementsDigest`, principal, run, expected revision, phase, evidence fields, and attestation metadata.
5. Record verifier-attested passing evidence for every in-scope requirement and registered acceptance test.
6. Copy each returned immutable `{ evidenceId, version, digest }` reference into the Refinement increments, pass its gate, and enter Completion.
7. Submit Completion with the same immutable references in its requirement trace, validate the gate, and finish the run.
8. Traverse every `sparc_phase_get` and `sparc_trace_get` page until `pagination.nextCursor` is absent.
9. Reload the run from a new store instance configured with the same verifier public keys, using `SPARC_EVIDENCE_VERIFIER_KEYS` for CLI or MCP, and verify the final revision, state digest, `genesisDigest`, `requirementsDigest`, status, phase history, artifacts, stored attestation metadata, evidence signatures, and receipt chain.

Negative variants must attempt a phase skip, stale write, changed idempotency replay, cross-principal lookup, unsigned pass, forged signature, evidence-reference substitution, stale page cursor, missing evidence completion, and receipt tampering. They must also delete and recreate a run twice: once with identical definitions and once with changed definitions. The original signature must fail in both recreations, with no evidence appended. A separately constructed prerelease state that omits the genesis nonce and digest must fail closed on load. Each rejection must have a stable error classification and no partial state change.

Use the exact helper and input contract in [EVIDENCE_ATTESTATION.md](./EVIDENCE_ATTESTATION.md). Tests that generate a key pair in-process prove cryptographic binding and rejection semantics; they do not prove production separation of the verifier private key.

## Plugin-specific validation

Run the repository validator first:

```sh
npm run validate:plugins
```

When the Codex skill development utilities are available, also run their reference validators:

```sh
python3 /root/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/sparc
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/sparc
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/sparc-review
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/sparc-resume
```

Those absolute utility paths are development-environment examples, not package runtime dependencies.

## Remote ChatGPT verification

Local stdio validation does not prove ChatGPT compatibility. Before claiming a hosted integration is ready:

1. Serve the Streamable HTTP MCP endpoint behind HTTPS.
2. Configure a real OAuth issuer, audience, JWKS URL, resource URL, and `sparc.read` and `sparc.write` scopes.
3. If the resource is `https://sparc.example.com/mcp`, verify that `WWW-Authenticate` advertises `https://sparc.example.com/.well-known/oauth-protected-resource/mcp`, that an unauthenticated `GET` there returns matching RFC 9728 metadata, and that the root compatibility endpoint returns the same `resource` value.
4. Register the endpoint in ChatGPT developer mode; keep the generated application identifier outside source control unless the registration workflow explicitly exports a safe manifest.
5. Exercise initialization, confirm both run digests in the bounded summary, complete multipage trace traversal, one authorized mutation, stale-revision and stale-cursor rejection, and cross-principal denial from ChatGPT.
6. Record a pass whose signature binds both digests with an independent verifier, then prove that unsigned, forged, and wrong-genesis passes are rejected.
7. Retain only redacted protocol and receipt evidence.

## Release evidence

Record the commit SHA, Node and Python versions, exact commands, exit codes, test counts, package filename and digest, run `genesisDigest`, `requirementsDigest`, and any approved exception. An exception must identify its authorizer, reason, scope, and expiry, and its evidence still requires verifier attestation. A skipped test is not a pass.

## External acceptance limits

A green repository gate proves only the checked source and test environments. It does not migrate prerelease pre-genesis state, prove that `@ruvnet/sparc@1.0.0` has been published, that `npx` can retrieve it, that Claude or Codex has reloaded the plugin, or that a ChatGPT application has been registered. It also does not prove a production OAuth issuer, JWKS rotation, HTTPS proxy routing, distributed quotas, independent verifier custody, credential revocation, or Git-history cleanup.

Before announcing a public release, separately verify the registry tarball and provenance after publication, run one clean `npx --yes @ruvnet/sparc@1.0.0 doctor`, install both host skills into a disposable project, and complete the live remote ChatGPT checks above. Do not convert any missing external check into an implicit pass.
