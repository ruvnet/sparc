# Ed25519 evidence attestation

SPARC treats `pass` and `exception` evidence as usable only after an Ed25519 verifier signs the exact evidence subject. The subject is bound to both the stable requirements and the unique run creation. A model or MCP caller cannot turn a self-reported result into passing evidence or transplant a valid signature into a recreated run. `fail` evidence may be unsigned; if it includes an attestation, SPARC verifies it.

## Trust boundary

The SPARC process receives public keys only. Configure them as a JSON object whose property is the bounded `keyId` and whose value is an Ed25519 public key in a format accepted by Node.js `createPublicKey`, normally SPKI PEM:

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

When set, the JSON must contain between 1 and 32 keys and must not exceed 512 KiB. Omit the variable when a state root has no usable evidence. The server rejects malformed keys and non-Ed25519 keys at startup. Public keys are not secret, but their configuration is integrity-sensitive. The private key must remain in the independent CI, test, review, or approval boundary that observed the result. Do not place it in `SPARC_EVIDENCE_VERIFIER_KEYS`, a phase artifact, an evidence file, state storage, a plugin manifest, source control, or a model-visible environment.

For local experimentation, create a key pair outside the state and repository roots:

```sh
openssl genpkey -algorithm ED25519 -out verifier-private.pem
chmod 600 verifier-private.pem
openssl pkey -in verifier-private.pem -pubout -out verifier-public.pem
```

Those commands demonstrate key format only. A production verifier should be separately controlled from the SPARC writer.

## Exact signing bytes

Import the exported `evidenceAttestationBytes` helper from `@ruvnet/sparc`. It returns the exact UTF-8 bytes the store verifies. Do not reproduce its canonicalization with `JSON.stringify` or another library.

Two immutable digests are required signing inputs:

- `genesisDigest` identifies this exact run creation. It covers the principal, run ID, title, complete requirement and acceptance-test definitions, and a fresh random 32-byte genesis nonce.
- `requirementsDigest` covers the stable requirement and acceptance-test definitions.

`sparc_run_start` returns both values in `value`. `sparc_run_get` returns both in its bounded `run` summary. The verifier should obtain them through an authenticated response and re-read the summary immediately before signing. They are fields of the signing subject, not fields accepted inside the caller-supplied `attestation` object.

The helper canonicalizes this complete subject:

```json
{
  "schema": "ruvnet.sparc.evidence-attestation/v1",
  "principalId": "local-cli",
  "runId": "change-001",
  "genesisDigest": "64-lowercase-hex-characters-from-sparc-run-get",
  "requirementsDigest": "64-lowercase-hex-characters-from-sparc-run-get",
  "expectedRevision": 10,
  "phase": "Refinement",
  "evidenceId": "EVIDENCE-1",
  "requirementId": "REQ-1",
  "testId": "TEST-1",
  "status": "pass",
  "summary": "TEST-1 passed in the clean validation run",
  "details": {
    "command": "npm test",
    "exitCode": 0,
    "tests": 48
  },
  "authorization": null,
  "attestation": {
    "keyId": "ci-main-2026",
    "issuedAt": "2026-08-27T12:00:00.000Z",
    "algorithm": "Ed25519"
  }
}
```

Absent `testId`, `details`, and `authorization` are represented as canonical `null` values by the helper. An authorization, when present, is bound as `{ authorizedBy, reason, reference }`, with an absent `reference` represented as `null`. The signature does not cover itself.

The following minimal Node.js program signs one evidence record. Run it only inside the verifier boundary. `SPARC_EVIDENCE_PRIVATE_KEY_FILE`, `SPARC_RUN_GENESIS_DIGEST`, and `SPARC_REQUIREMENTS_DIGEST` are example inputs for this verifier script and are not read by the SPARC server. Set the two digests, `principalId`, `runId`, `expectedRevision`, and `phase` from a fresh authorized `sparc_run_get` immediately before signing; every field must exactly match the subsequent mutation.

