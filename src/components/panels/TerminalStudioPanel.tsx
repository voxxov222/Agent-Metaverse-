import { useEffect, useState } from 'react';
import { Terminal, Code2, Puzzle, Play, Save, Sparkles } from 'lucide-react';
import type { PluginManifest } from '../../types/os';

interface TerminalStudioPanelProps {
  plugins: PluginManifest[];
  onTogglePlugin: (id: string) => Promise<void>;
  onAddPlugin: (payload: { name: string; description: string; sourceRepo: string }) => Promise<void>;
  isOffline: boolean;
}

interface SandboxFile {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
}

interface TermLine {
  id: string;
  cmd?: string;
  stdout?: string;
  stderr?: string;
  meta?: string;
}

export function TerminalStudioPanel({
  plugins,
  onTogglePlugin,
  onAddPlugin,
  isOffline,
}: TerminalStudioPanelProps) {
  const [tab, setTab] = useState<'terminal' | 'studio' | 'plugins'>('terminal');
  const [cmdInput, setCmdInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);
  const [history, setHistory] = useState<TermLine[]>([
    {
      id: 'welcome',
      stdout: "VCALABS Isolated Sandbox Shell (/vcalabs-workspace). Type 'help' or run 'node src/telemetry-check.mjs'.",
    },
  ]);

  // Code Studio state
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState('src/telemetry-check.mjs');
  const [fileContent, setFileContent] = useState('');
  const [aiInstruction, setAiInstruction] = useState('');
  const [studioStatus, setStudioStatus] = useState('');

  // Plugin proposal state
  const [pluginName, setPluginName] = useState('');
  const [pluginDesc, setPluginDesc] = useState('');
  const [pluginRepo, setPluginRepo] = useState('');

  async function refreshFiles() {
    try {
      const res = await fetch('/api/workspace/files');
      if (res.ok) {
        const data = (await res.json()) as { files: SandboxFile[] };
        setFiles(data.files);
      }
    } catch {
      // ignore offline
    }
  }

  async function openFile(relPath: string) {
    setActiveFilePath(relPath);
    try {
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(relPath)}`);
      if (res.ok) {
        const data = (await res.json()) as { content: string };
        setFileContent(data.content);
        setStudioStatus(`Loaded ${relPath}`);
      }
    } catch {
      setStudioStatus('Unable to read file');
    }
  }

  useEffect(() => {
    void refreshFiles();
    void openFile('src/telemetry-check.mjs');
  }, []);

  async function runCommand(rawCmd?: string) {
    const cmd = (rawCmd ?? cmdInput).trim();
    if (!cmd || termBusy) return;
    if (cmd === 'clear') {
      setHistory([]);
      setCmdInput('');
      return;
    }
    setCmdInput('');
    if (isOffline) {
      setHistory((prev) => [
        ...prev,
        { id: `off-${Date.now()}`, cmd, stderr: 'Offline mode: server sandbox shell is unreachable.' },
      ]);
      return;
    }

    setTermBusy(true);
    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = (await res.json()) as { exitCode: number; stdout: string; stderr: string; durationMs: number };
      setHistory((prev) => [
        ...prev,
        {
          id: `t-${Date.now()}`,
          cmd,
          stdout: data.stdout,
          stderr: data.stderr,
          meta: `exit ${data.exitCode} · ${data.durationMs}ms`,
        },
      ]);
      void refreshFiles();
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, cmd, stderr: err instanceof Error ? err.message : 'Execution error' },
      ]);
    } finally {
      setTermBusy(false);
    }
  }

  async function saveActiveFile() {
    try {
      const res = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFilePath, content: fileContent }),
      });
      if (res.ok) {
        setStudioStatus(`Saved ${activeFilePath}`);
        void refreshFiles();
      } else {
        const d = (await res.json()) as { error?: string };
        setStudioStatus(d.error || 'Save failed');
      }
    } catch {
      setStudioStatus('Save failed');
    }
  }

  async function generateWithAgent() {
    if (!aiInstruction.trim() || isOffline) return;
    setStudioStatus('Agent generating code...');
    try {
      const res = await fetch('/api/workspace/ai-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFilePath, instruction: aiInstruction.trim() }),
      });
      const data = (await res.json()) as { code?: string; summary?: string; error?: string };
      if (!res.ok) {
        setStudioStatus(data.error || 'Generation failed');
        return;
      }
      if (typeof data.code === 'string') setFileContent(data.code);
      setStudioStatus(data.summary || 'Updated file');
      setAiInstruction('');
      void refreshFiles();
    } catch {
      setStudioStatus('AI code generation failed');
    }
  }

  async function handlePluginSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pluginName.trim() || !pluginDesc.trim()) return;
    await onAddPlugin({
      name: pluginName.trim(),
      description: pluginDesc.trim(),
      sourceRepo: pluginRepo.trim() || 'custom/local-plugin',
    });
    setPluginName('');
    setPluginDesc('');
    setPluginRepo('');
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Sub-navigation */}
      <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setTab('terminal')}
          className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'terminal' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Terminal</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('studio')}
          className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'studio' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Dev Studio</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('plugins')}
          className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'plugins' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Puzzle className="w-3.5 h-3.5" />
          <span>Plugins</span>
        </button>
      </div>

      {tab === 'terminal' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {['ls', 'ls src', 'node src/telemetry-check.mjs', 'cat README.md', 'help'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => void runCommand(preset)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 hover:border-cyan-500/50 cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto vca-scroll bg-[#05080F] border border-slate-800 rounded-lg p-3 font-mono text-xs space-y-2.5">
            {history.map((line) => (
              <div key={line.id} className="space-y-1">
                {line.cmd && (
                  <div className="flex items-center justify-between text-cyan-300">
                    <span>$ {line.cmd}</span>
                    {line.meta && <span className="text-[10px] text-slate-500">{line.meta}</span>}
                  </div>
                )}
                {line.stdout && <pre className="text-slate-200 whitespace-pre-wrap">{line.stdout}</pre>}
                {line.stderr && <pre className="text-red-300 whitespace-pre-wrap">{line.stderr}</pre>}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runCommand();
            }}
            className="flex gap-2"
          >
            <label htmlFor="sandbox-cmd-input" className="sr-only">
              Terminal command
            </label>
            <input
              id="sandbox-cmd-input"
              type="text"
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              placeholder="Enter command (e.g. ls, node src/telemetry-check.mjs)..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={termBusy || !cmdInput.trim()}
              className="px-3.5 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs hover:bg-cyan-400 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run</span>
            </button>
          </form>
        </div>
      )}

      {tab === 'studio' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 text-xs">
          <div className="flex gap-1.5 overflow-x-auto pb-1 vca-scroll">
            {files
              .filter((f) => f.type === 'file')
              .map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => void openFile(f.path)}
                  className={`px-2.5 py-1 rounded border font-mono shrink-0 cursor-pointer ${
                    activeFilePath === f.path
                      ? 'bg-slate-800 border-cyan-400/60 text-cyan-200'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  {f.path}
                </button>
              ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <input
              type="text"
              aria-label="Target file path"
              value={activeFilePath}
              onChange={(e) => setActiveFilePath(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 font-mono text-slate-200"
            />
            <button
              type="button"
              onClick={() => void saveActiveFile()}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 flex items-center gap-1 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 text-cyan-400" />
              <span>Save</span>
            </button>
          </div>

          <textarea
            aria-label="Workspace code editor"
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            className="flex-1 min-h-0 w-full bg-[#05080F] border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-100 resize-none focus:outline-none focus:border-cyan-400"
          />

          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Agent code edit instruction"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="Ask Kestrel-03 to write or refactor this file..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100"
            />
            <button
              type="button"
              onClick={() => void generateWithAgent()}
              className="px-3 py-1.5 rounded-lg bg-violet-500 text-white font-semibold hover:bg-violet-400 flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Agent Edit</span>
            </button>
          </div>
          {studioStatus && <div className="text-[11px] text-slate-400">{studioStatus}</div>}
        </div>
      )}

      {tab === 'plugins' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1 text-xs">
          {plugins.map((p) => (
            <div key={p.id} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-100">
                  {p.name} <span className="font-mono text-slate-400">v{p.version}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void onTogglePlugin(p.id)}
                  className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
                    p.enabled
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {!p.installed ? 'Install' : p.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <p className="text-slate-300">{p.description}</p>
              <div className="text-slate-400 font-mono text-[11px]">
                Repo: {p.sourceRepo} · Scopes: {p.permissions.join(', ')} · Security:{' '}
                {p.securityReviewed ? 'Reviewed' : 'Pending Review'}
              </div>
            </div>
          ))}

          <form onSubmit={handlePluginSubmit} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="font-semibold text-slate-200">Propose Modular Extension</div>
            <input
              type="text"
              required
              value={pluginName}
              onChange={(e) => setPluginName(e.target.value)}
              placeholder="Extension name"
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <input
              type="text"
              required
              value={pluginDesc}
              onChange={(e) => setPluginDesc(e.target.value)}
              placeholder="Capability description"
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <input
              type="text"
              value={pluginRepo}
              onChange={(e) => setPluginRepo(e.target.value)}
              placeholder="Source repository (e.g. github.com/org/repo)"
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <button
              type="submit"
              className="w-full py-2 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
            >
              Register Sandboxed Plugin
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
