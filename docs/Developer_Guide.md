# Developer guide

## Prerequisites

Use Node.js 20 or newer for the TypeScript control plane. Python compatibility requires Python 3.10 or newer. The web UI has its own locked Node workspace under `ui`.

## Control-plane setup

```sh
npm ci --ignore-scripts
npm run validate:plugins
npm run typecheck
npm run test:coverage
npm run build
npm run scan:secrets
npm pack --dry-run
```

`npm run check` runs the repository-level TypeScript release gate. Runtime and development dependencies must also pass the high-severity audit gate:

```sh
npm audit --audit-level=high
```

The package defines no install lifecycle script. `prepack` compiles TypeScript; `prepublishOnly` runs the repository check. Source validation does not publish the package or prove registry provenance.

## Repository layout

| Path | Responsibility |
|---|---|
| `src/domain.ts` | Canonical types, identifiers, canonicalization, and attestation bytes |
| `src/gates.ts` | Phase-specific deterministic gates |
| `src/store.ts` | Principal isolation, revisions, idempotency, persistence, and integrity |
| `src/mcp` | Strict schemas plus stdio and Streamable HTTP transports |
| `src/metaharness.ts` | Constrained MetaHarness composition |
| `src/skills.ts` | Dual-host skill installation and path safety |
| `plugins/sparc` | Claude and Codex plugin package |
| `skills` | Byte-identical standalone skill mirrors |
| `templates` | Complete phase-artifact examples |
| `tests` | Domain, transport, installer, plugin, and security regressions |

## Engineering rules

Keep the MCP capability set closed. New tools, weaker gates, changed receipt canonicalization, or schema migrations require an explicit design review and compatibility tests. Never execute artifact or evidence text. Preserve compare-and-set revisions, exact idempotency, immutable versions, principal isolation, and complete acceptance-test traceability.

Passing or exception evidence is unusable without a configured Ed25519 verifier. Signing code must call `evidenceAttestationBytes` and bind the run's fresh `genesisDigest` and `requirementsDigest`; do not reproduce canonicalization independently.

Root and plugin skill mirrors must remain byte-identical. Run both the repository validator and, when available, the reference plugin and skill validators listed in [VALIDATION.md](./VALIDATION.md).

## Python compatibility

```sh
uv sync --frozen --extra dev --python 3.12
uv run --frozen --extra dev python -m pytest
uv run --with pip --frozen --extra dev pip-audit
```

Playwright browser installation is an explicit developer action, never a build hook.

## UI validation

```sh
cd ui
npm ci --ignore-scripts
npm run typecheck
npm run test:security
npm run build
npm audit --audit-level=high
```

## Release boundary

Before a public release, install the generated tarball into a clean directory, smoke-test the executable and public exports on supported Node versions, then publish through an authenticated provenance-capable workflow. After publication, verify the registry tarball and run the exact pinned `npx` command. Claude ingestion, Codex reload, a production OAuth provider, HTTPS proxy routing, and live ChatGPT registration remain separate environment-specific acceptance gates.
