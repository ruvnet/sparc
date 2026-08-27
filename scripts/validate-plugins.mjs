#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_SKILL_FILES = ['SKILL.md', 'agents/openai.yaml'];
const EXPECTED_PACKAGE_NAME = '@ruvnet/sparc';
const EXPECTED_SERVER_NAME = 'sparc';
const FORBIDDEN_TOOL_NAMES = new Set([
  'bash',
  'browser',
  'delete-file',
  'delete_file',
  'execute-command',
  'execute_command',
  'execute-shell',
  'execute_shell',
  'fetch-url',
  'fetch_url',
  'filesystem',
  'http-request',
  'http_request',
  'network',
  'powershell',
  'read-file',
  'read_file',
  'run-command',
  'run_command',
  'shell',
  'terminal',
  'write-file',
  'write_file',
]);
const PLACEHOLDER = /(?:^|[^a-z])(?:todo|tbd|replace[_ -]?me|placeholder|your[_ -]?(?:command|package|name))(?=$|[^a-z])/i;

function toPosix(path) {
  return path.split(sep).join('/');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isInside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function inspectPath(repositoryRoot, path, failures, expectedType) {
  const absolute = resolve(path);
  const label = toPosix(path);
  if (!isInside(repositoryRoot, absolute)) {
    failures.push(`${label}: path escapes repository root`);
    return false;
  }

  const rel = relative(repositoryRoot, absolute);
  let cursor = repositoryRoot;
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    const linkStat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!linkStat) return false;
    if (linkStat.isSymbolicLink()) {
      failures.push(`${toPosix(cursor)}: symbolic links are forbidden`);
      return false;
    }
  }

  const stat = statSync(absolute, { throwIfNoEntry: false });
  if (!stat) return false;
  let real;
  try {
    real = realpathSync(absolute);
  } catch {
    failures.push(`${label}: cannot resolve path`);
    return false;
  }
  if (!isInside(realpathSync(repositoryRoot), real)) {
    failures.push(`${label}: resolved path escapes repository root`);
    return false;
  }
  if (expectedType === 'file' && !stat.isFile()) {
    failures.push(`${label}: expected a regular file`);
    return false;
  }
  if (expectedType === 'directory' && !stat.isDirectory()) {
    failures.push(`${label}: expected a directory`);
    return false;
  }
  return true;
}

function walk(repositoryRoot, root, failures) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      failures.push(`${toPosix(path)}: symbolic links are forbidden`);
    } else if (entry.isDirectory()) {
      output.push(...walk(repositoryRoot, path, failures));
    } else if (entry.isFile()) {
      if (inspectPath(repositoryRoot, path, failures, 'file')) output.push(path);
    } else {
      failures.push(`${toPosix(path)}: only regular files and directories are allowed`);
    }
  }
  return output;
}

function parseJson(repositoryRoot, path, failures) {
  if (!inspectPath(repositoryRoot, path, failures, 'file')) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    failures.push(`${toPosix(path)}: invalid JSON`);
    return null;
  }
}

function collectToolValues(value, output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectToolValues(entry, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:tool|tools|allowedTools|allowed_tools)$/i.test(key)) {
      if (typeof child === 'string') output.push(child);
      else if (Array.isArray(child)) output.push(...child.filter((entry) => typeof entry === 'string'));
    }
    collectToolValues(child, output);
  }
  return output;
}

function validateDeclaredTool(value, path, failures) {
  const normalized = value.trim().toLowerCase();
  if (FORBIDDEN_TOOL_NAMES.has(normalized)) failures.push(`${path}: forbidden generic tool ${normalized}`);
}

function validateMcpServer(server, path, failures, expectedVersion) {
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    failures.push(`${path}: MCP server must be an object`);
    return;
  }
  const expected = {
    command: 'npx',
    args: ['--yes', `${EXPECTED_PACKAGE_NAME}@${expectedVersion}`, 'mcp', 'stdio'],
  };
  const hasExactKeys = JSON.stringify(Object.keys(server).sort()) === JSON.stringify(Object.keys(expected).sort());
  const hasExactCommand = server.command === expected.command;
  const hasExactArguments = Array.isArray(server.args)
    && JSON.stringify(server.args) === JSON.stringify(expected.args);
  if (!hasExactKeys || !hasExactCommand || !hasExactArguments) {
    failures.push(`${path}: launcher must exactly match npx --yes ${EXPECTED_PACKAGE_NAME}@${expectedVersion} mcp stdio`);
  }
  const command = typeof server.command === 'string' ? server.command.trim().toLowerCase() : '';
  if (!command || PLACEHOLDER.test(command)) failures.push(`${path}: placeholder MCP command`);
  if (['bash', 'sh', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh'].includes(command)) {
    failures.push(`${path}: shell MCP launchers are forbidden`);
  }
  if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string')) {
    failures.push(`${path}: stdio MCP args must be a string array`);
  }
  const commandLine = [server.command, ...(Array.isArray(server.args) ? server.args : [])].join(' ');
  if (PLACEHOLDER.test(commandLine)) failures.push(`${path}: placeholder MCP command arguments`);
}

