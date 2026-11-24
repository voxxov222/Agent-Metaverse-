import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const SANDBOX_ROOT = path.resolve(process.cwd(), '.vcalabs-workspace');

export function ensureSandboxInitialized(): void {
  if (!fs.existsSync(SANDBOX_ROOT)) {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  }
  const srcDir = path.join(SANDBOX_ROOT, 'src');
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }
  const readmePath = path.join(SANDBOX_ROOT, 'README.md');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      [
        '# VCALABS Agent Workspace',
        '',
        'Isolated development sandbox for autonomous agents and operator commands.',
        '',
        '## Included Modules',
        '- `src/telemetry-check.mjs`: Inspects system runtime metrics inside the sandbox.',
        '- `src/workflow-validator.mjs`: Validates DAG dependency graphs.',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  const pkgPath = path.join(SANDBOX_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: 'vcalabs-agent-sandbox',
          version: '1.0.0',
          type: 'module',
          scripts: {
            check: 'node src/telemetry-check.mjs',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  const script1 = path.join(srcDir, 'telemetry-check.mjs');
  if (!fs.existsSync(script1)) {
    fs.writeFileSync(
      script1,
      [
        "import os from 'node:os';",
        'const memUsed = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);',
        'console.log(JSON.stringify({ platform: os.platform(), cpus: os.cpus().length, memUsedMb: memUsed, load1m: os.loadavg()[0] }, null, 2));',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  const script2 = path.join(srcDir, 'workflow-validator.mjs');
  if (!fs.existsSync(script2)) {
    fs.writeFileSync(
      script2,
      [
        'export function hasCycle(nodes) {',
        '  const visited = new Set();',
        '  const stack = new Set();',
        '  const map = new Map(nodes.map(n => [n.id, n.deps || []]));',
        '  function dfs(id) {',
        '    if (stack.has(id)) return true;',
        '    if (visited.has(id)) return false;',
        '    visited.add(id); stack.add(id);',
        '    for (const dep of map.get(id) || []) { if (dfs(dep)) return true; }',
        '    stack.delete(id); return false;',
        '  }',
        '  return nodes.some(n => dfs(n.id));',
        '}',
        "console.log('Cycle check sample:', hasCycle([{ id: 'a', deps: [] }, { id: 'b', deps: ['a'] }]));",
        '',
      ].join('\n'),
      'utf8',
    );
  }
}

export function resolveSafePath(relPath: string): string {
  const cleaned = relPath.replace(/^\/+/, '');
  const resolved = path.resolve(SANDBOX_ROOT, cleaned);
  if (resolved !== SANDBOX_ROOT && !resolved.startsWith(SANDBOX_ROOT + path.sep)) {
    throw new Error('Path traversal blocked: path escapes sandbox root');
  }
  return resolved;
}

export interface SandboxFileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  updatedAt: number;
}

export function listSandboxFiles(subDir = ''): SandboxFileNode[] {
  ensureSandboxInitialized();
  const targetDir = resolveSafePath(subDir);
  if (!fs.existsSync(targetDir)) return [];
  const results: SandboxFileNode[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(SANDBOX_ROOT, full).replace(/\\/g, '/');
      const stat = fs.statSync(full);
      results.push({
        path: rel,
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        updatedAt: stat.mtimeMs,
      });
      if (entry.isDirectory()) {
        walk(full);
      }
    }
  }

  walk(targetDir);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export function readSandboxFile(relPath: string): string {
  ensureSandboxInitialized();
  const full = resolveSafePath(relPath);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    throw new Error(`File not found: ${relPath}`);
  }
  return fs.readFileSync(full, 'utf8');
}

export function writeSandboxFile(relPath: string, content: string): SandboxFileNode {
  ensureSandboxInitialized();
  const full = resolveSafePath(relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  const stat = fs.statSync(full);
  return {
    path: path.relative(SANDBOX_ROOT, full).replace(/\\/g, '/'),
    name: path.basename(full),
    type: 'file',
    size: stat.size,
    updatedAt: stat.mtimeMs,
  };
}

function tokenizeCommand(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

export interface TerminalExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function executeSandboxCommand(rawCommand: string): Promise<TerminalExecResult> {
  ensureSandboxInitialized();
  const start = Date.now();
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return { exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
  }

  // Block shell metacharacters to enforce argument-level isolation
  if (/[;&|`$><\n\r]/.test(trimmed)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Blocked: shell chaining, pipes, and redirections are disabled inside the isolated sandbox.',
      durationMs: Date.now() - start,
    };
  }

  const tokens = tokenizeCommand(trimmed);
  const cmd = tokens[0];
  const args = tokens.slice(1);

  try {
    switch (cmd) {
      case 'help':
        return {
          exitCode: 0,
          stdout: [
            'VCALABS Isolated Sandbox Shell — Permitted Commands:',
            '  ls [dir]           List files and directories inside workspace',
            '  pwd                Print sandbox working directory',
            '  cat <file>         Display file contents',
            '  mkdir <dir>        Create directory inside workspace',
            '  touch <file>       Create empty file',
            '  rm <file>          Remove file inside workspace',
            '  wc <file>          Count lines, words, and bytes',
            '  echo <text...>     Print text',
            '  node <script>      Execute a JS/MJS script inside workspace',
            '  git <subcommand>   Run git status / log / diff / init inside workspace',
            '  date / whoami      System identity & UTC timestamp',
          ].join('\n'),
          stderr: '',
          durationMs: Date.now() - start,
        };
      case 'pwd':
        return { exitCode: 0, stdout: '/vcalabs-workspace', stderr: '', durationMs: Date.now() - start };
      case 'whoami':
        return { exitCode: 0, stdout: 'vcalabs-operator (sandbox)', stderr: '', durationMs: Date.now() - start };
      case 'date':
        return { exitCode: 0, stdout: new Date().toISOString(), stderr: '', durationMs: Date.now() - start };
      case 'echo':
        return { exitCode: 0, stdout: args.join(' '), stderr: '', durationMs: Date.now() - start };
      case 'ls': {
        const target = resolveSafePath(args[0] ?? '');
        if (!fs.existsSync(target)) {
          return { exitCode: 1, stdout: '', stderr: `ls: ${args[0]}: No such directory`, durationMs: Date.now() - start };
        }
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return { exitCode: 0, stdout: lines.join('\n'), stderr: '', durationMs: Date.now() - start };
      }
      case 'cat': {
        if (!args[0]) {
          return { exitCode: 1, stdout: '', stderr: 'Usage: cat <file>', durationMs: Date.now() - start };
        }
        const content = readSandboxFile(args[0]);
        return { exitCode: 0, stdout: content, stderr: '', durationMs: Date.now() - start };
      }
      case 'mkdir': {
        if (!args[0]) {
          return { exitCode: 1, stdout: '', stderr: 'Usage: mkdir <dir>', durationMs: Date.now() - start };
        }
        const dirPath = resolveSafePath(args[0]);
        fs.mkdirSync(dirPath, { recursive: true });
        return { exitCode: 0, stdout: `Created directory ${args[0]}`, stderr: '', durationMs: Date.now() - start };
      }
      case 'touch': {
        if (!args[0]) {
          return { exitCode: 1, stdout: '', stderr: 'Usage: touch <file>', durationMs: Date.now() - start };
        }
        const filePath = resolveSafePath(args[0]);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '', 'utf8');
        return { exitCode: 0, stdout: `Touched ${args[0]}`, stderr: '', durationMs: Date.now() - start };
      }
      case 'rm': {
        if (!args[0]) {
          return { exitCode: 1, stdout: '', stderr: 'Usage: rm <file>', durationMs: Date.now() - start };
        }
        const filePath = resolveSafePath(args[0]);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          return { exitCode: 1, stdout: '', stderr: `Cannot remove ${args[0]}: not a file`, durationMs: Date.now() - start };
        }
        fs.unlinkSync(filePath);
        return { exitCode: 0, stdout: `Removed ${args[0]}`, stderr: '', durationMs: Date.now() - start };
      }
      case 'wc': {
        if (!args[0]) {
          return { exitCode: 1, stdout: '', stderr: 'Usage: wc <file>', durationMs: Date.now() - start };
        }
        const text = readSandboxFile(args[0]);
        const lines = text.split('\n').length;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const bytes = Buffer.byteLength(text, 'utf8');
        return { exitCode: 0, stdout: `  ${lines}  ${words}  ${bytes} ${args[0]}`, stderr: '', durationMs: Date.now() - start };
      }
      case 'node': {
        if (!args[0]) {
          const { stdout, stderr } = await execFileAsync('node', ['--version'], { cwd: SANDBOX_ROOT, timeout: 4000 });
          return { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - start };
        }
        if (args[0] === '--version' || args[0] === '-v') {
          const { stdout } = await execFileAsync('node', ['--version'], { cwd: SANDBOX_ROOT, timeout: 4000 });
          return { exitCode: 0, stdout: stdout.trim(), stderr: '', durationMs: Date.now() - start };
        }
        const scriptPath = resolveSafePath(args[0]);
        if (!fs.existsSync(scriptPath)) {
          return { exitCode: 1, stdout: '', stderr: `Script not found: ${args[0]}`, durationMs: Date.now() - start };
        }
        const { stdout, stderr } = await execFileAsync('node', [scriptPath], {
          cwd: SANDBOX_ROOT,
          timeout: 6000,
          maxBuffer: 256 * 1024,
        });
        return { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - start };
      }
      case 'git': {
        const sub = args[0] ?? 'status';
        const allowedGit = new Set(['status', 'log', 'diff', 'branch', 'init']);
        if (!allowedGit.has(sub)) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `Git subcommand '${sub}' is restricted in sandbox. Allowed: status, log, diff, branch, init`,
            durationMs: Date.now() - start,
          };
        }
        const { stdout, stderr } = await execFileAsync('git', [sub], {
          cwd: SANDBOX_ROOT,
          timeout: 5000,
          maxBuffer: 256 * 1024,
        });
        return { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - start };
      }
      default:
        return {
          exitCode: 127,
          stdout: '',
          stderr: `Command '${cmd}' not recognized or blocked. Type 'help' for permitted sandbox commands.`,
          durationMs: Date.now() - start,
        };
    }
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string; stdout?: string };
    return {
      exitCode: 1,
      stdout: (e.stdout ?? '').trim(),
      stderr: (e.stderr || e.message || 'Execution failed').trim(),
      durationMs: Date.now() - start,
    };
  }
}
