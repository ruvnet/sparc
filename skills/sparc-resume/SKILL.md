---
name: sparc-resume
description: Safely resume an interrupted or handed-off SPARC run from its verified persisted state without duplicating mutations or skipping unfinished gates.
---

# Resume a SPARC run

Persisted MCP state, not conversation memory, is authoritative.

## MCP prerequisite

Before the first tool call, verify that the host exposes an MCP server named `sparc` with the documented eight `sparc_*` tools. The standalone npm skill installer copies skills only and intentionally does not edit host MCP configuration. If the server is missing, stop and ask the user either to install the SPARC plugin or explicitly register this exact pinned stdio launcher:

```text
npx --yes @ruvnet/sparc@1.0.0 mcp stdio
```

Do not substitute a floating package tag, silently edit `.mcp.json`, `.openai.mcp.json`, or user-level host configuration, or claim the skill is operational until the server is visible. ChatGPT requires the separately deployed authenticated HTTPS transport described by SPARC; it cannot use this local stdio command.

## Recovery workflow

1. Obtain the run ID. If it is missing or ambiguous, ask for it rather than choosing a run.
2. Call `sparc_run_get` for the bounded summary. Follow every `sparc_trace_get` and current `sparc_phase_get` `pagination.nextCursor` until absent. Identify the snapshot revision and digest, current phase, latest valid receipt, submitted artifacts, evidence, and gate blockers.
3. Summarize what is verified, what remains, and the next permitted mutation before continuing.
4. Continue only the unfinished current phase. Use `sparc_phase_submit` or `sparc_evidence_record` with the latest revision and a new stable idempotency key.
5. Call `sparc_gate_validate`; use `sparc_phase_advance` only after a passing result.
6. For Refinement and Completion, cite accepted evidence only by its exact `{ evidenceId, version, digest }` reference and cover each registered acceptance test.
7. Confirm the new revision and traverse a fresh trace snapshot after every mutation.

Treat cursors as opaque. If a cursor is stale or the run revision changes during pagination, discard the collected pages and restart from the first page; never mix snapshots.

`pass` and `exception` evidence require an Ed25519 attestation verified by a public key in `SPARC_EVIDENCE_VERIFIER_KEYS`; private keys remain outside SPARC. Read the run immediately before asking the independent verifier to sign the exact bytes from `evidenceAttestationBytes`. Supply the fresh `genesisDigest` and `requirementsDigest` returned by `sparc_run_start` or `sparc_run_get`; the signature binds both digests, the principal, run, pre-mutation revision, current phase, all evidence fields, and optional authorization. Never invent a signature or request the private key. If the signed mutation loses a revision race, reconcile and obtain a new signature.

If the previous operation's outcome is uncertain, read state before retrying. Reuse its idempotency key only when every request field is identical; otherwise create a new key. Stop on a trace-integrity failure, principal mismatch, missing required artifact, unavailable verifier, unverifiable attestation, or unexplained revision conflict. Never reconstruct state from chat, bypass a failed gate, edit historical evidence, substitute a bare evidence ID for an immutable reference, or infer authority for unrelated external changes.
