import { cpSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error The production validator is intentionally dependency-free JavaScript.
import { validatePlugins } from '../scripts/validate-plugins.mjs';

const temporaryDirectories: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, '..');

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sparc-plugin-test-'));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'plugins'), { recursive: true });
  cpSync(join(repositoryRoot, 'plugins', 'sparc'), join(root, 'plugins', 'sparc'), { recursive: true });
  cpSync(join(repositoryRoot, 'skills'), join(root, 'skills'), { recursive: true });
  cpSync(join(repositoryRoot, '.claude-plugin'), join(root, '.claude-plugin'), { recursive: true });
  cpSync(join(repositoryRoot, '.agents'), join(root, '.agents'), { recursive: true });
  cpSync(join(repositoryRoot, 'package.json'), join(root, 'package.json'));
  return root;
}

describe('plugin validator', () => {
  it('accepts the repository plugin and its mirrored skills', () => {
    expect(validatePlugins(repositoryRoot)).toEqual([]);
  });

  it('rejects unpinned packages and legacy or fabricated metadata', () => {
    const root = fixture();
    const mcpPath = join(root, 'plugins', 'sparc', '.openai.mcp.json');
    writeFileSync(mcpPath, readFileSync(mcpPath, 'utf8').replace('@1.0.0', '@latest'));
    writeFileSync(join(root, 'plugins', 'sparc', 'skill.toml'), 'name = "legacy"\n');
    writeFileSync(join(root, 'plugins', 'sparc', '.app.json'), '{}\n');

    const failures = validatePlugins(root).join('\n');

    expect(failures).toContain('@latest is forbidden');
    expect(failures).toContain('legacy skill.toml is forbidden');
    expect(failures).toContain('committed .app.json is forbidden');
  });

  it('rejects shell launchers, generic tools, and mirror drift', () => {
    const root = fixture();
    const claudePath = join(root, 'plugins', 'sparc', '.mcp.json');
    const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
    claude.mcpServers.sparc.command = 'bash';
    claude.mcpServers.sparc.args = ['-c', 'echo placeholder'];
    writeFileSync(claudePath, JSON.stringify(claude));
    const openaiAgent = join(root, 'plugins', 'sparc', 'skills', 'sparc', 'agents', 'openai.yaml');
    writeFileSync(openaiAgent, `${readFileSync(openaiAgent, 'utf8')}\n    - type: "mcp"\n      value: "filesystem"\n`);
    writeFileSync(join(root, 'skills', 'sparc', 'SKILL.md'), `${readFileSync(join(root, 'skills', 'sparc', 'SKILL.md'), 'utf8')}\nDrift.\n`);

    const failures = validatePlugins(root).join('\n');

    expect(failures).toContain('shell MCP launchers are forbidden');
    expect(failures).toContain('placeholder MCP command arguments');
    expect(failures).toContain('forbidden generic tool filesystem');
    expect(failures).toContain('mirrored skill differs');
    expect(failures).toContain('Claude and OpenAI MCP server maps differ');
  });

  it('rejects a dangerous generic MCP server even with a safe launcher', () => {
    const root = fixture();
    for (const relativePath of ['.mcp.json', '.openai.mcp.json']) {
      const path = join(root, 'plugins', 'sparc', relativePath);
      const config = JSON.parse(readFileSync(path, 'utf8'));
      const servers = config.mcpServers || config;
      servers.filesystem = servers.sparc;
      delete servers.sparc;
      writeFileSync(path, JSON.stringify(config));
    }

    expect(validatePlugins(root).join('\n')).toContain('forbidden generic tool filesystem');
  });

  it('rejects launcher drift even when both host configurations agree', () => {
    const root = fixture();
    for (const relativePath of ['.mcp.json', '.openai.mcp.json']) {
      const path = join(root, 'plugins', 'sparc', relativePath);
      const config = JSON.parse(readFileSync(path, 'utf8'));
      const server = (config.mcpServers || config).sparc;
      server.args.push('--extra');
      writeFileSync(path, JSON.stringify(config));
    }

    expect(validatePlugins(root).join('\n')).toContain(
      'launcher must exactly match npx --yes @ruvnet/sparc@1.0.0 mcp stdio',
    );
  });

  it('rejects symlinks and manifest paths outside the plugin root', () => {
    const root = fixture();
    symlinkSync('../../../../outside', join(root, 'plugins', 'sparc', 'skills', 'outside-link'));
    const manifestPath = join(root, 'plugins', 'sparc', '.codex-plugin', 'plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.skills = '../../outside';
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const failures = validatePlugins(root).join('\n');

    expect(failures).toContain('symbolic links are forbidden');
    expect(failures).toContain('skills path escapes plugin root');
  });

  it('validates both marketplace source forms and exact plugin coverage', () => {
    const root = fixture();
    const claudePath = join(root, '.claude-plugin', 'marketplace.json');
    const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
    claude.plugins[0].source = '../plugins/sparc';
    writeFileSync(claudePath, JSON.stringify(claude));

    const codexPath = join(root, '.agents', 'plugins', 'marketplace.json');
    const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
    codex.plugins = [];
    writeFileSync(codexPath, JSON.stringify(codex));

    const failures = validatePlugins(root).join('\n');

    expect(failures).toContain('source must exactly equal ./plugins/sparc');
    expect(failures).toContain('source escapes repository root');
    expect(failures).toContain('.agents/plugins/marketplace.json: entries must exactly match plugin directories');
  });
});
