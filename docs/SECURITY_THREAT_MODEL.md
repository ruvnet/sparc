# SPARC Metaharness Threat Model

## Security objective

SPARC records and validates development lifecycle evidence. It does not execute implementation commands. A compromised model, repository, skill, MCP client, or phase artifact must not be able to grant itself broader authority, skip a phase, overwrite accepted evidence, impersonate another principal, or forge completion.

## Protected assets

| Asset | Required property |
| --- | --- |
| Run state | Integrity, principal isolation, deterministic revision history, and unique random-bound genesis identity |
| Phase artifacts | Append only provenance and content digest |
| Evidence | Append only provenance, bounded size, explicit requirement and test links, verifier authenticity for usable results |
| Verifier keys | Public-key configuration integrity and private-key separation |
| Receipts | Ordered, tamper evident transition chain |
| Access tokens | Never stored in state, output, logs, plugins, or package artifacts |
| Workspace root | No traversal, symbolic link escape, or arbitrary absolute path access |

## Trust boundaries

1. MCP client to server. Inputs are untrusted even after authentication.
2. Server to persistent state. Paths, revisions, and stored JSON require validation.
3. Repository content to model or operator. Instructions inside artifacts are data, not authority.
4. Local plugin to npm registry. Package name and version are exact and the package has no install lifecycle script.
5. Reverse proxy to HTTP MCP. Host headers, issuer, audience, scopes, and forwarded identity require explicit configuration.
6. Independent verifier to SPARC writer. The verifier observes a result and signs a complete revision-bound subject; the writer receives the attestation but not the private key.

## Threats and controls

| Threat | Control | Validation |
| --- | --- | --- |
| Phase skipping | Fixed phase transition table and gate validation | Skip transition test |
| Lost update | Compare and set `expectedRevision` | Concurrent stale revision test |
| Idempotency collision | Principal scoped key bound to canonical request hash | Same key with changed payload test |
| Cross tenant read or write | Principal ownership check on every operation | Cross principal test |
| Artifact overwrite | Versioned append only artifact records | Historical digest test |
| Self-asserted pass or exception | `pass` and `exception` require a valid configured Ed25519 signature over both run digests, the exact run, revision, phase, result, details, and authorization | Missing, unknown-key, forged, and rebound attestation tests |
| Signature transplant after run recreation | A deterministic requirements digest binds definitions; a random-bound genesis digest identifies one creation and is required in the signing subject and stored attestation metadata | Identical-recreation, changed-definition, and wrong-genesis tests |
| Completion without proof | Required verifier-attested evidence and immutable `{ evidenceId, version, digest }` traceability | Missing, mutable-reference, wrong-version, and wrong-digest tests |
| Receipt modification | SHA 256 hash chain with verification on load and request | Tamper test |
| Path traversal | Canonical root containment, strict identifiers, symbolic link rejection | Parent, absolute, and symbolic link tests |
| MCP capability escalation | Eight explicit SPARC tools and default deny policy | Tool inventory denylist test |
| Prompt injection | No implicit model call, tool grant, or shell action from stored text | Malicious artifact inertness test |
| Request exhaustion | Input, body, collection, and output bounds with request timeout; bounded summaries and cursor pagination | Oversize, page-byte, page-limit, and timeout tests |
| Remote impersonation | HTTPS deployment plus validated JWT issuer, audience, expiry, principal, and scopes | 401 and 403 tests |
| DNS rebinding or proxy confusion | Loopback default and allowed host validation | Host rejection test |
| OAuth discovery ambiguity | The challenge advertises the RFC 9728 path-derived URI; a root compatibility endpoint returns the same resource metadata | Path-bearing advertisement and equivalent fallback tests |
| Secret inclusion | Tracked file and archive aware scanning plus explicit npm file allowlist | Canary and package scan tests |
| Partial dual-host skill install | Preflight and verified staging across all destinations, staging cleanup on observed copy failure, backup restoration on observed commit failure, and symbolic-link rejection | Existing-destination and rollback tests |

## Authorization model

Read operations require `sparc.read`. Mutations require `sparc.write`. The authenticated token subject becomes the principal identifier. A caller supplied principal is never trusted over token identity.

Local stdio uses one explicit local principal and inherits no remote identity claim. It is suitable only when the process boundary itself is trusted.

Remote HTTP requires one of these deployment modes:

1. JWT verification against a configured issuer, JSON Web Key Set, and audience.
2. A static development bearer token while bound to loopback.

Unauthenticated nonloopback serving is prohibited. Static development tokens are not a production identity system.

With a path-bearing JWT resource, the RFC 9728 URI advertised in `WWW-Authenticate` is path-specific. For `https://sparc.example.com/mcp`, it is `https://sparc.example.com/.well-known/oauth-protected-resource/mcp`. A root compatibility endpoint also returns the same document for clients that probe `/.well-known/oauth-protected-resource`; it does not change the metadata `resource`. The reverse proxy should preserve both routes, and the resource value must match the audience design of the authorization server.

