# SPARC 1.0 tutorial

This walkthrough creates a deterministic SPARC run and advances it from Specification toward verified Completion. SPARC stores claims and evidence but never executes commands contained in either one.

## 1. Validate the executable

The public commands below work after the exact package is published. In a source checkout, build with `npm ci --ignore-scripts && npm run build`, then use `node dist/cli.js` in place of the `npx` prefix.

```sh
npx --yes @ruvnet/sparc@1.0.0 doctor
npx --yes @ruvnet/sparc@1.0.0 init --root .sparc
```

`doctor` validates the five-phase MetaHarness plan and eight-tool MCP definition. It does not test a hosted identity provider or ChatGPT registration.

## 2. Define observable acceptance

Create `definition.json`:

```json
{
  "requirements": [
    {
      "id": "REQ-1",
      "statement": "The service returns one bounded health response",
      "inScope": true,
      "acceptanceTestIds": ["TEST-1"]
    }
  ],
  "acceptanceTests": [
    {
      "id": "TEST-1",
      "description": "A clean integration check observes the bounded health response"
    }
  ]
}
```

Identifiers are stable trace keys, not prose labels. Start the run once:

```sh
npx --yes @ruvnet/sparc@1.0.0 start \
  --root .sparc \
  --run-id health-change \
  --title "Bound the health response" \
  --definition definition.json \
  --idempotency-key start-health-change
```

Record the returned revision, `genesisDigest`, and `requirementsDigest`. The digests bind future evidence to this exact run creation and registered definition.

## 3. Submit and gate each design phase

Copy `templates/specification.json`, replace its example identifiers and content, then submit it with the current revision:

```sh
npx --yes @ruvnet/sparc@1.0.0 submit \
  --root .sparc \
  --run-id health-change \
  --phase Specification \
  --file specification.json \
  --expected-revision CURRENT_REVISION \
  --idempotency-key specification-v1

npx --yes @ruvnet/sparc@1.0.0 gate --root .sparc --run-id health-change
```

A failed gate returns stable blockers and does not advance the run. Correct the artifact, submit a new immutable version with a new idempotency key, and validate again. When the gate passes:

```sh
npx --yes @ruvnet/sparc@1.0.0 advance \
  --root .sparc \
  --run-id health-change \
  --expected-revision CURRENT_REVISION \
  --idempotency-key enter-pseudocode
```

Repeat with `templates/pseudocode.json` and `templates/architecture.json`. Each artifact has phase-specific structure; a generic document is not enough.

## 4. Record independently verified evidence

The test runner or reviewer lives outside SPARC. It produces a bounded result, reads a fresh run snapshot, and signs the exact bytes returned by `evidenceAttestationBytes`. The signing subject includes:

* the fresh `genesisDigest` and `requirementsDigest`;
* authenticated principal, run ID, current phase, and pre-mutation revision;
* evidence, requirement, and optional test identifiers;
* status, summary, details, optional exception authorization, key ID, issue time, and Ed25519 algorithm.

Configure only verifier public keys in the SPARC process. Keep private keys in the independent verifier. Follow the complete program in [EVIDENCE_ATTESTATION.md](./EVIDENCE_ATTESTATION.md), then record the signed evidence:

```sh
npx --yes @ruvnet/sparc@1.0.0 evidence \
  --root .sparc \
  --run-id health-change \
  --file evidence.json \
  --expected-revision CURRENT_REVISION \
  --idempotency-key test-1-pass-v1
```

If another writer wins the revision race, reread the run and obtain a new revision-bound signature. Never edit or invent an attestation.

## 5. Cite immutable proof

The evidence result includes an immutable `{ evidenceId, version, digest }` reference. Copy the exact triple into the matching Refinement increment. Cover every acceptance test registered for each in-scope requirement. Gate and advance Refinement only after all required proof is present.

In Completion, use the same immutable references in the final requirement trace, document observability, rollback, residual risk, and compatibility or migration, then validate and finalize the phase.

## 6. Audit the result

```sh
npx --yes @ruvnet/sparc@1.0.0 status --root .sparc --run-id health-change
npx --yes @ruvnet/sparc@1.0.0 trace --root .sparc --run-id health-change --limit 10
```

`status` is deliberately bounded. Follow `trace` and phase-page `nextCursor` values until absent. Cursors belong to one revision and digest; restart the traversal if a mutation makes one stale.

## 7. Use a host integration

The Claude and Codex plugin contains the same pinned stdio server plus three skills. A standalone `skills install` command copies guidance only, reports the exact MCP prerequisite, and leaves host configuration untouched. Explicitly install the plugin or register the pinned MCP server before invoking a local skill.

ChatGPT requires the Streamable HTTP transport deployed behind HTTPS with a real OAuth issuer, JWKS, scopes, RFC 9728 discovery, and live registration. Local success is not evidence that the hosted integration is ready; complete the external matrix in [VALIDATION.md](./VALIDATION.md).
