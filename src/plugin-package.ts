import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHATGPT_APP_ID = /^plugin_asdk_app_[A-Za-z0-9_-]{8,128}$/;

export interface PackageChatGptPluginOptions {
  readonly appId: string;
  readonly targetRoot: string;
  readonly force?: boolean;
}

export interface PackagedChatGptPlugin {
  readonly appId: string;
  readonly path: string;
  readonly pluginName: 'sparc';
}

function packagedPluginRoot(): string {
  return fileURLToPath(new URL('../plugins/sparc/', import.meta.url));
}

async function status(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function assertRealDirectoryPath(candidate: string): Promise<void> {
  const absolute = resolve(candidate);
  const root = parse(absolute).root;
  let cursor = root;
  for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    const item = await status(cursor);
    if (item?.isSymbolicLink()) throw new Error(`plugin target path contains a symbolic link: ${cursor}`);
    if (item && !item.isDirectory()) throw new Error(`plugin target path contains a non-directory: ${cursor}`);
  }
}

async function assertTreeHasNoLinks(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`plugin package contains a symbolic link: ${path}`);
    if (entry.isDirectory()) await assertTreeHasNoLinks(path);
    else if (!entry.isFile()) throw new Error(`plugin package contains a non-regular file: ${path}`);
  }
}

async function writeRegularFile(path: string, contents: string, exclusive: boolean): Promise<void> {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const flags = fsConstants.O_WRONLY | noFollow
    | (exclusive ? fsConstants.O_CREAT | fsConstants.O_EXCL : fsConstants.O_TRUNC);
  const descriptor = await open(path, flags, 0o600);
  try {
    const fileStatus = await descriptor.stat();
    if (!fileStatus.isFile()) throw new Error(`plugin output is not a regular file: ${path}`);
    await descriptor.chmod(0o600);
    await descriptor.writeFile(contents, 'utf8');
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
}

export function validateChatGptAppId(appId: string): void {
  if (!CHATGPT_APP_ID.test(appId)) {
    throw new Error('--app-id must be the exact plugin_asdk_app_... identifier returned by ChatGPT registration');
  }
}

export async function packageChatGptPlugin(
  options: PackageChatGptPluginOptions,
): Promise<PackagedChatGptPlugin> {
  validateChatGptAppId(options.appId);
  const targetRoot = resolve(options.targetRoot);
  await assertRealDirectoryPath(targetRoot);
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const verifiedTargetRoot = await realpath(targetRoot);
  if (verifiedTargetRoot !== targetRoot) {
    throw new Error(`plugin target root resolves to a different path: ${targetRoot}`);
  }

  const source = packagedPluginRoot();
  await assertTreeHasNoLinks(source);
  const destination = join(targetRoot, 'sparc');
  const existing = await status(destination);
  if (existing?.isSymbolicLink()) throw new Error(`plugin destination is a symbolic link: ${destination}`);
  if (existing && !existing.isDirectory()) throw new Error(`plugin destination is not a directory: ${destination}`);
  if (existing && options.force !== true) throw new Error(`plugin destination exists; pass --force to replace it: ${destination}`);

  const nonce = randomUUID();
  const staging = join(targetRoot, `.sparc.staging-${nonce}`);
  const backup = join(targetRoot, `.sparc.backup-${nonce}`);
  let backupCreated = false;
  try {
    await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
    await assertTreeHasNoLinks(staging);
    const manifestPath = join(staging, '.codex-plugin', 'plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.mcpServers;
    manifest.apps = './.app.json';
    await writeRegularFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, false);
    await writeRegularFile(join(staging, '.app.json'), `${JSON.stringify({
      apps: { sparc: { id: options.appId } },
    }, null, 2)}\n`, true);

    if (existing) {
      await rename(destination, backup);
      backupCreated = true;
    }
    await rename(staging, destination);
    if (backupCreated) await rm(backup, { recursive: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (backupCreated) {
      if (await status(destination)) await rm(destination, { recursive: true, force: true });
      await rename(backup, destination);
    }
    throw error;
  }

  return { appId: options.appId, path: destination, pluginName: 'sparc' };
}
