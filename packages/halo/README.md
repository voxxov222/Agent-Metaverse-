# HALO — Holographic Command HUD (`packages/halo`)

HALO is the primary operator control surface for the **VCALABS / AETHER OS** kernel, agent runtime, and 3D world state. Every widget reads from the normalized `haloStore` fed by `/api/bootstrap`, `/api/kernel/*`, and `/ws`, and dispatches typed `HaloCommand` syscalls verified and SHA-256 hash-chained by `KernelCommandBus`.

## HUD Map (10 Modules)
1. **Agent Command Ring (`agent-ring`)** — Multi-select rotating ring (`Shift+Click`), spawn, clone, pause, resume, kill, attach skills, set spend cap, and live `<NeuralNetworkView />` node inspection.
2. **Mission Control (`mission-control`)** — Interactive layered SVG Task DAG, NL objective decomposition, dependency edges, split/retry/cancel, critical-path ETA, and budget burn.
3. **Voice & Comms (`voice-comms`)** — Push-to-talk Web Speech STT/TTS, deterministic wake-word routing, and targeted agent/fleet directives.
4. **Environment Deck (`environment-deck`)** — Biome theme, weather, time-of-day, gravity scale, 3D prop builder with undo, 3D Zones & Rules, and Scene Snapshots save/restore.
5. **Process & Scheduler (`process-monitor`)** — Host CPU/RSS/Token sparklines, process table, cron/event scheduler triggers, throttle/kill syscalls.
6. **Memory Atlas (`memory-atlas`)** — Category-clustered semantic projection, search, edit, pin, redact, delete, and decision lineage.
7. **Security & Approvals (`security-approvals`)** — Pending syscall approval queue with diff preview (`Approve Once` / `Always Allow 1h` / `Deny`), capability matrix, prompt-injection alerts, SHA-256 tamper-evident audit chain verifier & JSON export, and Global **KILL SWITCH**.
8. **Telemetry & Insight (`telemetry-insight`)** — Spend, latency, success rate KPIs, per-agent token bars, and Trace Explorer with live **What-If** re-run.
9. **Automation Studio (`automation-studio`)** — Visual workflow node/edge builder compiling topologically into `ProjectTask[]` DAGs.
10. **Multiverse Navigator (`multiverse`)** — Fork isolated sandbox worlds, switch, diff object/zone counts against Prime Reality, merge, or discard.

## Synced Form Factors
- `flat`: Full-featured 2D screen-space HUD (desktop & mobile accessibility baseline).
- `wrist`: Compact Wrist/Palm HUD (`Tab`) with vitals, approvals badge, and emergency Kill Switch.
- `dome`: 3D wraparound holographic shader panels (`HALO_PANEL_VERTEX_SHADER` / `HALO_PANEL_FRAGMENT_SHADER`) with thickness frames and minimize-to-orb toggles.
- `table`: Tabletop 3D Holo Table map pedestal with live clickable agent markers.
- `shared`: Multi-user LWW-CRDT cursor & selection sync over `/ws`.

## Hotkeys
- `Ctrl/Cmd + K`: Toggle HALO Command Palette (fuzzy search, raw syscall runner, macro record/replay, undo).
- `Tab`: Toggle Wrist / Palm HUD.
- `Ctrl + Shift + X`: Trigger Global KILL SWITCH immediately.
- `H`: Collapse/expand bottom control dock.
- `Esc`: Close palette or active HUD drawer.

## Voice Command Grammar (`parseVoiceDirective`)
- `"halo spawn agent Orion role Analyst"` -> `agent.spawn`
- `"halo pause Kestrel"` / `"halo resume Kestrel"` / `"halo kill Kestrel"`
- `"halo weather rain"` / `"halo weather ion-storm"`
- `"halo open mission control"` / `"halo show memory atlas"`
- `"halo mode dome"` / `"halo mode table"` / `"halo mode flat"`
- `"halo kill switch"` / `"halo resume system"`
- `"tell Aegis run security sweep"` -> targeted `agent.chat`

## Typed Syscall Format
```ts
{
  id: 'cmd-...',
  actor: 'Operator-01',
  target: 'agent-kestrel',
  verb: 'agent.pause',
  args: {},
  requiresApproval: false,
  timestamp: 1730000000000
}
```
High-risk verbs (`agent.kill`, `net.egress`, `code.exec`, `wallet.sign`, `finance.approve`, `memory.delete`, `process.kill`, `agent.permission.grant`) automatically pause in the **Security & Approval Center** unless covered by an active time-bounded grant.

## Registering a Custom HUD Plugin Module
```ts
import { haloStore } from 'packages/halo';

haloStore.registerPluginModule({
  id: 'custom-gpu-profiler',
  title: 'GPU Kernel Profiler',
  description: 'Displays WebGL shader pass timings',
  requiredVerb: 'hud.module',
  renderSummary: () => 'WebGL Pass: 2.1ms · 0 dropped frames',
});
```