function validateMcpFiles(repositoryRoot, pluginRoot, failures, expectedVersion) {
  const claudePath = join(pluginRoot, '.mcp.json');
  const openaiPath = join(pluginRoot, '.openai.mcp.json');
  if (!inspectPath(repositoryRoot, claudePath, failures, 'file')) failures.push(`${toPosix(claudePath)}: missing Claude MCP wrapper`);
  if (!inspectPath(repositoryRoot, openaiPath, failures, 'file')) failures.push(`${toPosix(openaiPath)}: missing OpenAI MCP configuration`);
  if (failures.some((failure) => failure.startsWith(toPosix(claudePath)) || failure.startsWith(toPosix(openaiPath)))) return;

  const claude = parseJson(repositoryRoot, claudePath, failures);
  const openai = parseJson(repositoryRoot, openaiPath, failures);
  if (claude && canonicalJson(Object.keys(claude).sort()) !== canonicalJson(['mcpServers'])) {
    failures.push(`${toPosix(claudePath)}: Claude config may contain only mcpServers`);
  }
  if (claude && (!claude.mcpServers || typeof claude.mcpServers !== 'object' || Array.isArray(claude.mcpServers))) {
    failures.push(`${toPosix(claudePath)}: Claude config must wrap servers in mcpServers`);
  }
  if (openai && Object.hasOwn(openai, 'mcpServers')) {
    failures.push(`${toPosix(openaiPath)}: OpenAI config must be the direct server map`);
  }
  const claudeServers = claude?.mcpServers && typeof claude.mcpServers === 'object' ? claude.mcpServers : {};
  const openaiServers = openai && typeof openai === 'object' && !Array.isArray(openai) ? openai : {};
  if (JSON.stringify(Object.keys(claudeServers)) !== JSON.stringify([EXPECTED_SERVER_NAME])) {
    failures.push(`${toPosix(claudePath)}: MCP server map must contain only ${EXPECTED_SERVER_NAME}`);
  }
  if (JSON.stringify(Object.keys(openaiServers)) !== JSON.stringify([EXPECTED_SERVER_NAME])) {
    failures.push(`${toPosix(openaiPath)}: MCP server map must contain only ${EXPECTED_SERVER_NAME}`);
  }
  for (const [name, server] of Object.entries(claudeServers)) {
    validateDeclaredTool(name, `${toPosix(claudePath)}#${name}`, failures);
    validateMcpServer(server, `${toPosix(claudePath)}#${name}`, failures, expectedVersion);
  }
  for (const [name, server] of Object.entries(openaiServers)) {
    validateDeclaredTool(name, `${toPosix(openaiPath)}#${name}`, failures);
    validateMcpServer(server, `${toPosix(openaiPath)}#${name}`, failures, expectedVersion);
  }
  if (canonicalJson(claudeServers) !== canonicalJson(openaiServers)) {
    failures.push(`${toPosix(pluginRoot)}: Claude and OpenAI MCP server maps differ`);
  }
}

