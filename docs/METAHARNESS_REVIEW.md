# SPARC and MetaHarness Deep Review

Review date: 2026 08 27

Repositories reviewed:

| Repository | Revision | Scope |
| --- | --- | --- |
| `ruvnet/SPARC` | `9656782ea9ed8d96e1d9c76a7f98b4718d365296` | Python CLI, UI, phase documents, tests, packaging, CI, and security boundaries |
| `ruvnet/metaharness` | `6f8c60216f47eac391a076fe27fd804470a07e10` | Kernel, SDK, Harness, Router, Horizon, Darwin, Flywheel, hosts, scaffolder, and ChatGPT MCP package |

This review records the evidence used to design the SPARC metaharness. It is not a claim that every line of either repository is defect free.

## Executive finding

The prior SPARC repository described five phases but did not implement them as a state machine. The Python execution path used Research, Planning, and Implementation, with phase documents acting as prompts rather than enforced gates. There was no SPARC MCP server, npm executable, Claude plugin, ChatGPT integration, compare and set state, idempotency contract, or tamper evident completion proof.

MetaHarness provides useful primitives but its high level runner and generated host configurations are not safe to adopt unchanged. The new implementation therefore composes selected public primitives around an independent SPARC domain model.

## SPARC findings

| Severity | Finding | Design response |
| --- | --- | --- |
| Critical | `ui.zip` contained populated provider credentials in environment files | Remove the archive from the current branch, require key rotation, document history cleanup, and add archive aware scanning |
| Critical | Interactive argv was reconstructed into a shell command | Preserve argv through a direct pseudo terminal execution path and add metacharacter regression tests |
| Critical | Untrusted math strings reached `sympy.sympify` | Parse an explicit arithmetic grammar into allowlisted SymPy constructors |
| High | The default Aider dependency chain could not resolve to the required patched GitPython line | Remove unused Aider from the default install, require a patched GitPython release, lock the environment, and audit it in CI |
| High | CI converted test failures into successful jobs | Replace masked commands with fail closed jobs |
| High | Five phase documents were not connected to executable state | Add a typed state machine with exact order and gates |
| High | Plans were written and read under inconsistent state keys | New state is defined by one canonical schema and store |
| High | Completion had no evidence or traceability gate | Require validation evidence and requirement coverage before completion |
| Medium | Retry policy could consume about 843 seconds before exhausting its backoff | New MCP mutations are deterministic and do not perform implicit model retries |

The legacy Python surface remains a compatibility layer. It is not exposed through the SPARC MCP capability set.

## MetaHarness package assessment

| Package | Version reviewed | Reuse | Constraint |
| --- | ---: | --- | --- |
| `@metaharness/sdk` | 0.1.0 | Declarative agents, skills, tools, and MCP definition | Validate the resulting runtime contract independently because SDK validation is shallow |
| `@metaharness/kernel` | 0.1.3 | MCP configuration validation and backend diagnostics | Do not use its unbound witness fallback as release proof |
| `@metaharness/harness` | 0.2.0 | DAG compilation, default deny policy, and hash chained receipts | Do not use `HarnessKernel.run` because effects occur before some gates and prerequisite failures do not fail fast |
| `@metaharness/horizon` | 0.2.0 | Checkpoint hashing and continuity format | Do not expose `NodeToolExecutor`; its command guard is not a sandbox |
| `@metaharness/flywheel` | 0.1.10 | Frozen promotion rule and gate fingerprint | Validate inputs and do not represent its partial receipt as full bundle attestation |
| `@metaharness/darwin` | 0.9.3 | Future bounded proposal source | Disabled in the core lifecycle because clean replay promotion is not reachable through the reviewed runner |
| `@metaharness/router` | 0.4.0 | Future validated model selection | Not required for deterministic phase state and not enabled by default |

## MetaHarness defects that shaped the design

1. Generated MCP configurations invoke `npx <package>@latest mcp start`, while generated CLIs have no MCP server. The reviewed MCP invoke command is a placeholder.

2. `HarnessKernel` records utility without selecting by it, executes a worker before confidence, risk, and cost gates, retries without critique, undercounts failed attempt cost, and lets dependent steps continue after a failed prerequisite.

3. Horizon does not check in its expected WebAssembly artifact. Most TypeScript tests skip without it. Its Node executor uses a shell and must not be treated as isolation.

4. Darwin bench promotion requires `cleanReplay` but the main evolution path cannot supply it. Budget checks occur after parallel evaluation work has already run.

5. Flywheel receipts bind only part of a lineage commit. Replay does not recompute the complete bundle, and sequential evidence is not supplied by the normal runner.

6. Claude and Codex host renderers build unquoted command or TOML fragments and lose some host semantics. Codex configuration is not a ChatGPT remote integration.

7. The strongest reviewed remote MCP implementation is the private ARC ChatGPT package. Its stateless Streamable HTTP, strict schemas, scoped authorization, compare and set updates, idempotency, limits, structured results, and real SDK tests were adopted as patterns. Its private SDK handler patch was not copied.

## Resulting architecture

The SPARC domain engine owns the load bearing guarantees:

1. The only legal phase order is Specification, Pseudocode, Architecture, Refinement, Completion.
2. Every mutation requires an authenticated principal, expected revision, and idempotency key.
3. Artifacts, corrections, and evidence are append only.
4. Reads do not mutate state or receipts.
5. Phase gates run before advancement.
6. Completion requires validation evidence and requirement traceability.
7. State writes are atomic, root contained, and reject symbolic link traversal.
8. Every accepted mutation produces a hash chained receipt.

The MCP server is a capability adapter around that engine. It exposes eight SPARC specific tools and no shell, arbitrary filesystem, network fetch, Git push, deployment, or package installation capability.

## Host packaging decision

Claude Code receives a local stdio server configuration. Local Codex can use the same transport. ChatGPT receives a remote Streamable HTTP configuration with bearer or OAuth compatible access token verification. Public ChatGPT installation requires deploying the endpoint over HTTPS and registering it in ChatGPT developer mode. A local stdio process is intentionally insufficient for that use case.

The source plugin does not include a fabricated `.app.json`. ChatGPT creates that identifier only after MCP registration; the pinned npm CLI then packages a separate remote-app plugin from the exact returned identifier.

## Acceptance gate

A release candidate passes only when all of the following are true:

1. A clean npm install, typecheck, unit suite, build, plugin validation, secret scan, and package dry run pass without swallowed failures.
2. The official MCP client initializes, lists, and calls both stdio and Streamable HTTP transports.
3. Phase skipping, stale revisions, changed idempotency replay, cross principal access, missing completion evidence, and receipt tampering all fail.
4. Repeating the same idempotent mutation returns the original result and does not add a receipt.
5. Plugin manifests and every skill validate, reference an exact package version, and contain no dangerous generic capability.
6. The packed npm artifact contains no secrets, databases, caches, source archives, or local state.

## Known operational obligation

Removing `ui.zip` from the current branch does not remove it from existing Git history. The Anthropic and E2B credentials found in the archive must be revoked and rotated by their owner. Repository history cleanup should follow GitHub secret removal guidance and must be coordinated because rewriting published history disrupts clones and open work.
