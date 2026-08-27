# ADR 001: Deterministic SPARC metaharness

Status: Accepted
Date: 2026-08-27

## Context

SPARC names five useful engineering phases: Specification, Pseudocode, Architecture, Refinement, and Completion. Documentation alone cannot ensure that an agent follows those phases, that concurrent actors do not overwrite one another, or that a completion claim is backed by evidence.

The repository also has an established Python interface. The new harness must add an enforceable protocol without forcing existing Python users to migrate immediately. It must work from an npm executable, Claude Code, Codex, and a remotely hosted ChatGPT MCP integration. Host integrations must not become an indirect shell or deployment interface.

## Decision

SPARC 1.0 adds a TypeScript control plane beside the existing Python implementation. The control plane owns methodology state and evidence only. It exposes the same domain operations through an npm CLI and MCP, with thin host-specific plugin manifests around a single set of skills.

The design has five layers:

| Layer | Responsibility | Boundary |
|---|---|---|
| Domain | Phases, run-genesis identity, artifacts, signed evidence, immutable citations, corrections, revisions, and gate rules | Pure validation and deterministic values |
| Store | Principal and run isolation, bounded summary discovery, atomic persistence, idempotency, and receipt integrity | Confined state root; no general file API |
| MetaHarness | Receipt chain, bounded progress, policy evaluation, and declarative harness definitions | Augments the domain without controlling host tools |
| MCP and CLI | Typed commands, authentication, limits, and protocol transport | Fixed SPARC operations only |
| Plugins and skills | Claude and Codex discovery plus safe workflow guidance | No duplicated business logic |

`@metaharness/harness` supplies the receipt log used to make mutations tamper-evident. `@metaharness/horizon` supplies bounded progress and halt semantics. `@metaharness/flywheel` evaluates promotion policy. `@metaharness/sdk` describes the harness components, and `@metaharness/kernel` validates compatible MCP configuration. These are pinned dependencies, not optional claims in documentation.

## State and transition rules

Every run belongs to one authenticated principal and has a monotonically increasing revision. Mutation calls include the expected revision and an idempotency key.

1. A mutation succeeds only when its expected revision equals the stored revision.
2. Replaying the same idempotency key with the identical request returns the recorded result.
3. Reusing that key with changed input fails.
4. Artifacts and evidence are append-only versions. A correction refers to the original record rather than erasing it.
5. Creation computes a deterministic `requirementsDigest` over requirements and acceptance tests, generates a fresh random 32-byte nonce, and computes `genesisDigest` over the schema, principal, run ID, title, complete definitions, and nonce.
6. `sparc_run_start` returns both digests and `sparc_run_get` includes both in its bounded summary. Each recreation receives a new genesis even when every caller-visible definition is identical.
7. A single evidence ID cannot be rebound to another requirement or acceptance test. Refinement and Completion cite the exact immutable `{ evidenceId, version, digest }` value returned by the accepted mutation.
8. `pass` and `exception` evidence require an Ed25519 signature from a configured verifier. The exported `evidenceAttestationBytes` helper is the normative signing-byte implementation; its canonical subject binds `genesisDigest`, `requirementsDigest`, the principal, run, expected revision, current phase, evidence fields, optional authorization, key ID, issue time, schema version, and explicit nulls for absent optional fields.
9. Accepted attestation metadata persists both digests, and load-time verification requires them to equal the enclosing run. A signature cannot be transplanted into an identical or changed recreation.
10. Only the next phase can be entered.
11. A phase can advance only when its deterministic gate passes.
12. Completion requires verifier-attested passing evidence or an explicitly authorized, verifier-attested exception for every in-scope requirement and registered acceptance test.
13. Every accepted mutation appends a receipt bound to the resulting state.

The normative gate implementation lives in the domain module and is covered by executable tests. At a minimum, each phase requires its own artifact, Specification binds requirements to acceptance tests, and Completion proves all in-scope requirements. This keeps policy inspectable and prevents prompts from silently weakening it.

## MCP contract

The server presents a deliberately narrow capability set.

| Operation | Kind | Purpose |
|---|---|---|
| `sparc_run_get` | Read | Return one authorized bounded run summary, including both signing digests and collection counts |
| `sparc_phase_get` | Read | Return one snapshot-bound page of the current or requested phase artifacts and evidence |
| `sparc_gate_validate` | Read | Evaluate a gate without changing state |
| `sparc_trace_get` | Read | Return one snapshot-bound page of the receipt and transition trace |
| `sparc_run_start` | Mutation | Create an isolated random-bound run genesis and return both signing digests |
| `sparc_phase_submit` | Mutation | Append a versioned phase artifact |
| `sparc_evidence_record` | Mutation | Append requirement evidence or an authorized exception after required Ed25519 verification |
| `sparc_phase_advance` | Mutation | Enter exactly the next passing phase |

Read operations are annotated read-only and idempotent. `sparc_run_get` omits potentially large collections. Phase and trace reads are bounded to 25 entries and a 512 KiB serialized `entries` array per page and return an opaque continuation cursor bound to the principal, run, revision, digest, scope, and phase. A mutation invalidates an outstanding cursor, so clients restart rather than mix snapshots. CLI status uses the same summary principle, CLI list paginates principal-bound run summaries, and CLI trace uses the bounded trace pager. Mutation operations are non-destructive, revision-checked, and idempotent for exact replay. All operations are closed-world. The server does not expose command execution, arbitrary paths, generic file access, Git operations, deployment, reset, or deletion.

