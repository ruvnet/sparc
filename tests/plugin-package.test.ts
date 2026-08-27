import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageChatGptPlugin } from '../src/plugin-package.js';

const roots: string[] = [];
const appId = 'plugin_asdk_app_0123456789abcdef';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sparc-chatgpt-plugin-'));
  roots.push(root);
  return root;
}

describe('ChatGPT plugin packaging', () => {
  it('creates the registered app variant without changing the source plugin', async () => {
    const root = await temporaryRoot();
    const result = await packageChatGptPlugin({ appId, targetRoot: root });
    const app = JSON.parse(await readFile(join(result.path, '.app.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(result.path, '.codex-plugin', 'plugin.json'), 'utf8'));

    expect(app).toEqual({ apps: { sparc: { id: appId } } });
    expect(manifest).toMatchObject({ name: 'sparc', skills: './skills/', apps: './.app.json' });
    expect(manifest).not.toHaveProperty('mcpServers');
    await expect(lstat(join(result.path, '.mcp.json'))).resolves.toMatchObject({});
  });

  it('rejects guessed IDs and refuses replacement without force', async () => {
    const root = await temporaryRoot();
    await expect(packageChatGptPlugin({ appId: 'connector_fake', targetRoot: root }))
      .rejects.toThrow(/identifier returned by ChatGPT/);
    await packageChatGptPlugin({ appId, targetRoot: root });
    await expect(packageChatGptPlugin({ appId, targetRoot: root })).rejects.toThrow(/--force/);
    await expect(packageChatGptPlugin({ appId, targetRoot: root, force: true })).resolves.toMatchObject({ appId });
  });

  it('rejects symbolic links in the target path', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const link = join(root, 'linked');
    await symlink(outside, link, 'dir');
    await expect(packageChatGptPlugin({ appId, targetRoot: link })).rejects.toThrow(/symbolic link/);
  });

  it('does not touch an existing plugin when registration input is invalid', async () => {
    const root = await temporaryRoot();
    await packageChatGptPlugin({ appId, targetRoot: root });
    await writeFile(join(root, 'sparc', 'marker'), 'preserved');
    await expect(packageChatGptPlugin({ appId: 'invalid', targetRoot: root, force: true })).rejects.toThrow();
    await expect(readFile(join(root, 'sparc', 'marker'), 'utf8')).resolves.toBe('preserved');
  });
});
