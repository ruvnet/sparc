# User guide

SPARC turns Specification, Pseudocode, Architecture, Refinement, and Completion into a resumable, evidence-gated workflow. It records methodology state; it does not execute code, tests, Git operations, or deployment commands.

## Start

After `@ruvnet/sparc@1.0.0` is published:

```sh
npx --yes @ruvnet/sparc@1.0.0 doctor
npx --yes @ruvnet/sparc@1.0.0 init
```

From a source checkout, run `npm ci --ignore-scripts`, `npm run build`, and replace the `npx` prefix with `node dist/cli.js`.

Create a definition with stable requirement and acceptance-test identifiers, then start a run. Keep every returned revision; the next mutation must use it. Submit the current phase artifact, validate its gate, and advance only when the gate passes. Complete examples for all five artifacts are under `templates`.

Use `sparc status` for a bounded summary, `sparc list --limit 1..25` for discovery, and `sparc trace --limit 1..25` for audit pages. Follow each returned cursor until absent. If state changes while paging, restart rather than combine snapshots.

## Evidence

A `fail` result may be recorded without a signature. A `pass` or `exception` requires an Ed25519 verifier configured through `SPARC_EVIDENCE_VERIFIER_KEYS`. The independent verifier signs the package's exact `evidenceAttestationBytes`, including the fresh run `genesisDigest`, `requirementsDigest`, expected revision, phase, and evidence fields. Refinement and Completion cite accepted proof only by its exact `{ evidenceId, version, digest }` reference.

See [EVIDENCE_ATTESTATION.md](./EVIDENCE_ATTESTATION.md) before recording usable evidence. A signature proves binding to a configured key, not that the underlying test truly ran; retain the external validation result and signer provenance.

## Skills and plugins

The npm package contains `$sparc`, `$sparc-review`, and `$sparc-resume`. A standalone skill install copies only skill directories and does not modify host MCP settings:

```sh
npx --yes @ruvnet/sparc@1.0.0 skills install --host both --target .
```

Before invoking a local skill, install the full plugin or explicitly register an MCP server named `sparc` with the exact launcher `npx --yes @ruvnet/sparc@1.0.0 mcp stdio`. The command result reports this prerequisite. Never substitute a floating package tag.

Claude and Codex plugin instructions are in [PLUGIN_INSTALLATION.md](./PLUGIN_INSTALLATION.md). ChatGPT cannot reach local stdio; it requires the authenticated Streamable HTTP service behind HTTPS plus live developer-mode registration.

## Recovery and safety

Persisted state is authoritative. After an uncertain mutation, read the run before retrying. Reuse an idempotency key only for the exact same request. Stop on an integrity failure, unexplained revision conflict, missing verifier, stale cursor, or failed gate.

Keep the state root private. Never place provider credentials in artifacts, evidence, plugin files, or logs. Previously exposed credentials must be revoked even after their file is removed from the current branch.
