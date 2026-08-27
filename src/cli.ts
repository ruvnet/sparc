#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import type {
  AcceptanceTest,
  AppendCorrectionInput,
  AppendEvidenceInput,
  JsonValue,
  Requirement,
  SparcPhase,
} from './domain.js';
import { isSparcPhase, SPARC_RUN_LIST_LIMITS, SparcError } from './domain.js';
import { evaluateHarnessPromotion, validateSparcHarness, type PromotionEvidence } from './metaharness.js';
import { authConfigFromEnvironment } from './mcp/auth.js';
import { startSparcMcpHttpServer } from './mcp/http.js';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  paginateSparcTrace,
  summarizeSparcRun,
} from './mcp/server.js';
import { startSparcStdioServer } from './mcp/stdio.js';
import { packageChatGptPlugin } from './plugin-package.js';
import { installSkills, SPARC_MCP_PREREQUISITE, SPARC_SKILLS, type SkillHost } from './skills.js';
import { SparcStore } from './store.js';

const VERSION = '1.0.0';
const MAX_INPUT_FILE_BYTES = 512 * 1024;

type JsonObject = Record<string, unknown>;
type CliValues = Record<string, string | boolean | string[] | undefined>;
type CliOptionConfig = NonNullable<ParseArgsConfig['options']>;

export interface CliIo {
  readonly stdout: Pick<NodeJS.WriteStream, 'write'>;
  readonly stderr: Pick<NodeJS.WriteStream, 'write'>;
}

const defaultIo: CliIo = { stdout: process.stdout, stderr: process.stderr };

const HELP = `SPARC ${VERSION}

Usage:
  sparc init [--root PATH]
  sparc start --run-id ID --title TEXT --definition FILE [mutation options]
  sparc list [--cursor CURSOR] [--limit N] [common options]
  sparc status --run-id ID [common options]
  sparc submit --run-id ID --phase PHASE --file FILE [mutation options]
  sparc evidence --run-id ID --file FILE [mutation options]
  sparc correct --run-id ID --file FILE [mutation options]
  sparc gate --run-id ID [--phase PHASE] [common options]
  sparc advance --run-id ID [mutation options]
  sparc trace --run-id ID [--cursor CURSOR] [--limit N] [common options]
  sparc skills list
  sparc skills install --host claude|codex|both [--target PATH] [--force]
  sparc plugin chatgpt package --app-id ID [--target PATH] [--force]
  sparc promote --file FILE
  sparc doctor [common options]
  sparc mcp stdio [common options]
  sparc mcp http [--host 127.0.0.1] [--port 8787] [common options]
  sparc version

Common options:
  --root PATH           State directory, default SPARC_STATE_ROOT or .sparc
  --principal ID        Local principal, default SPARC_PRINCIPAL or local-cli

Mutation options:
  --expected-revision N Current revision, required except start
  --idempotency-key KEY Stable key bound to the exact request

The CLI never executes artifact text, evidence commands, or repository operations.
`;

const commonOptions: CliOptionConfig = {
  root: { type: 'string' },
  principal: { type: 'string' },
};

const mutationOptions: CliOptionConfig = {
  ...commonOptions,
  'expected-revision': { type: 'string' },
  'idempotency-key': { type: 'string' },
};

function parsed(args: readonly string[], options: CliOptionConfig): CliValues {
  return parseArgs({ args: [...args], options, strict: true, allowPositionals: false }).values as CliValues;
}

function required(values: CliValues, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`--${name} is required`);
  return value;
}

