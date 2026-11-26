import fs from 'fs';
import path from 'path';
import {
  createDefaultVfsNodes,
  DEFAULT_TILING_CONFIG,
  parseTilingConf,
  serializeTilingConf,
  VCA_OS_MODES,
  type TilingConfig,
  type VcaOsMode,
  type VcaOsStateSnapshot,
  type VfsNode,
} from '../utils/vcaOsEngine';

const STATE_DIR = path.resolve(process.cwd(), '.vca_sandbox');
const STATE_FILE = path.join(STATE_DIR, '.vcaos-state.json');

export class VcaOsBackendService {
  private state: VcaOsStateSnapshot;

  constructor() {
    this.state = this.loadInitialState();
  }

  private loadInitialState(): VcaOsStateSnapshot {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<VcaOsStateSnapshot>;
        const mode: VcaOsMode = VCA_OS_MODES.some((m) => m.id === parsed.mode)
          ? (parsed.mode as VcaOsMode)
          : 'native';
        const activeWorkspace =
          Number.isInteger(parsed.activeWorkspace) &&
          Number(parsed.activeWorkspace) >= 1 &&
          Number(parsed.activeWorkspace) <= 9
            ? Number(parsed.activeWorkspace)
            : 1;
        const tilingConfig: TilingConfig = {
          ...DEFAULT_TILING_CONFIG,
          ...(parsed.tilingConfig ?? {}),
        };
        const vfsNodes: VfsNode[] = Array.isArray(parsed.vfsNodes) && parsed.vfsNodes.length > 0
          ? parsed.vfsNodes
          : createDefaultVfsNodes(tilingConfig);
        return {
          mode,
          activeWorkspace,
          tilingConfig,
          vfsNodes,
          updatedAt: Number(parsed.updatedAt ?? Date.now()),
        };
      }
    } catch {
      // Fall back to clean defaults
    }
    return {
      mode: 'native',
      activeWorkspace: 1,
      tilingConfig: { ...DEFAULT_TILING_CONFIG },
      vfsNodes: createDefaultVfsNodes(DEFAULT_TILING_CONFIG),
      updatedAt: Date.now(),
    };
  }

  private persist() {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // Ignore write failures in read-only sandboxes
    }
  }

  public getSnapshot(): VcaOsStateSnapshot {
    return this.state;
  }

  public updateState(patch: {
    mode?: VcaOsMode;
    activeWorkspace?: number;
    tilingConfig?: Partial<TilingConfig>;
  }): VcaOsStateSnapshot {
    if (patch.mode && VCA_OS_MODES.some((m) => m.id === patch.mode)) {
      this.state.mode = patch.mode;
    }
    if (
      typeof patch.activeWorkspace === 'number' &&
      Number.isInteger(patch.activeWorkspace) &&
      patch.activeWorkspace >= 1 &&
      patch.activeWorkspace <= 9
    ) {
      this.state.activeWorkspace = patch.activeWorkspace;
    }
    if (patch.tilingConfig) {
      const nextCfg: TilingConfig = {
        ...this.state.tilingConfig,
        ...patch.tilingConfig,
      };
      nextCfg.gapsInner = Math.max(0, Math.min(48, Math.round(nextCfg.gapsInner)));
      nextCfg.gapsOuter = Math.max(0, Math.min(64, Math.round(nextCfg.gapsOuter)));
      nextCfg.splitRatio = Math.max(0.25, Math.min(0.75, Number(nextCfg.splitRatio.toFixed(2))));
      nextCfg.borderWidth = Math.max(1, Math.min(6, Math.round(nextCfg.borderWidth)));
      this.state.tilingConfig = nextCfg;

      const serialized = serializeTilingConf(nextCfg);
      const idx = this.state.vfsNodes.findIndex((n) => n.path === 'Config/vcaos/tiling.conf');
      if (idx >= 0) {
        this.state.vfsNodes[idx] = {
          ...this.state.vfsNodes[idx],
          content: serialized,
          updatedAt: Date.now(),
        };
      } else {
        this.state.vfsNodes.unshift({
          path: 'Config/vcaos/tiling.conf',
          content: serialized,
          updatedAt: Date.now(),
        });
      }
    }
    this.state.updatedAt = Date.now();
    this.persist();
    return this.state;
  }

  public upsertVfsNode(rawPath: string, content: string): VcaOsStateSnapshot {
    const cleanPath = rawPath.replace(/^\/+/, '').replace(/\.\./g, '').trim();
    if (!cleanPath || cleanPath.length > 180) {
      throw new Error('Invalid VFS path.');
    }
    const existingIdx = this.state.vfsNodes.findIndex((n) => n.path === cleanPath);
    const node: VfsNode = {
      path: cleanPath,
      content: String(content ?? ''),
      updatedAt: Date.now(),
    };
    if (existingIdx >= 0) {
      this.state.vfsNodes[existingIdx] = node;
    } else {
      this.state.vfsNodes.push(node);
    }

    // Live-reload Hyprland compositor config if tiling.conf was edited
    if (cleanPath === 'Config/vcaos/tiling.conf') {
      this.state.tilingConfig = parseTilingConf(node.content, this.state.tilingConfig);
    }
    this.state.updatedAt = Date.now();
    this.persist();
    return this.state;
  }

  public deleteVfsNode(rawPath: string): VcaOsStateSnapshot {
    const cleanPath = rawPath.replace(/^\/+/, '').trim();
    if (cleanPath === 'Config/vcaos/tiling.conf') {
      throw new Error('Core compositor configuration cannot be deleted.');
    }
    this.state.vfsNodes = this.state.vfsNodes.filter((n) => n.path !== cleanPath);
    this.state.updatedAt = Date.now();
    this.persist();
    return this.state;
  }
}