function validateSkillMirrors(repositoryRoot, pluginRoot, failures) {
  const pluginSkills = join(pluginRoot, 'skills');
  const rootSkills = join(repositoryRoot, 'skills');
  if (!inspectPath(repositoryRoot, pluginSkills, failures, 'directory')) {
    failures.push(`${toPosix(pluginSkills)}: missing plugin skills`);
    return;
  }
  if (!inspectPath(repositoryRoot, rootSkills, failures, 'directory')) {
    failures.push(`${toPosix(rootSkills)}: missing root npx skills`);
    return;
  }
  const pluginFiles = walk(repositoryRoot, pluginSkills, failures).map((path) => toPosix(relative(pluginSkills, path)));
  const rootFiles = walk(repositoryRoot, rootSkills, failures).map((path) => toPosix(relative(rootSkills, path)));
  if (JSON.stringify(pluginFiles) !== JSON.stringify(rootFiles)) {
    failures.push(`${toPosix(pluginRoot)}: root and plugin skill file sets differ`);
    return;
  }
  for (const relativePath of pluginFiles) {
    const pluginContent = readFileSync(join(pluginSkills, relativePath));
    const rootContent = readFileSync(join(rootSkills, relativePath));
    if (!pluginContent.equals(rootContent)) failures.push(`${toPosix(join(pluginSkills, relativePath))}: mirrored skill differs`);
  }
  const skillNames = readdirSync(pluginSkills, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (!skillNames.length) failures.push(`${toPosix(pluginSkills)}: at least one skill is required`);
  for (const skillName of skillNames) {
    for (const required of REQUIRED_SKILL_FILES) {
      const path = join(pluginSkills, skillName, required);
      if (!inspectPath(repositoryRoot, path, failures, 'file')) failures.push(`${toPosix(path)}: missing required skill file`);
    }
  }
}

function validatePlugin(repositoryRoot, pluginRoot, failures, packageVersion) {
  const relativePlugin = toPosix(relative(repositoryRoot, pluginRoot));
  const codexPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
  const claudePath = join(pluginRoot, '.claude-plugin', 'plugin.json');
  const manifests = [];
  for (const path of [codexPath, claudePath]) {
    if (!inspectPath(repositoryRoot, path, failures, 'file')) {
      failures.push(`${toPosix(path)}: missing plugin manifest`);
      continue;
    }
    const manifest = parseJson(repositoryRoot, path, failures);
    if (!manifest) continue;
    manifests.push({ path, manifest });
    for (const field of ['name', 'version', 'description']) {
      if (typeof manifest[field] !== 'string' || !manifest[field].trim()) failures.push(`${toPosix(path)}: missing ${field}`);
    }
    if (manifest.name !== basename(pluginRoot)) failures.push(`${toPosix(path)}: manifest name must match plugin directory`);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version || '')) {
      failures.push(`${toPosix(path)}: version must be exact semantic versioning`);
    }
    if (manifest.version !== packageVersion) failures.push(`${toPosix(path)}: version must match package.json`);
    for (const tool of collectToolValues(manifest)) validateDeclaredTool(tool, toPosix(path), failures);
  }

  if (manifests.length === 2 && manifests[0].manifest.version !== manifests[1].manifest.version) {
    failures.push(`${relativePlugin}: Claude and Codex plugin versions differ`);
  }
  const codexManifest = manifests.find(({ path }) => path === codexPath)?.manifest;
  if (codexManifest) {
    if (codexManifest.skills !== './skills/') {
      failures.push(`${toPosix(codexPath)}: skills path must exactly equal ./skills/`);
    }
    if (codexManifest.mcpServers !== './.mcp.json') {
      failures.push(`${toPosix(codexPath)}: MCP path must exactly equal ./.mcp.json`);
    }
    for (const field of ['skills', 'mcpServers']) {
      if (typeof codexManifest[field] === 'string') {
        const target = resolve(pluginRoot, codexManifest[field]);
        const expectedType = field === 'skills' ? 'directory' : 'file';
        if (!isInside(pluginRoot, target)) {
          failures.push(`${toPosix(codexPath)}: ${field} path escapes plugin root`);
        } else if (!inspectPath(repositoryRoot, target, failures, expectedType)) {
          failures.push(`${toPosix(codexPath)}: ${field} path does not exist`);
        }
      }
    }
  }

  const files = walk(repositoryRoot, pluginRoot, failures);
  for (const path of files) {
    const relativePath = toPosix(relative(pluginRoot, path));
    if (basename(path) === 'skill.toml') failures.push(`${relativePlugin}/${relativePath}: legacy skill.toml is forbidden`);
    if (basename(path) === '.app.json') failures.push(`${relativePlugin}/${relativePath}: fabricated .app.json is forbidden`);
    const text = readFileSync(path, 'utf8');
    if (/@latest\b/i.test(text)) failures.push(`${relativePlugin}/${relativePath}: @latest is forbidden`);
    if (/^(?:allowed-tools|allowed_tools)\s*:/im.test(text)) {
      const lines = text.split('\n').filter((line) => /^(?:allowed-tools|allowed_tools)\s*:/i.test(line));
      for (const line of lines) {
        for (const token of line.split(/[:,\[\]\s]+/).filter(Boolean).slice(1)) validateDeclaredTool(token, `${relativePlugin}/${relativePath}`, failures);
      }
    }
    if (relativePath.endsWith('agents/openai.yaml')) {
      const matches = [...text.matchAll(/^\s*value:\s*["']?([^"'\s]+)["']?\s*$/gim)];
      for (const match of matches) validateDeclaredTool(match[1], `${relativePlugin}/${relativePath}`, failures);
    }
  }
  validateMcpFiles(repositoryRoot, pluginRoot, failures, packageVersion);
  validateSkillMirrors(repositoryRoot, pluginRoot, failures);
}