function optionalString(values: CliValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nonnegativeInteger(value: string, name: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`--${name} must be a non-negative integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`--${name} exceeds the safe integer range`);
  return number;
}

function positiveInteger(value: string, name: string, maximum: number): number {
  const number = nonnegativeInteger(value, name);
  if (number < 1 || number > maximum) throw new Error(`--${name} must be between 1 and ${maximum}`);
  return number;
}

function stateRoot(values: CliValues): string {
  return resolve(optionalString(values, 'root') ?? process.env.SPARC_STATE_ROOT ?? '.sparc');
}

function principal(values: CliValues): string {
  return optionalString(values, 'principal') ?? process.env.SPARC_PRINCIPAL ?? 'local-cli';
}

function evidenceVerifierKeysFromEnvironment(): Record<string, string> | undefined {
  const raw = process.env.SPARC_EVIDENCE_VERIFIER_KEYS;
  if (!raw) return undefined;
  if (Buffer.byteLength(raw, 'utf8') > 512 * 1024) {
    throw new Error('SPARC_EVIDENCE_VERIFIER_KEYS exceeds 524288 bytes');
  }
  const value = asObject(JSON.parse(raw) as unknown, 'SPARC_EVIDENCE_VERIFIER_KEYS');
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 32) {
    throw new Error('SPARC_EVIDENCE_VERIFIER_KEYS must contain between 1 and 32 keys');
  }
  const keys: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [keyId, encodedKey] of entries) {
    if (typeof encodedKey !== 'string') {
      throw new Error(`SPARC_EVIDENCE_VERIFIER_KEYS.${keyId} must be a public-key string`);
    }
    keys[keyId] = encodedKey;
  }
  return keys;
}

function store(values: CliValues): SparcStore {
  const exceptionApprovers = (process.env.SPARC_EXCEPTION_APPROVERS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const evidenceVerifierKeys = evidenceVerifierKeysFromEnvironment();
  return new SparcStore({
    stateRoot: stateRoot(values),
    ...(exceptionApprovers.length > 0 ? { exceptionApprovers } : {}),
    ...(evidenceVerifierKeys ? { evidenceVerifierKeys } : {}),
  });
}

function mutation(values: CliValues) {
  return {
    principalId: principal(values),
    runId: required(values, 'run-id'),
    expectedRevision: nonnegativeInteger(required(values, 'expected-revision'), 'expected-revision'),
    idempotencyKey: required(values, 'idempotency-key'),
  };
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value as JsonObject;
}

async function readJsonFile(path: string): Promise<unknown> {
  const full = resolve(path);
  const descriptor = await open(full, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const status = await descriptor.stat();
    if (!status.isFile()) throw new Error(`input is not a regular file: ${full}`);
    if (status.size > MAX_INPUT_FILE_BYTES) throw new Error(`input exceeds ${MAX_INPUT_FILE_BYTES} bytes: ${full}`);
    return JSON.parse(await descriptor.readFile({ encoding: 'utf8' })) as unknown;
  } finally {
    await descriptor.close();
  }
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolveShutdown) => {
    let handled = false;
    const stop = (): void => {
      if (handled) return;
      handled = true;
      void close().finally(resolveShutdown);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function runStateCommand(command: string, args: readonly string[], io: CliIo): Promise<number> {
  if (command === 'init') {
    const values = parsed(args, commonOptions);
    const initialized = store(values);
    writeJson(io, { ok: true, stateRoot: initialized.stateRoot, schemaVersion: 1 });
    return 0;
  }

  if (command === 'start') {
    const values = parsed(args, {
      ...commonOptions,
      'run-id': { type: 'string' },
      title: { type: 'string' },
      definition: { type: 'string' },
      'idempotency-key': { type: 'string' },
    });
    const definition = asObject(await readJsonFile(required(values, 'definition')), 'definition');
    writeJson(io, store(values).createRun({
      principalId: principal(values),
      runId: required(values, 'run-id'),
      title: required(values, 'title'),
      requirements: definition.requirements as readonly Requirement[],
      acceptanceTests: definition.acceptanceTests as readonly AcceptanceTest[],
      expectedRevision: 0,
      idempotencyKey: required(values, 'idempotency-key'),
    }));
    return 0;
  }

  if (command === 'list') {
    const values = parsed(args, {
      ...commonOptions,
      cursor: { type: 'string' },
      limit: { type: 'string' },
    });
    const result = store(values).listRuns({
      principalId: principal(values),
      ...(optionalString(values, 'cursor') ? { cursor: optionalString(values, 'cursor')! } : {}),
      ...(optionalString(values, 'limit') ? {
        limit: positiveInteger(required(values, 'limit'), 'limit', SPARC_RUN_LIST_LIMITS.maximum),
      } : {}),
    });
    writeJson(io, { ok: true, ...result });
    return 0;
  }

  if (command === 'status') {
    const values = parsed(args, { ...commonOptions, 'run-id': { type: 'string' } });
    const activeStore = store(values);
    const locator = { principalId: principal(values), runId: required(values, 'run-id') };
    writeJson(io, {
      ok: true,
      run: summarizeSparcRun(activeStore.getRun(locator)),
      verification: activeStore.verify(locator),
    });
    return 0;
  }

  if (command === 'submit') {
    const values = parsed(args, {
      ...mutationOptions,
      'run-id': { type: 'string' },
      phase: { type: 'string' },
      file: { type: 'string' },
      'artifact-id': { type: 'string' },
    });
    const requestedPhase = required(values, 'phase');
    if (!isSparcPhase(requestedPhase)) throw new Error('--phase must be a canonical SPARC phase');
    const activeStore = store(values);
    const context = mutation(values);
    const content = await readJsonFile(required(values, 'file')) as JsonValue;
    writeJson(io, activeStore.putArtifact({
      ...context,
      phase: requestedPhase,
      ...(optionalString(values, 'artifact-id') ? { artifactId: optionalString(values, 'artifact-id')! } : {}),
      content,
    }));
    return 0;
  }

  if (command === 'evidence') {
    const values = parsed(args, { ...mutationOptions, 'run-id': { type: 'string' }, file: { type: 'string' } });
    const body = asObject(await readJsonFile(required(values, 'file')), 'evidence');
    writeJson(io, store(values).appendEvidence({
      ...mutation(values),
      evidenceId: body.evidenceId as string,
      requirementId: body.requirementId as string,
      ...(body.testId === undefined ? {} : { testId: body.testId as string }),
      status: body.status as AppendEvidenceInput['status'],
      summary: body.summary as string,
      ...(body.details === undefined ? {} : { details: body.details as JsonValue }),
      ...(body.authorization === undefined ? {} : {
        authorization: body.authorization as NonNullable<AppendEvidenceInput['authorization']>,
      }),
      ...(body.attestation === undefined ? {} : {
        attestation: body.attestation as NonNullable<AppendEvidenceInput['attestation']>,
      }),
    }));
    return 0;
  }

  if (command === 'correct') {
    const values = parsed(args, { ...mutationOptions, 'run-id': { type: 'string' }, file: { type: 'string' } });
    const body = asObject(await readJsonFile(required(values, 'file')), 'correction');
    writeJson(io, store(values).appendCorrection({
      ...mutation(values),
      correctionId: body.correctionId as string,
      target: body.target as AppendCorrectionInput['target'],
      reason: body.reason as string,
      ...(body.replacement === undefined ? {} : { replacement: body.replacement as JsonValue }),
    }));
    return 0;
  }

  if (command === 'gate') {
    const values = parsed(args, { ...commonOptions, 'run-id': { type: 'string' }, phase: { type: 'string' } });
    const requestedPhase = optionalString(values, 'phase');
    if (requestedPhase !== undefined && !isSparcPhase(requestedPhase)) {
      throw new Error('--phase must be a canonical SPARC phase');
    }
    const gate = store(values).evaluateGate({
      principalId: principal(values),
      runId: required(values, 'run-id'),
      ...(requestedPhase ? { phase: requestedPhase as SparcPhase } : {}),
    });
    writeJson(io, { ok: gate.ok, gate });
    return gate.ok ? 0 : 2;
  }

  if (command === 'advance') {
    const values = parsed(args, { ...mutationOptions, 'run-id': { type: 'string' } });
    const activeStore = store(values);
    const context = mutation(values);
    const current = activeStore.getRun({ principalId: context.principalId, runId: context.runId });
    const result = current.phase === 'Completion'
      ? activeStore.completeRun(context)
      : activeStore.advancePhase(context);
    writeJson(io, result);
    return result.ok ? 0 : 2;
  }

  if (command === 'trace') {
    const values = parsed(args, {
      ...commonOptions,
      'run-id': { type: 'string' },
      cursor: { type: 'string' },
      limit: { type: 'string' },
    });
    const activeStore = store(values);
    const locator = { principalId: principal(values), runId: required(values, 'run-id') };
    const run = activeStore.getRun(locator);
    const page = paginateSparcTrace(
      run,
      optionalString(values, 'cursor'),
      optionalString(values, 'limit')
        ? positiveInteger(required(values, 'limit'), 'limit', MAX_PAGE_LIMIT)
        : DEFAULT_PAGE_LIMIT,
    );
    writeJson(io, {
      ok: true,
      runId: run.runId,
      revision: run.revision,
      phase: run.phase,
      status: run.status,
      digest: run.digest,
      verification: activeStore.verify(locator),
      ...page,
    });
    return 0;
  }

  return -1;
}

async function runSkills(args: readonly string[], io: CliIo): Promise<number> {
  const action = args[0];
  if (action === 'list') {
    if (args.length !== 1) throw new Error('skills list accepts no options');
    writeJson(io, { ok: true, skills: SPARC_SKILLS, mcpPrerequisite: SPARC_MCP_PREREQUISITE });
    return 0;
  }
  if (action === 'install') {
    const values = parsed(args.slice(1), {
      host: { type: 'string' },
      target: { type: 'string' },
      force: { type: 'boolean', default: false },
    });
    const host = required(values, 'host');
    if (!['claude', 'codex', 'both'].includes(host)) throw new Error('--host must be claude, codex, or both');
    writeJson(io, {
      ok: true,
      installed: await installSkills({
        host: host as SkillHost,
        targetRoot: resolve(optionalString(values, 'target') ?? '.'),
        force: values.force === true,
      }),
      mcpPrerequisite: SPARC_MCP_PREREQUISITE,
    });
    return 0;
  }
  throw new Error('skills requires list or install');
}

async function runMcp(args: readonly string[], io: CliIo): Promise<number> {
  const transport = args[0];
  if (transport === 'stdio') {
    const values = parsed(args.slice(1), commonOptions);
    const started = await startSparcStdioServer({ store: store(values), principalId: principal(values) });
    await waitForShutdown(started.close);
    return 0;
  }
  if (transport === 'http') {
    const values = parsed(args.slice(1), {
      ...commonOptions,
      host: { type: 'string' },
      port: { type: 'string' },
      'allowed-host': { type: 'string', multiple: true },
    });
    const host = optionalString(values, 'host') ?? '127.0.0.1';
    const port = nonnegativeInteger(optionalString(values, 'port') ?? '8787', 'port');
    const allowed = values['allowed-host'];
    const allowedHosts = Array.isArray(allowed) ? allowed : typeof allowed === 'string' ? [allowed] : undefined;
    const started = await startSparcMcpHttpServer({
      store: store(values),
      auth: authConfigFromEnvironment(),
      host,
      port,
      ...(allowedHosts ? { allowedHosts } : {}),
    });
    io.stderr.write(`SPARC MCP listening at ${started.url.toString()}\n`);
    await waitForShutdown(started.close);
    return 0;
  }
  throw new Error('mcp requires stdio or http');
}

async function runPlugin(args: readonly string[], io: CliIo): Promise<number> {
  if (args[0] !== 'chatgpt' || args[1] !== 'package') {
    throw new Error('plugin requires chatgpt package');
  }
  const values = parsed(args.slice(2), {
    'app-id': { type: 'string' },
    target: { type: 'string' },
    force: { type: 'boolean', default: false },
  });
  writeJson(io, {
    ok: true,
    plugin: await packageChatGptPlugin({
      appId: required(values, 'app-id'),
      targetRoot: resolve(optionalString(values, 'target') ?? 'chatgpt-plugin'),
      force: values.force === true,
    }),
  });
  return 0;
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout.write(HELP);
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const stateResult = await runStateCommand(command, args, io);
  if (stateResult >= 0) return stateResult;
  if (command === 'skills') return runSkills(args, io);
  if (command === 'plugin') return runPlugin(args, io);
  if (command === 'mcp') return runMcp(args, io);
  if (command === 'promote') {
    const values = parsed(args, { file: { type: 'string' } });
    const decision = evaluateHarnessPromotion(
      asObject(await readJsonFile(required(values, 'file')), 'promotion evidence') as unknown as PromotionEvidence,
    );
    writeJson(io, { ok: decision.promote, decision });
    return decision.promote ? 0 : 2;
  }
  if (command === 'doctor') {
    const values = parsed(args, commonOptions);
    const activeStore = store(values);
    writeJson(io, {
      ok: true,
      version: VERSION,
      stateRoot: activeStore.stateRoot,
      metaharness: await validateSparcHarness(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    });
    return 0;
  }
  throw new Error(`unknown command: ${command}`);
}

function safeCliError(error: unknown): Record<string, unknown> {
  if (error instanceof SparcError) return error.toJSON();
  if (error instanceof Error) return { name: error.name, code: 'CLI_ERROR', message: error.message };
  return { name: 'Error', code: 'CLI_ERROR', message: 'unknown CLI failure' };
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}

if (isMainModule()) {
  runCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${JSON.stringify({ ok: false, error: safeCliError(error) })}\n`);
      process.exitCode = 1;
    },
  );
}
