# Claude, Codex, and ChatGPT integration

The repository packages one implementation with two local plugin adapters. Both adapters launch the exact npm release `@ruvnet/sparc@1.0.0` and expose the same three skills. A source push does not publish that npm release; verify it exists before relying on the launchers.

## Verifier configuration

Any process that opens state containing passing or exception evidence must have the corresponding Ed25519 public keys. Set `SPARC_EVIDENCE_VERIFIER_KEYS` in the environment inherited by Claude, Codex, the CLI, or the hosted MCP process:

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

Only public keys belong in this configuration. A separately controlled verifier retains the private key and signs the exact bytes produced by `evidenceAttestationBytes`. See [EVIDENCE_ATTESTATION.md](./EVIDENCE_ATTESTATION.md).

## Claude Code

In Claude Code, add the repository marketplace and install the plugin:

```text
/plugin marketplace add ruvnet/SPARC
/plugin install sparc@ruvnet-sparc
```

Restart the session after installation. Claude discovers `plugins/sparc/.mcp.json` and the skills under `plugins/sparc/skills`.

## Codex

Clone the repository, then register its non-default local marketplace using an absolute path:

```sh
codex plugin marketplace add /absolute/path/to/SPARC
codex plugin add sparc@ruvnet-sparc
```

Start a new thread so Codex reloads the plugin. The Codex manifest uses the validated wrapped `.mcp.json`. The equivalent `.openai.mcp.json` is included for OpenAI hosts that import a direct server map; both start the same pinned npm package over stdio.

The skills are also available from the repository-level `skills` directory for hosts that install skills independently of a plugin. A standalone install copies only the requested skill directories. It does not silently create or merge `.mcp.json`, `.openai.mcp.json`, or user-level host configuration. The command result and every installed skill identify the required server name `sparc` and exact local launcher `npx --yes @ruvnet/sparc@1.0.0 mcp stdio`; install the full plugin or explicitly register that launcher before using a local skill. ChatGPT requires the remote authenticated endpoint instead.

The npm installer preflights all requested Claude and Codex destinations, rejects symbolic links in the requested target path and destinations, verifies staged digests, records and rechecks target, host-directory, and staged-directory identities, re-digests immediately before each rename, verifies the installed digest immediately afterward, removes staging after an observed staging failure, and restores backups after an observed commit failure; `--force` is required to replace an existing SPARC skill. Node does not provide a portable directory-relative `openat` transaction. A hostile process that already has permission to rename target-tree directories can therefore race the final path checks; run installation with exclusive trusted control of the target tree. This is a transactional process guarantee, not a claim that all six possible destination renames are crash-atomic as one unit.

## ChatGPT

ChatGPT cannot connect to a process running on a developer's standard input and output. Deploy the HTTP transport behind a stable HTTPS URL, configure OAuth bearer validation, and register the resulting `/mcp` endpoint in ChatGPT developer mode.

Use the full protected-resource URL in configuration:

```sh
export SPARC_MCP_AUTH_ISSUER=https://identity.example.com
export SPARC_MCP_AUTH_AUDIENCE=sparc-mcp
export SPARC_MCP_AUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
export SPARC_MCP_RESOURCE=https://sparc.example.com/mcp
```

RFC 9728 path-specific discovery for that resource is served and advertised at `https://sparc.example.com/.well-known/oauth-protected-resource/mcp`. The server also serves the same resource metadata at the root compatibility endpoint `https://sparc.example.com/.well-known/oauth-protected-resource`. Route both discovery paths and `/mcp` through the HTTPS proxy. If the configured resource has a deeper path, its canonical advertised metadata path appends that entire path after `/.well-known/oauth-protected-resource`.

Do not create an `.app.json` by guessing an application identifier. ChatGPT produces a technical identifier beginning with `plugin_asdk_app_` during registration. After registration, package the remote-app variant with the exact returned value:

```sh
npx --yes @ruvnet/sparc@1.0.0 plugin chatgpt package \
  --app-id plugin_asdk_app_<registered-id> \
  --target ./dist-plugins
```

This creates `./dist-plugins/sparc` without mutating the source plugin. Its `.app.json` maps the `sparc` app to the registered identifier, and its Codex manifest references that app instead of the local stdio MCP launcher. The output path must be a real directory path without symbolic links; generated files are opened without following links and synchronized before commit. An existing `sparc` output requires `--force`, with atomic backup and restoration around replacement. Node does not expose a portable directory-relative `openat` transaction, so run packaging with exclusive trusted control of the target tree; an already-privileged process able to rename directories concurrently remains a narrow check-to-operation race.

A deployment is not production-ready until authentication, RFC 9728 discovery, principal isolation, scope enforcement, signed evidence, pagination, generated-plugin validation, and the remote checks in [VALIDATION.md](./VALIDATION.md) pass. Repository tests cannot substitute for a live ChatGPT registration and production identity provider.

## Available skills

| Skill | Use |
|---|---|
| `$sparc` | Start and deliver a five-phase run |
| `$sparc-review` | Audit gates, evidence, and trace without mutations |
| `$sparc-resume` | Recover an interrupted run from persisted state |

All state-changing MCP calls use expected revisions and idempotency keys. The plugin provides no arbitrary shell, filesystem, Git, deployment, reset, or deletion capability.

`sparc_run_get` returns a bounded summary rather than the full trace. `sparc_phase_get` and `sparc_trace_get` return revision-bound pages. A host must follow `pagination.nextCursor` until absent. If a cursor becomes stale after a mutation, discard the traversal and restart at the first page so evidence from different snapshots is never mixed.

Passing and exception evidence must include a valid Ed25519 attestation. Refinement and Completion artifacts must cite the exact returned `{ evidenceId, version, digest }` reference. The host must request an attestation from the independent verifier; it must never invent a signature or request access to the private key.
