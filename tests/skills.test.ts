import { access, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { installSkills, SPARC_MCP_PREREQUISITE } from '../src/skills.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'sparc-skills-'));
  roots.push(value);
  return value;
}

describe('npx skill installation', () => {
  it('installs all skills for both hosts with stable digests', async () => {
    const targetRoot = await root();
    const result = await installSkills({ host: 'both', targetRoot });
    expect(result).toHaveLength(6);
    expect(new Set(result.map((item) => item.digest)).size).toBe(3);
    expect(await readFile(join(targetRoot, '.claude/skills/sparc/SKILL.md'), 'utf8')).toContain('name: sparc');
    expect(await readFile(join(targetRoot, '.agents/skills/sparc/SKILL.md'), 'utf8')).toContain('name: sparc');
    expect(await readFile(join(targetRoot, '.agents/skills/sparc/SKILL.md'), 'utf8'))
      .toContain('npx --yes @ruvnet/sparc@1.0.0 mcp stdio');
    expect(SPARC_MCP_PREREQUISITE).toEqual({
      serverName: 'sparc',
      command: 'npx',
      args: ['--yes', '@ruvnet/sparc@1.0.0', 'mcp', 'stdio'],
      configurationModified: false,
      requiredAction: expect.stringContaining('explicitly register'),
    });
  });

  it('does not overwrite a skill without explicit force', async () => {
    const targetRoot = await root();
    await installSkills({ host: 'codex', targetRoot });
    await expect(installSkills({ host: 'codex', targetRoot })).rejects.toThrow(/--force/);
    await expect(installSkills({ host: 'codex', targetRoot, force: true })).resolves.toHaveLength(3);
  });

  it('preflights every destination before installing either host', async () => {
    const targetRoot = await root();
    await installSkills({ host: 'codex', targetRoot });
    await expect(installSkills({ host: 'both', targetRoot })).rejects.toThrow(/--force/);
    await expect(readFile(join(targetRoot, '.claude/skills/sparc/SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(targetRoot, '.claude'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a symbolic link in the destination path', async () => {
    const targetRoot = await root();
    const outside = await root();
    await symlink(outside, join(targetRoot, '.agents'));
    await expect(installSkills({ host: 'codex', targetRoot })).rejects.toThrow(/symbolic link/);
  });

  it('rejects a symbolic link used as the target root without writing through it', async () => {
    const parent = await root();
    const outside = await root();
    const linkedTarget = join(parent, 'linked-target');
    await symlink(outside, linkedTarget, 'dir');

    await expect(installSkills({ host: 'codex', targetRoot: linkedTarget })).rejects.toThrow(/symbolic link/);
    await expect(access(join(outside, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a symbolic-link ancestor before creating a missing target', async () => {
    const parent = await root();
    const outside = await root();
    const linkedAncestor = join(parent, 'linked-ancestor');
    await symlink(outside, linkedAncestor, 'dir');

    await expect(installSkills({ host: 'claude', targetRoot: join(linkedAncestor, 'project') }))
      .rejects.toThrow(/symbolic link/);
    await expect(access(join(outside, 'project'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not silently create or change project MCP configuration', async () => {
    const targetRoot = await root();
    const existingConfig = '{"mcpServers":{"existing":{"command":"safe"}}}\n';
    await writeFile(join(targetRoot, '.mcp.json'), existingConfig);

    await installSkills({ host: 'both', targetRoot });

    expect(await readFile(join(targetRoot, '.mcp.json'), 'utf8')).toBe(existingConfig);
    await expect(access(join(targetRoot, '.openai.mcp.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