## Evidence verification model

`SPARC_EVIDENCE_VERIFIER_KEYS` is a JSON map from bounded key IDs to Ed25519 public keys. The server parses every configured value as a public key and rejects non-Ed25519 keys. Private keys remain outside the SPARC process and state root.

Every creation computes two immutable public digests. `requirementsDigest` covers the requirements and acceptance-test definitions. `genesisDigest` covers the genesis schema, principal, run ID, title, complete definitions, and a new random 32-byte internal nonce. `sparc_run_start` returns both in its mutation value, and `sparc_run_get` returns both in the bounded run summary. Recreating identical caller-visible input produces a new random-bound genesis; changing definitions changes the requirements digest too.

The exported `evidenceAttestationBytes` helper canonicalizes a versioned subject that binds `genesisDigest`, `requirementsDigest`, the authenticated principal, run ID, expected pre-mutation revision, current phase, evidence ID, requirement ID, optional test ID, status, summary, details, optional exception authorization, key ID, issue time, and Ed25519 algorithm. Canonical nulls bind absent optional fields consistently across runtimes. A 64-byte unpadded base64url signature is required for `pass` and `exception`; an optional signature on `fail` is verified too.

The caller-supplied attestation object contains only key ID, issue time, algorithm, and signature. The server takes both digests from trusted run state when reconstructing the subject. Accepted attestation metadata persists `genesisDigest`, `requirementsDigest`, and `expectedRevision`. On every load, SPARC recomputes the genesis and requirements digests, requires the stored metadata to match the enclosing run, and re-verifies the signature. This prevents transplant into an identical or changed recreation.

Accepted evidence receives an immutable digest and monotonically increasing version. Refinement and Completion artifacts cite the exact `{ evidenceId, version, digest }` triple. Reusing an evidence ID cannot rebind it to another requirement or test. Full signing guidance is in [EVIDENCE_ATTESTATION.md](./EVIDENCE_ATTESTATION.md).

The public key is needed again when persisted state is loaded. Rotation therefore adds a new key ID while retaining old public keys for every referencing run. SPARC 1.0 has no in-place re-sign or key-migration operation.

Prerelease schema-version-1 state without a valid genesis nonce and digest fails closed as tampered even if its prior integrity hash is internally consistent. SPARC does not synthesize an identity or silently trust attestations from pre-genesis state.

## Capability exclusions

The SPARC MCP server never exposes:

1. Shell or process execution.
2. Generic file read or write.
3. Arbitrary URL retrieval.
4. Git commit, push, branch, or history rewrite.
5. Package installation.
6. Deployment or deletion.
7. Provider credential handling.

These actions belong to separately authorized and isolated tools. SPARC may record evidence produced by them, but cannot invoke them.

## Residual risks

The receipt chain is tamper evident, not externally signed. A host with write access to both state and application code can replace the entire chain. Stronger deployments should anchor the final digest in a separately controlled signing or transparency service.

An Ed25519 evidence signature proves that a configured key signed the exact subject. It does not independently prove that a test ran or that its result is true. If the writer also controls the verifier private key, attestation provides integrity binding but no independent review. The signed `issuedAt` is not an enforced freshness or expiry policy. Protect key provisioning, time policy, and signer identity outside SPARC.

Genesis uniqueness relies on the operating system random source used for the 32-byte nonce. Loss of a run and recreation intentionally invalidates its earlier signatures, even when the reconstructed definitions are byte-for-byte identical. SPARC 1.0 provides no automatic pre-genesis migration or evidence transplant path.

Pagination bounds each MCP or CLI trace response, not the total size of a complete audit. Clients must follow every snapshot-bound `nextCursor`, enforce their own total-work budget, and restart rather than combine pages if the run changes. `sparc_run_get` and CLI `status` intentionally return summaries, not collection contents. CLI `list` returns principal-bound pages of run summaries.

The skill installer removes staging after an observed copy failure and restores backups after an observed commit failure. Its six possible destination renames are not crash-atomic as one unit. A process crash, filesystem failure, cleanup failure, or operator interruption outside that rollback path remains an operational recovery case.

The MCP runtime bounds each request but does not provide a cross-request or cross-replica quota. Production deployments should enforce authenticated principal and tenant rate limits in shared proxy infrastructure.

Removing exposed credentials from the branch does not revoke them or erase prior Git objects. Credential rotation and coordinated history cleanup remain owner actions.

Local tests and repository validators do not prove npm publication, a live OAuth provider, proxy routing, ChatGPT registration, production quota coordination, or external verifier independence. Those require environment-specific acceptance evidence before a deployment is represented as ready.
