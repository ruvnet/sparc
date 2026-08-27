---
name: sparc
description: Run an engineering goal through the gated SPARC phases when the user wants a new implementation, integration, redesign, or other substantial delivery workflow.
---

# SPARC delivery

Use the `sparc` MCP server as the authority for run state. Keep the user's goal, constraints, and authorization boundaries intact.

## MCP prerequisite

Before the first tool call, verify that the host exposes an MCP server named `sparc` with the documented eight `sparc_*` tools. The standalone npm skill installer copies skills only and intentionally does not edit host MCP configuration. If the server is missing, stop and ask the user either to install the SPARC plugin or explicitly register this exact pinned stdio launcher:

```text
npx --yes @ruvnet/sparc@1.0.0 mcp stdio
```

Do not substitute a floating package tag, silently edit `.mcp.json`, `.openai.mcp.json`, or user-level host configuration, or claim the skill is operational until the server is visible. ChatGPT requires the separately deployed authenticated HTTPS transport described by SPARC; it cannot use this local stdio command.

## Workflow

1. State the goal, constraints, requirements, and observable acceptance evidence.
2. Call `sparc_run_start` once. Give the mutation a stable idempotency key.
3. Read the bounded summary with `sparc_run_get`. Read `sparc_phase_get` pages until `pagination.nextCursor` is absent; use the summary revision for the next mutation.
4. Work through Specification, Pseudocode, Architecture, Refinement, then Completion. Submit each phase artifact with `sparc_phase_submit`.
5. Append test results, review findings, or other proof with `sparc_evidence_record`. `pass` and `exception` require an Ed25519 attestation from a configured independent verifier; `fail` may be unsigned. A claim made only by the model is not evidence.
6. Call `sparc_gate_validate`. Call `sparc_phase_advance` only when the current gate passes.
7. Copy each accepted evidence record's exact `{ evidenceId, version, digest }` reference into Refinement and Completion artifacts. At Completion, cover every in-scope requirement and each registered acceptance test.
8. Before reporting completion, traverse every `sparc_trace_get` page, then reread the run summary. Report the run ID, final revision, and remaining exceptions.

## Evidence signatures

The server operator configures verifier public keys through `SPARC_EVIDENCE_VERIFIER_KEYS`; private keys never belong in that variable or SPARC state. Read the run immediately before requesting a signature and give the verifier the fresh `genesisDigest` and `requirementsDigest` returned by `sparc_run_start` or `sparc_run_get`. The verifier must include both digests and sign the exact bytes produced by the package's exported `evidenceAttestationBytes` helper, binding the authenticated principal, immutable run genesis, registered requirements and acceptance tests, run ID, pre-mutation revision, current phase, every evidence field, optional authorization, key ID, issue time, and algorithm. Submit the identical fields and revision. Never invent a signature, request the private key, or treat access to a signing key as implied authority. If an independent verifier is unavailable, report the evidence gate as blocked.

An `exception` also needs explicit authorization by a principal configured in `SPARC_EXCEPTION_APPROVERS`; the signature binds that authorization. A signature does not by itself prove the underlying claim, so identify the verifier and retained validation result.

## Snapshot and retry rules

Treat page cursors as opaque. For both phase and trace reads, continue with the returned `nextCursor` until it is absent. If a cursor is rejected as stale or the run revision changes, discard all pages from that traversal and restart at the first page; never mix snapshots.

Follow each MCP tool's declared input schema. On a stale mutation revision, reload state, reconcile, and obtain a new revision-bound signature when evidence changed; do not blind-retry. Reuse an idempotency key only for the exact same request. Never skip phases, rewrite prior artifacts, substitute a bare evidence ID for an immutable reference, suppress gate failures, or use this workflow to gain shell, deployment, deletion, or repository-push authority.
