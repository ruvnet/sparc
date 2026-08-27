import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPARC_SKILLS = ['sparc', 'sparc-review', 'sparc-resume'] as const;
export const SPARC_MCP_PREREQUISITE = Object.freeze({
  serverName: 'sparc',
  command: 'npx',
  args: Object.freeze(['--yes', '@ruvnet/sparc@1.0.0', 'mcp', 'stdio'] as const),
  configurationModified: false,
  requiredAction: 'Install the SPARC plugin or explicitly register this exact MCP launcher before invoking an installed skill.',
});
export type SkillHost = 'claude' | 'codex' | 'both';

export interface InstallSkillsOptions {
  readonly host: SkillHost;
  readonly targetRoot: string;
  readonly force?: boolean;
}

export interface InstalledSkill {
  readonly host: Exclude<SkillHost, 'both'>;
  readonly name: (typeof SPARC_SKILLS)[number];
  readonly path: string;
  readonly digest: string;
}

function packageSkillsRoot(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url));
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

async function assertNoSymlinkPath(root: string, candidate: string): Promise<void> {
  if (!isContained(root, candidate)) throw new Error(`skill destination escapes target root: ${candidate}`);
  let current = candidate;
  while (isContained(root, current) && current !== root) {
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`skill destination contains a symbolic link: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    current = dirname(current);
  }
}

async function digestDirectory(path: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = join(directory, entry.name);
      const rel = relative(path, full).split(sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`packaged skill contains a symbolic link: ${rel}`);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        hash.update(rel);
        hash.update('\0');
        hash.update(await readFile(full));
        hash.update('\0');
      }
    }
  }
  await walk(path);
  return `sha256:${hash.digest('hex')}`;
}

function hostDirectory(host: Exclude<SkillHost, 'both'>): string {
  return host === 'claude' ? join('.claude', 'skills') : join('.agents', 'skills');
}

interface SkillPlan {
  readonly host: Exclude<SkillHost, 'both'>;
  readonly name: (typeof SPARC_SKILLS)[number];
  readonly source: string;
  readonly sourceDigest: string;
  readonly base: string;
  readonly destination: string;
  readonly temporary: string;
  readonly backup: string;
  readonly existed: boolean;
  readonly existingDevice?: number;
  readonly existingInode?: number;
}

interface DirectoryIdentity {
  readonly path: string;
  readonly realPath: string;
  readonly device: number;
  readonly inode: number;
}

async function pathStatus(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function assertNoSymlinkSegments(candidate: string): Promise<void> {
  const absolute = resolve(candidate);
  const filesystemRoot = parse(absolute).root;
  let cursor = filesystemRoot;
  for (const segment of relative(filesystemRoot, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    const status = await pathStatus(cursor);
    if (status?.isSymbolicLink()) {
      throw new Error(`skill target path contains a symbolic link: ${cursor}`);
    }
    if (status && !status.isDirectory()) {
      throw new Error(`skill target path contains a non-directory: ${cursor}`);
    }
  }
}

async function captureDirectoryIdentity(path: string, label: string): Promise<DirectoryIdentity> {
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory: ${path}`);
  }
  return {
    path,
    realPath: await realpath(path),
    device: status.dev,
    inode: status.ino,
  };
}

async function assertDirectoryIdentity(identity: DirectoryIdentity, label: string): Promise<void> {
  const status = await lstat(identity.path);
  if (
    !status.isDirectory()
    || status.isSymbolicLink()
    || status.dev !== identity.device
    || status.ino !== identity.inode
    || await realpath(identity.path) !== identity.realPath
  ) {
    throw new Error(`${label} changed during installation: ${identity.path}`);
  }
}