Local clients use MCP over standard input and output. The HTTP mode uses Streamable HTTP at `/mcp`, bounds request bodies and request duration, and constructs isolated protocol state per request. Anonymous access is limited to a loopback connection. A non-loopback deployment requires bearer authentication; the supported production path validates issuer, audience, signature, subject, and SPARC scopes from an OAuth authorization server. RFC 9728 protected-resource discovery preserves the configured resource path: resource `https://sparc.example.com/mcp` is advertised as `https://sparc.example.com/.well-known/oauth-protected-resource/mcp`. A root compatibility endpoint serves the same metadata document without changing its resource identifier.

## Host packaging

`plugins/sparc` is a dual plugin:

* `.claude-plugin/plugin.json` and the wrapped `.mcp.json` serve Claude Code.
* `.codex-plugin/plugin.json` references the validated wrapped `.mcp.json`; `.openai.mcp.json` provides the same server as a direct OpenAI server map for hosts that import that shape.
* `skills/sparc`, `skills/sparc-review`, and `skills/sparc-resume` are mirrored at the repository root for direct skill installation. Validation requires the mirrors to remain byte-identical.
* Both local MCP launchers pin `@ruvnet/sparc@1.0.0`. Floating tags are not allowed.

The npm skill installer preflights every selected host and skill, verifies staged digests, removes staging after observed copy failures, and restores backups after observed commit failures. Existing destinations require explicit `--force`, and symbolic-link traversal is rejected. This is a transactional process boundary; the six possible destination renames are not crash-atomic as one unit.

The source plugin does not contain a fabricated `.app.json`. ChatGPT creates the application identifier only after a deployed HTTPS MCP endpoint is registered in developer mode. A separate `plugin chatgpt package` command validates the returned identifier and produces the remote-app variant without changing the source plugin.

## Security properties

The design assumes MCP input, persisted state, phase artifacts, evidence details, and model-generated text are untrusted.

* Schemas reject unknown, over-deep, over-sized, non-JSON, and prototype-bearing values.
* State paths are derived from validated identifiers and remain beneath the configured root.
* Persistence uses private permissions and atomic replacement; symbolic-link escapes are rejected.
* Principal identity comes from the authenticated transport context, not a caller-provided tool argument.
* Usable evidence comes from a configured Ed25519 verifier. The SPARC process receives public keys through `SPARC_EVIDENCE_VERIFIER_KEYS`; verifier private keys remain in a separately controlled system.
* Evidence signatures and persisted attestation metadata bind the unique `genesisDigest` and stable `requirementsDigest`. Recreating an identical run produces a new genesis and invalidates signatures from the prior creation.
* State without a valid random-bound genesis fails closed on load. Prerelease pre-genesis state is not silently upgraded or trusted.
* Read calls do not change state or receipt digests.
* Authorization is checked before existence is disclosed, preventing cross-principal enumeration.
* Logs and errors report identifiers and classifications, never bearer tokens or artifact secrets.

## Consequences

The control plane becomes deterministic, resumable, and independently auditable. Claude, Codex, ChatGPT, and the CLI share one state machine, so host instructions cannot create divergent SPARC meanings. Existing Python entry points remain available.

The tradeoff is stricter ceremony: a substantial run needs five artifacts, independently signed usable evidence, and immutable evidence citations. A verifier must read and sign both run digests as well as the current revision. A stale concurrent writer must reconcile and obtain a new revision-bound signature instead of overwriting. Recreated runs require new evidence even when their definitions are identical. Historical verifier public keys must remain available while persisted evidence references them. Public ChatGPT use also requires deploying and securing the HTTP transport; a local stdio configuration cannot satisfy that use case.

## Rejected alternatives

* Prompt-only phases were rejected because they cannot enforce ordering, concurrency, or evidence.
* A generic agent tool with shell and filesystem access was rejected because it expands the trust boundary without improving SPARC state management.
* Last-write-wins persistence was rejected because it loses concurrent work.
* Mutable evidence was rejected because it makes completion claims unauditable.
* Self-asserted passing evidence was rejected because the same caller that writes a result cannot independently validate it.
* Binding evidence only to principal, run ID, revision, and definitions was rejected because deletion and identical recreation could otherwise accept a transplanted signature at the same revision.
* Unbounded MCP snapshots were rejected because a valid run can approach the persisted-state limit and exhaust a client or transport.
* Separate Claude and Codex implementations were rejected because their behavior would drift.
* A committed ChatGPT app identifier was rejected because registration, ownership, and deployment create that identifier outside the source tree.

## Compatibility and evolution

Persisted runs carry a schema version. Prerelease schema-version-1 state that predates `genesisDigest` and its random nonce fails closed as tampered; SPARC 1.0 does not synthesize a genesis or automatically migrate its evidence. Any future schema change requires an explicit migration and compatibility tests. Adding a phase, weakening a gate, changing receipt or attestation canonicalization, or introducing a new mutation is an architectural change and requires a new ADR.

Repository tests establish the local protocol and cryptographic behavior, not npm publication, a live OAuth provider, reverse-proxy correctness, ChatGPT registration, or independent private-key custody. Those remain external release acceptance gates.
