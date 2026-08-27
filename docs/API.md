# SPARC control-plane API

SPARC 1.0 exposes one deterministic domain through an ESM package, a command-line interface, and Model Context Protocol transports. Node.js 20 or newer is required. The preserved Python CLI is a separate compatibility surface.

## Package exports

```js
import {
  SparcStore,
  evidenceAttestationBytes,
  sparcHarness,
  createSparcMcpServer,
  startSparcStdioServer,
  startSparcMcpHttpServer,
  installSkills,
} from '@ruvnet/sparc';
```

Equivalent focused entry points are available as `@ruvnet/sparc/mcp`, `@ruvnet/sparc/metaharness`, and `@ruvnet/sparc/skills`. The package is ESM-only.

`SparcStore` is the authoritative local state API. Every operation receives an authenticated `principalId`; mutations also receive an exact `expectedRevision` and a stable `idempotencyKey`. State is confined beneath the configured root. Callers should treat returned revisions, digests, cursors, evidence references, and receipts as opaque integrity values.

Passing and exception evidence requires an Ed25519 signature over the bytes returned by `evidenceAttestationBytes`. The payload includes the fresh run `genesisDigest`, `requirementsDigest`, principal, run, pre-mutation revision, phase, evidence fields, and attestation metadata. See [EVIDENCE_ATTESTATION.md](./EVIDENCE_ATTESTATION.md) for the complete contract.

## MCP tools

| Tool | Scope | Result |
|---|---|---|
| `sparc_run_get` | `sparc.read` | Bounded run summary and collection counts |
| `sparc_phase_get` | `sparc.read` | One snapshot-bound page of phase artifacts and evidence |
| `sparc_gate_validate` | `sparc.read` | Deterministic gate result without mutation |
| `sparc_trace_get` | `sparc.read` | One snapshot-bound trace page plus integrity status |
| `sparc_run_start` | `sparc.write` | New principal-owned run |
| `sparc_phase_submit` | `sparc.write` | New immutable phase-artifact version |
| `sparc_evidence_record` | `sparc.write` | New immutable evidence version after required verification |
| `sparc_phase_advance` | `sparc.write` | Next phase, or completed status, only after a passing gate |

Tool inputs use strict schemas and reject unknown fields. The server intentionally exposes no generic shell, filesystem, URL-fetch, Git, deployment, reset, or deletion operation.

Phase and trace reads return `entries` and `pagination`. Page limits are 1 through 25 and the serialized entries array is capped at 512 KiB. A cursor is bound to the principal, run, revision, digest, scope, and phase. If a mutation makes a cursor stale, discard the partial traversal and restart from the first page.

## Transports and authentication

Local clients use stdio:

```sh
npx --yes @ruvnet/sparc@1.0.0 mcp stdio --root /absolute/private/state --principal local-user
```

Remote clients use Streamable HTTP at `/mcp`. The process binds loopback and belongs behind an HTTPS reverse proxy. Production mode validates JWT signature, issuer, audience, subject, age, and SPARC scopes against a configured JWKS endpoint. A static bearer token is limited to loopback development. RFC 9728 protected-resource discovery is described in [PLUGIN_INSTALLATION.md](./PLUGIN_INSTALLATION.md).

## Errors

Domain failures use stable classifications such as validation, revision conflict, authorization, integrity, and not found. CLI failures are emitted as JSON on standard error and return nonzero. MCP failures use protocol error results. Do not parse human-readable messages as an API; branch on the stable classification and reread authoritative state after a conflict.