async function prepareTargetRoot(requestedRoot: string): Promise<DirectoryIdentity> {
  await assertNoSymlinkSegments(requestedRoot);

  let existingAncestor = requestedRoot;
  while (!await pathStatus(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error(`cannot resolve skill target root: ${requestedRoot}`);
    existingAncestor = parent;
  }
  const ancestorIdentity = await captureDirectoryIdentity(existingAncestor, 'skill target ancestor');

  await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  await assertNoSymlinkSegments(requestedRoot);
  await assertDirectoryIdentity(ancestorIdentity, 'skill target ancestor');
  return captureDirectoryIdentity(requestedRoot, 'skill target root');
}

async function planOne(
  root: string,
  host: Exclude<SkillHost, 'both'>,
  name: (typeof SPARC_SKILLS)[number],
  force: boolean,
): Promise<SkillPlan> {
  const source = join(packageSkillsRoot(), name);
  const sourceStatus = await lstat(source);
  if (!sourceStatus.isDirectory() || sourceStatus.isSymbolicLink()) {
    throw new Error(`packaged skill is not a real directory: ${name}`);
  }
  const sourceDigest = await digestDirectory(source);
  const base = resolve(root, hostDirectory(host));
  const destination = resolve(base, name);
  await assertNoSymlinkPath(root, base);
  await assertNoSymlinkPath(root, destination);

  let exists = false;
  let existingDevice: number | undefined;
  let existingInode: number | undefined;
  try {
    const status = await lstat(destination);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error(`skill destination is not a real directory: ${destination}`);
    }
    exists = true;
    existingDevice = status.dev;
    existingInode = status.ino;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (exists && !force) {
    throw new Error(`skill already exists: ${destination}; pass --force to replace this SPARC skill`);
  }

  return {
    host,
    name,
    source,
    sourceDigest,
    base,
    destination,
    temporary: join(base, `.${name}.${randomUUID()}.tmp`),
    backup: join(base, `.${name}.${randomUUID()}.bak`),
    existed: exists,
    ...(existingDevice === undefined ? {} : { existingDevice }),
    ...(existingInode === undefined ? {} : { existingInode }),
  };
}

async function assertDestinationUnchanged(root: string, plan: SkillPlan): Promise<void> {
  await assertNoSymlinkPath(root, plan.base);
  await assertNoSymlinkPath(root, plan.destination);
  try {
    const status = await lstat(plan.destination);
    if (
      !plan.existed ||
      !status.isDirectory() ||
      status.isSymbolicLink() ||
      status.dev !== plan.existingDevice ||
      status.ino !== plan.existingInode
    ) {
      throw new Error(`skill destination changed during installation: ${plan.destination}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !plan.existed) return;
    throw error;
  }
}

/** Install packaged skills with full preflight, verified staging, and rollback on observed failures. */
export async function installSkills(options: InstallSkillsOptions): Promise<readonly InstalledSkill[]> {
  if (!['claude', 'codex', 'both'].includes(options.host)) throw new Error(`unsupported skill host: ${options.host}`);
  const requestedRoot = resolve(options.targetRoot);
  const rootIdentity = await prepareTargetRoot(requestedRoot);
  const root = rootIdentity.realPath;
  const hosts: Array<Exclude<SkillHost, 'both'>> = options.host === 'both' ? ['claude', 'codex'] : [options.host];
  const plans: SkillPlan[] = [];
  for (const host of hosts) {
    for (const name of SPARC_SKILLS) {
      plans.push(await planOne(root, host, name, options.force === true));
    }
  }

  const baseIdentities = new Map<string, DirectoryIdentity>();
  for (const base of new Set(plans.map((plan) => plan.base))) {
    await assertDirectoryIdentity(rootIdentity, 'skill target root');
    await mkdir(base, { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(root, base);
    baseIdentities.set(base, await captureDirectoryIdentity(base, 'skill host destination'));
  }

  const stagedIdentities = new Map<string, DirectoryIdentity>();
  try {
    for (const plan of plans) {
      await assertDirectoryIdentity(rootIdentity, 'skill target root');
      await assertDirectoryIdentity(baseIdentities.get(plan.base)!, 'skill host destination');
      await assertNoSymlinkPath(root, plan.base);
      await cp(plan.source, plan.temporary, { recursive: true, errorOnExist: true, force: false });
      const stagedIdentity = await captureDirectoryIdentity(plan.temporary, 'staged skill');
      if (await digestDirectory(plan.temporary) !== plan.sourceDigest) {
        throw new Error(`staged skill digest mismatch: ${plan.name}`);
      }
      stagedIdentities.set(plan.temporary, stagedIdentity);
    }
  } catch (error) {
    await Promise.all(plans.map((plan) => rm(plan.temporary, { recursive: true, force: true })));
    throw error;
  }

  const committed: SkillPlan[] = [];
  const backedUp: SkillPlan[] = [];
  try {
    for (const plan of plans) {
      await assertDirectoryIdentity(rootIdentity, 'skill target root');
      await assertDirectoryIdentity(baseIdentities.get(plan.base)!, 'skill host destination');
      await assertDirectoryIdentity(stagedIdentities.get(plan.temporary)!, 'staged skill');
      if (await digestDirectory(plan.temporary) !== plan.sourceDigest) {
        throw new Error(`staged skill changed before commit: ${plan.name}`);
      }
      await assertDestinationUnchanged(root, plan);
      if (plan.existed) {
        await rename(plan.destination, plan.backup);
        backedUp.push(plan);
      }
      await rename(plan.temporary, plan.destination);
      committed.push(plan);
      const installedIdentity = await captureDirectoryIdentity(plan.destination, 'installed skill');
      const stagedIdentity = stagedIdentities.get(plan.temporary)!;
      if (installedIdentity.device !== stagedIdentity.device || installedIdentity.inode !== stagedIdentity.inode) {
        throw new Error(`installed skill identity mismatch: ${plan.destination}`);
      }
      if (await digestDirectory(plan.destination) !== plan.sourceDigest) {
        throw new Error(`installed skill digest mismatch: ${plan.name}`);
      }
    }
  } catch (error) {
    for (const plan of [...committed].reverse()) {
      await rm(plan.destination, { recursive: true, force: true });
      if (plan.existed) await rename(plan.backup, plan.destination);
    }
    for (const plan of [...backedUp].reverse()) {
      if (!committed.includes(plan)) await rename(plan.backup, plan.destination);
    }
    await Promise.all(plans.map((plan) => rm(plan.temporary, { recursive: true, force: true })));
    throw error;
  }

  await Promise.all(backedUp.map((plan) => rm(plan.backup, { recursive: true, force: true })));
  return plans.map((plan) => ({
    host: plan.host,
    name: plan.name,
    path: plan.destination,
    digest: plan.sourceDigest,
  }));
}