function marketplaceEntries(repositoryRoot, path, kind, failures) {
  if (!inspectPath(repositoryRoot, path, failures, 'file')) {
    failures.push(`${toPosix(path)}: missing ${kind} marketplace`);
    return [];
  }
  const marketplace = parseJson(repositoryRoot, path, failures);
  if (!marketplace || !Array.isArray(marketplace.plugins)) {
    failures.push(`${toPosix(path)}: marketplace plugins must be an array`);
    return [];
  }
  const entries = [];
  for (const [index, plugin] of marketplace.plugins.entries()) {
    const label = `${toPosix(path)}#plugins[${index}]`;
    if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin) || typeof plugin.name !== 'string') {
      failures.push(`${label}: marketplace plugin must have a name`);
      continue;
    }
    let source;
    if (kind === 'Claude') {
      source = plugin.source;
      if (typeof source !== 'string') failures.push(`${label}: Claude source must be a relative string`);
    } else {
      if (!plugin.source || typeof plugin.source !== 'object' || Array.isArray(plugin.source)
        || canonicalJson(Object.keys(plugin.source).sort()) !== canonicalJson(['path', 'source'])
        || plugin.source.source !== 'local' || typeof plugin.source.path !== 'string') {
        failures.push(`${label}: Codex source must be an exact local path object`);
      } else {
        source = plugin.source.path;
      }
    }
    if (typeof source !== 'string') continue;
    const expectedSource = `./plugins/${plugin.name}`;
    if (source !== expectedSource) failures.push(`${label}: source must exactly equal ${expectedSource}`);
    const target = resolve(repositoryRoot, source);
    if (!isInside(repositoryRoot, target)) {
      failures.push(`${label}: source escapes repository root`);
    } else if (!inspectPath(repositoryRoot, target, failures, 'directory')) {
      failures.push(`${label}: source directory does not exist`);
    }
    entries.push(plugin.name);
  }
  if (new Set(entries).size !== entries.length) failures.push(`${toPosix(path)}: duplicate marketplace plugin name`);
  return entries.sort();
}

function validateMarketplaces(repositoryRoot, pluginNames, failures) {
  const claude = marketplaceEntries(
    repositoryRoot,
    join(repositoryRoot, '.claude-plugin', 'marketplace.json'),
    'Claude',
    failures,
  );
  const codex = marketplaceEntries(
    repositoryRoot,
    join(repositoryRoot, '.agents', 'plugins', 'marketplace.json'),
    'Codex',
    failures,
  );
  const expected = [...pluginNames].sort();
  if (JSON.stringify(claude) !== JSON.stringify(expected)) {
    failures.push('.claude-plugin/marketplace.json: entries must exactly match plugin directories');
  }
  if (JSON.stringify(codex) !== JSON.stringify(expected)) {
    failures.push('.agents/plugins/marketplace.json: entries must exactly match plugin directories');
  }
}

export function validatePlugins(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const failures = [];
  if (!inspectPath(root, root, failures, 'directory')) return [...new Set(failures)].sort();
  const packageJson = parseJson(root, join(root, 'package.json'), failures);
  if (!packageJson || packageJson.name !== EXPECTED_PACKAGE_NAME
    || typeof packageJson.version !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
    failures.push(`package.json: package must be ${EXPECTED_PACKAGE_NAME} at an exact semantic version`);
  }
  const pluginsRoot = join(root, 'plugins');
  if (!inspectPath(root, pluginsRoot, failures, 'directory')) return [...new Set([...failures, 'plugins: directory is missing'])].sort();
  const pluginRoots = [];
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    const path = join(pluginsRoot, entry.name);
    if (entry.isSymbolicLink()) failures.push(`${toPosix(path)}: symbolic links are forbidden`);
    else if (entry.isDirectory()) pluginRoots.push(path);
    else failures.push(`${toPosix(path)}: plugin root entries must be directories`);
  }
  pluginRoots.sort();
  if (!pluginRoots.length) return [...new Set([...failures, 'plugins: at least one plugin is required'])].sort();
  const packageVersion = typeof packageJson?.version === 'string' ? packageJson.version : '';
  for (const pluginRoot of pluginRoots) validatePlugin(root, pluginRoot, failures, packageVersion);
  validateMarketplaces(root, pluginRoots.map((path) => basename(path)), failures);
  return [...new Set(failures)].sort();
}

function parseRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === '--root') return resolve(argv[1]);
  throw new Error('usage: validate-plugins.mjs [--root <repository>]');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const failures = validatePlugins(parseRoot(process.argv.slice(2)));
    if (failures.length) {
      console.error(`Plugin validation failed with ${failures.length} finding(s):`);
      for (const failure of failures) console.error(failure);
      process.exitCode = 1;
    } else {
      console.log('Plugin validation passed.');
    }
  } catch (error) {
    console.error(`Plugin validation error: ${error.message}`);
    process.exitCode = 2;
  }
}
