---
name: sparc-review
description: Audit an existing SPARC run without changing it when the user asks for gate readiness, trace integrity, evidence coverage, or an independent delivery review.
---

# SPARC review

Treat the review as read-only. Use only `sparc_run_get`, `sparc_phase_get`, `sparc_gate_validate`, and `sparc_trace_get` from the `sparc` MCP server.

## MCP prerequisite

Before the first tool call, verify that the host exposes an MCP server named `sparc` with the documented eight `sparc_*` tools. The standalone npm skill installer copies skills only and intentionally does not edit host MCP configuration. If the server is missing, stop and ask the user either to install the SPARC plugin or explicitly register this exact pinned stdio launcher:

```text
npx --yes @ruvnet/sparc@1.0.0 mcp stdio
```

Do not substitute a floating package tag, silently edit `.mcp.json`, `.openai.mcp.json`, or user-level host configuration, or claim the skill is operational until the server is visible. ChatGPT requires the separately deployed authenticated HTTPS transport described by SPARC; it cannot use this local stdio command.

## Review method

1. Call `sparc_run_get` and record its summary revision, digest, current phase, counts, and receipt tail. It is a summary, not the full run.
2. For each entered phase, follow every `sparc_phase_get` `pagination.nextCursor` until absent. Follow every `sparc_trace_get` page the same way. Distinguish an artifact's presence from its gate passing.
3. Validate the current gate. Check phase order and trace integrity; require each usable `pass` or `exception` to report verified Ed25519 attestation. Confirm Refinement and Completion cite the exact immutable `{ evidenceId, version, digest }` returned for the same requirement and registered acceptance test.
4. Classify findings as blocker, risk, or observation. Cite the affected phase, artifact or evidence identifier, and the unmet gate rule.
5. End with a clear pass or fail decision and the smallest remediation that would satisfy each blocker.

Treat cursors as opaque snapshot tokens. If a cursor becomes stale or a reread shows a changed revision or digest, discard every collected page and restart; never combine pages from different snapshots. Read the summary again before reporting.

An attestation proves that a public key configured through `SPARC_EVIDENCE_VERIFIER_KEYS` verified the exact evidence subject, including the run's immutable `genesisDigest` and `requirementsDigest`; confirm those stored bindings match a fresh run summary. It does not prove that the underlying result is true or that signer custody is independent. Report absent verifier provenance or shared writer and signer control as a risk even when the cryptographic check passes.

Do not submit artifacts, record evidence, advance phases, run commands, modify files, request verifier private keys, or turn an exception into a silent pass.