```js
// sign-evidence.mjs
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { evidenceAttestationBytes } from '@ruvnet/sparc';

const privateKeyFile = process.env.SPARC_EVIDENCE_PRIVATE_KEY_FILE;
if (!privateKeyFile) throw new Error('SPARC_EVIDENCE_PRIVATE_KEY_FILE is required');

function requiredDigest(name) {
  const value = process.env[name];
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be the 64-character digest returned by SPARC`);
  }
  return value;
}

function requiredValue(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const genesisDigest = requiredDigest('SPARC_RUN_GENESIS_DIGEST');
const requirementsDigest = requiredDigest('SPARC_REQUIREMENTS_DIGEST');
const principalId = requiredValue('SPARC_EVIDENCE_PRINCIPAL_ID');
const runId = requiredValue('SPARC_EVIDENCE_RUN_ID');
const phase = requiredValue('SPARC_EVIDENCE_PHASE');
if (!['Specification', 'Pseudocode', 'Architecture', 'Refinement', 'Completion'].includes(phase)) {
  throw new Error('SPARC_EVIDENCE_PHASE must be a canonical SPARC phase');
}
const expectedRevisionText = requiredValue('SPARC_EVIDENCE_EXPECTED_REVISION');
if (!/^(?:0|[1-9][0-9]*)$/.test(expectedRevisionText)) {
  throw new Error('SPARC_EVIDENCE_EXPECTED_REVISION must be a non-negative integer');
}
const expectedRevision = Number(expectedRevisionText);
if (!Number.isSafeInteger(expectedRevision)) {
  throw new Error('SPARC_EVIDENCE_EXPECTED_REVISION exceeds the safe integer range');
}

const evidence = {
  evidenceId: 'EVIDENCE-1',
  requirementId: 'REQ-1',
  testId: 'TEST-1',
  status: 'pass',
  summary: 'TEST-1 passed in the clean validation run',
  details: { command: 'npm test', exitCode: 0, tests: 48 },
};
const attestation = {
  keyId: 'ci-main-2026',
  issuedAt: new Date().toISOString(),
  algorithm: 'Ed25519',
};
const subject = {
  principalId,
  runId,
  genesisDigest,
  requirementsDigest,
  expectedRevision,
  phase,
  ...evidence,
  attestation,
};
const privateKey = createPrivateKey(readFileSync(privateKeyFile, 'utf8'));
const signature = sign(null, evidenceAttestationBytes(subject), privateKey)
  .toString('base64url');

process.stdout.write(`${JSON.stringify({
  ...evidence,
  attestation: { ...attestation, signature },
}, null, 2)}\n`);
```

Replace both digest placeholders with the exact values returned by the same run's `sparc_run_get`, then run the signer and submit its output without changing any signed field:

```sh
export SPARC_EVIDENCE_PRIVATE_KEY_FILE=/secure/verifier-private.pem
export SPARC_EVIDENCE_PRINCIPAL_ID=local-cli
export SPARC_EVIDENCE_RUN_ID=change-001
export SPARC_EVIDENCE_EXPECTED_REVISION=10
export SPARC_EVIDENCE_PHASE=Refinement
export SPARC_RUN_GENESIS_DIGEST=GENESIS_DIGEST_FROM_SPARC_RUN_GET
export SPARC_REQUIREMENTS_DIGEST=REQUIREMENTS_DIGEST_FROM_SPARC_RUN_GET
node sign-evidence.mjs > evidence.json

npx --yes @ruvnet/sparc@1.0.0 evidence \
  --run-id change-001 \
  --file evidence.json \
  --expected-revision 10 \
  --idempotency-key record-evidence-1-v1
```

The evidence file has exactly this input shape, with `signature` replaced by the program's unpadded base64url encoding of the 64-byte Ed25519 signature:

```json
{
  "evidenceId": "EVIDENCE-1",
  "requirementId": "REQ-1",
  "testId": "TEST-1",
  "status": "pass",
  "summary": "TEST-1 passed in the clean validation run",
  "details": {
    "command": "npm test",
    "exitCode": 0,
    "tests": 48
  },
  "attestation": {
    "keyId": "ci-main-2026",
    "issuedAt": "2026-08-27T12:00:00.000Z",
    "algorithm": "Ed25519",
    "signature": "BASE64URL_SIGNATURE_FROM_SIGN_EVIDENCE_MJS"
  }
}
```

Do not add `genesisDigest` or `requirementsDigest` to this evidence-file `attestation` object; strict MCP input validation rejects unknown attestation fields. The server takes the current trusted digests from run state, reconstructs the signing subject, and verifies the signature. After acceptance, the returned and persisted `value.attestation` carries both digests with the revision and verification result:

```json
{
  "keyId": "ci-main-2026",
  "issuedAt": "2026-08-27T12:00:00.000Z",
  "algorithm": "Ed25519",
  "signature": "BASE64URL_SIGNATURE_FROM_SIGN_EVIDENCE_MJS",
  "expectedRevision": 10,
  "genesisDigest": "64-lowercase-hex-characters-from-sparc-run-get",
  "requirementsDigest": "64-lowercase-hex-characters-from-sparc-run-get",
  "payloadDigest": "64-lowercase-hex-characters",
  "verified": true
}
```

For `exception`, also include the configured approver authorization in both `evidence` and the signed subject:

```json
{
  "authorization": {
    "authorizedBy": "release-approver",
    "reason": "Documented bounded exception",
    "reference": "CHANGE-1234"
  }
}
```

`authorizedBy` must be present in `SPARC_EXCEPTION_APPROVERS` and must equal the authenticated principal performing the write. The signer binds the authorization, and the server independently prevents the writer from naming some other approver.

## Revision, replay, and citations

The signature binds `genesisDigest`, `requirementsDigest`, the pre-mutation `expectedRevision`, and current phase. If another mutation wins first, read the run again, re-evaluate the result in the new snapshot, and produce a new signature. Do not reuse an old signature with a changed revision, digest, or payload. An uncertain retry may reuse its idempotency key only when every request field and the revision are identical.

## Run recreation and prerelease state

Every successful run creation generates a fresh random nonce and derives a new `genesisDigest`. Deleting and recreating a run with the same principal, run ID, title, requirements, and acceptance tests therefore produces the same `requirementsDigest` but a different `genesisDigest`. A signature from the earlier creation fails against the recreated run. Changing the definitions also changes `requirementsDigest`. These bindings prevent signature transplant across both identical and changed recreations.

The random nonce remains internal; callers use only the returned digest. State load recomputes the genesis identity and rechecks every stored evidence attestation against the run's `genesisDigest` and `requirementsDigest`.

Prerelease schema-version-1 state created before genesis identity was introduced has neither a valid nonce nor `genesisDigest`. SPARC fails closed and reports that state as tampered instead of synthesizing an identity or accepting its earlier evidence. SPARC 1.0 does not provide an automatic pre-genesis migration; any recovery requires an explicit owner-controlled migration and new validation evidence.

After acceptance, copy the exact immutable reference returned by SPARC into Refinement and Completion artifacts:

```json
{
  "evidenceId": "EVIDENCE-1",
  "version": 1,
  "digest": "64-lowercase-hex-characters"
}
```

In the generic `{ id, version, digest }` citation pattern, the evidence schema names the ID field `evidenceId`. A bare evidence ID or a reference to a later version is not equivalent. Each `evidenceId` remains bound to its original requirement and optional test across versions.

## Key rotation and limits

Use a new `keyId` when rotating a verifier. Add the new public key before producing evidence with it. Retain old public keys for as long as persisted runs contain evidence signed by those keys; state verification rechecks historical signatures on load, so removing an old key makes those runs unreadable through the verified store. SPARC 1.0 has no in-place re-sign or verifier-key migration operation. Preserve the historical public-key configuration with any archived run.

An Ed25519 signature proves that the configured key signed the exact subject. It does not prove that a test ran, that the signer is independent, or that the underlying result is true. `issuedAt` is canonical, integrity-bound metadata; SPARC 1.0 does not apply a maximum clock skew or signature expiry policy. Operational controls around freshness, the private key, and the verifier are part of the acceptance boundary.
