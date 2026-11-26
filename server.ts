import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { OsStateStore } from './src/server/stateStore';
import {
  decomposeProjectObjective,
  generateWorkspaceCode,
  isGeminiConfigured,
  runAgentTurn,
  runCentralCommand,
  runWebResearchGrounded,
} from './src/server/aiGateway';
import {
  ensureSandboxInitialized,
  executeSandboxCommand,
  listSandboxFiles,
  readSandboxFile,
  writeSandboxFile,
} from './src/server/terminalSandbox';
import {
  claimOrVerifyAdminPasscode,
  decryptSecretInternal,
  deleteSecret,
  getSessionFromHeader,
  isAdminClaimed,
  listMaskedSecrets,
  revokeSession,
  storeEncryptedSecret,
} from './src/server/vault';
import {
  getRunnableTasks,
  sanitizeUntrustedWebText,
  selectBestAgentForTask,
  validateExternalUrl,
} from './src/utils/orchestratorLogic';
import { buildImplementationRoadmap, MEDIA_STORAGE_DIR, WorldPresenceStore } from './src/server/worldPresence';
import { collectHostWorkstationMetrics } from './src/server/workstationMetrics';
import { fetchGodsEyeSnapshot, geocodeLocation } from './src/server/godsEyeService';
import { JarvisOperationsEngine } from './src/server/jarvisCommandEngine';
import { validateMediaUpload } from './src/utils/worldEnhancements';
import { KernelCommandBus, verifyAuditChain } from './src/server/kernelBus';
import { createHaloCommand } from './packages/halo/commandBus';
import { VcaOsBackendService } from './src/server/vcaOsService';
import { createLiveKitParticipantToken, getLiveKitVoiceConfig } from './src/server/livekitVoiceService';
import { attachGeminiLiveSession } from './src/server/geminiLiveBridge';
import type {
  AgentProfile,
  ClientWsEvent,
  JarvisDomainId,
  JarvisHologramModelId,
  MemoryItem,
  OutboundCommDraft,
  ProjectRecord,
  ProjectTask,
  ServerWsEvent,
} from './src/types/os';

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const liveWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/live') {
    liveWss.handleUpgrade(request, socket, head, (ws) => {
      liveWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});
const store = new OsStateStore();
const worldStore = new WorldPresenceStore();
const kernelBus = new KernelCommandBus(store, worldStore);
const jarvisEngine = new JarvisOperationsEngine(store);
const vcaOsService = new VcaOsBackendService();

ensureSandboxInitialized();

function broadcast(event: ServerWsEvent) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

store.setBroadcaster(broadcast);

let nextSocketSeq = 1;

wss.on('connection', (ws) => {
  const playerId = `op-${Date.now().toString(36)}-${nextSocketSeq++}`;
  const telemetry = store.getTelemetry(wss.clients.size);
  ws.send(JSON.stringify({ type: 'telemetry:update', telemetry, regions: store.regions } satisfies ServerWsEvent));

  // Auto-register player into world presence and send full snapshot
  worldStore.joinPlayer(playerId);
  ws.send(
    JSON.stringify({
      type: 'world:welcome',
      selfId: playerId,
      players: worldStore.getPlayerList(),
      objects: worldStore.objects,
      chat: worldStore.chat,
      skybox: worldStore.skybox,
    } satisfies ServerWsEvent),
  );
  broadcast({ type: 'world:players', players: worldStore.getPlayerList() });

  ws.on('message', (rawBuf) => {
    try {
      const msg = JSON.parse(rawBuf.toString()) as ClientWsEvent;
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'world:join') {
        worldStore.joinPlayer(playerId, msg.callsign, msg.avatarColor, msg.position);
        broadcast({ type: 'world:players', players: worldStore.getPlayerList() });
      } else if (msg.type === 'world:move') {
        if (Array.isArray(msg.position) && msg.position.length === 3) {
          worldStore.movePlayer(playerId, msg.position, Number(msg.yaw ?? 0));
          broadcast({ type: 'world:players', players: worldStore.getPlayerList() });
        }
      } else if (msg.type === 'world:emote') {
        worldStore.setEmote(playerId, msg.emote);
        broadcast({ type: 'world:players', players: worldStore.getPlayerList() });
      } else if (msg.type === 'world:chat') {
        const entry = worldStore.addChatMessage(playerId, String(msg.text || ''), Number(msg.radius ?? 18));
        if (entry) {
          broadcast({ type: 'world:chat', message: entry });
        }
      } else if (msg.type === 'world:place-object' && msg.object) {
        const placed = worldStore.placeObject(msg.object);
        broadcast({ type: 'world:objects', objects: worldStore.objects });
        store.addActivity({
          agentId: 'central',
          agentName: placed.ownerCallsign,
          stage: 'World Build',
          tool: 'Aether District',
          message: `Placed ${placed.kind} "${placed.label}" at (${placed.position[0]}, ${placed.position[2]}).`,
          severity: 'info',
        });
      } else if (msg.type === 'world:move-object' && msg.id && Array.isArray(msg.position)) {
        const moved = worldStore.moveObject(msg.id, msg.position, msg.rotationY);
        if (moved) {
          broadcast({ type: 'world:objects', objects: worldStore.objects });
        }
      } else if (msg.type === 'world:update-object' && msg.id && msg.patch) {
        const updated = worldStore.updateObject(msg.id, msg.patch);
        if (updated) {
          broadcast({ type: 'world:objects', objects: worldStore.objects });
        }
      } else if (msg.type === 'world:remove-object' && msg.id) {
        if (worldStore.removeObject(msg.id)) {
          broadcast({ type: 'world:objects', objects: worldStore.objects });
        }
      } else if (msg.type === 'world:skybox' && msg.skybox) {
        const skybox = worldStore.setSkybox(msg.skybox);
        broadcast({ type: 'world:skybox', skybox });
      } else if (msg.type === 'halo:cursor') {
        broadcast({
          type: 'halo:cursor',
          cursor: {
            actorId: playerId,
            callsign: String(msg.callsign || 'Operator'),
            color: String(msg.color || '#22d3ee'),
            x: Math.max(0, Math.min(1, Number(msg.x ?? 0.5))),
            y: Math.max(0, Math.min(1, Number(msg.y ?? 0.5))),
            activeModule: String(msg.activeModule || 'agent-ring'),
            selectedTargetId: msg.selectedTargetId ? String(msg.selectedTargetId) : null,
            lamport: Number(msg.lamport ?? Date.now()),
            updatedAt: Date.now(),
          },
        });
      }
    } catch {
      // Ignore malformed client WS messages
    }
  });

  ws.on('close', () => {
    if (worldStore.removePlayer(playerId)) {
      broadcast({ type: 'world:players', players: worldStore.getPlayerList() });
    }
  });
});

liveWss.on('connection', (ws) => {
  attachGeminiLiveSession(ws, store);
});

// Real-time telemetry interval (only sends measured host & AI gateway stats)
setInterval(() => {
  store.decayRegionLoads();
  const telemetry = store.getTelemetry(wss.clients.size);
  store.recordTelemetryPoint(telemetry);
  broadcast({ type: 'telemetry:update', telemetry, regions: store.regions });
}, 3000);

// ---------- API Routes ----------

app.get('/api/bootstrap', (_req, res) => {
  const telemetry = store.getTelemetry(wss.clients.size);
  res.json({
    agents: store.agents,
    projects: store.projects,
    activityLogs: store.activityLogs,
    memories: store.memories,
    plugins: store.plugins,
    integrations: store.integrations,
    commDrafts: store.commDrafts,
    financialRequests: store.financialRequests,
    regions: store.regions,
    telemetry,
    telemetryHistory: store.telemetryHistory,
    vaultClaimed: isAdminClaimed(),
    secrets: listMaskedSecrets(),
    geminiConfigured: isGeminiConfigured(),
    worldPlayers: worldStore.getPlayerList(),
    worldObjects: worldStore.objects,
    worldChat: worldStore.chat,
    worldSkybox: worldStore.skybox,
    roadmap: buildImplementationRoadmap(store.integrations, isAdminClaimed(), isGeminiConfigured()),
    kernel: kernelBus.getSnapshot(),
  });
});

app.get('/api/workstation/metrics', (_req, res) => {
  const activeAgents = store.agents.filter((a) => a.status !== 'idle').length;
  const avgLoad =
    store.regions.length > 0
      ? store.regions.reduce((sum, r) => sum + r.load, 0) / store.regions.length
      : 0;
  const metrics = collectHostWorkstationMetrics(activeAgents, avgLoad);
  res.json({
    metrics,
    activeAgents,
    totalAgents: store.agents.length,
    runningTasks: store.projects.flatMap((p) => p.tasks).filter((t) => t.status === 'in-progress').length,
    vaultClaimed: isAdminClaimed(),
    geminiConfigured: isGeminiConfigured(),
  });
});

app.get('/api/gods-eye/snapshot', async (req, res) => {
  const lat = Number(req.query.lat ?? 37.7749);
  const lon = Number(req.query.lon ?? -122.4194);
  const snapshot = await fetchGodsEyeSnapshot(
    Number.isFinite(lat) ? lat : 37.7749,
    Number.isFinite(lon) ? lon : -122.4194,
  );
  res.json(snapshot);
});

app.get('/api/gods-eye/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.status(400).json({ error: 'Search query q is required.' });
    return;
  }
  const results = await geocodeLocation(q);
  res.json({ results });
});

// JARVIS Command Center Operations Engine
app.get('/api/jarvis/state', (_req, res) => {
  res.json(jarvisEngine.getSnapshot());
});

app.post('/api/jarvis/dispatch', async (req, res) => {
  if (kernelBus.killSwitchActive) {
    res.status(423).json({ error: 'Global KILL SWITCH is active. Resume system in HALO Security Center first.' });
    return;
  }
  const { prompt, domain } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'JARVIS command prompt is required.' });
    return;
  }
  const requestedDomain: JarvisDomainId =
    domain === 'security' ||
    domain === 'engineering' ||
    domain === 'development' ||
    domain === 'finance' ||
    domain === 'science' ||
    domain === 'business' ||
    domain === 'medical'
      ? domain
      : 'core';

  const entry = await jarvisEngine.dispatchCommand(
    prompt.trim(),
    requestedDomain,
    broadcast,
    async (cleanPrompt, dom, sysContext) => {
      return runCentralCommand(
        `[JARVIS DOMAIN: ${dom.toUpperCase()}]\nOperator Request: ${cleanPrompt}`,
        sysContext,
      );
    },
  );
  res.json({ entry, state: jarvisEngine.getSnapshot() });
});

app.post('/api/jarvis/hologram', (req, res) => {
  const { model, explodeFactor, heatmap, scanSubnet } = req.body ?? {};
  if (scanSubnet) {
    jarvisEngine.scanNetworkTopology(broadcast);
    res.json({ hologram: jarvisEngine.hologram, state: jarvisEngine.getSnapshot() });
    return;
  }
  const allowedModel: JarvisHologramModelId | undefined =
    model === 'neural-lattice' || model === 'methane' || model === 'stark-gear' || model === 'network-topology'
      ? model
      : undefined;
  const hologram = jarvisEngine.setHologram(
    {
      model: allowedModel,
      explodeFactor: typeof explodeFactor === 'number' ? explodeFactor : undefined,
      heatmap: typeof heatmap === 'boolean' ? heatmap : undefined,
    },
    broadcast,
  );
  res.json({ hologram, state: jarvisEngine.getSnapshot() });
});

app.post('/api/jarvis/reminders', (req, res) => {
  const { title, when, delayMs } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'Reminder title is required.' });
    return;
  }
  const reminder = jarvisEngine.scheduleReminder(
    title.trim(),
    typeof delayMs === 'number' && Number.isFinite(delayMs) ? delayMs : String(when || 'in 15s'),
    broadcast,
  );
  res.json({ reminder, state: jarvisEngine.getSnapshot() });
});

app.delete('/api/jarvis/reminders/:id', (req, res) => {
  const deleted = jarvisEngine.deleteReminder(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Reminder not found.' });
    return;
  }
  res.json({ ok: true, state: jarvisEngine.getSnapshot() });
});

app.get('/api/jarvis/voice/config', (_req, res) => {
  res.json(getLiveKitVoiceConfig());
});

app.post('/api/jarvis/voice/token', (req, res) => {
  const cfg = getLiveKitVoiceConfig();
  if (!cfg.configured) {
    res.status(400).json({ error: cfg.reason || 'LiveKit is not configured.', config: cfg });
    return;
  }
  const { roomName, participantIdentity, participantName } = req.body ?? {};
  try {
    const issued = createLiveKitParticipantToken({
      roomName: typeof roomName === 'string' && roomName.trim() ? roomName.trim() : 'vca-jarvis-voice',
      participantIdentity:
        typeof participantIdentity === 'string' && participantIdentity.trim()
          ? participantIdentity.trim()
          : `operator-${Date.now().toString(36)}`,
      participantName: typeof participantName === 'string' ? participantName : undefined,
    });
    res.json(issued);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to create LiveKit token.' });
  }
});

app.get('/api/kernel/state', (_req, res) => {
  res.json({
    kernel: kernelBus.getSnapshot(),
    agents: store.agents,
    projects: store.projects,
    memories: store.memories,
    worldObjects: worldStore.objects,
  });
});

app.post('/api/kernel/command', async (req, res) => {
  const cmd = req.body?.command ?? req.body;
  const result = await kernelBus.dispatchCommand(cmd);
  broadcast({ type: 'halo:state', snapshot: kernelBus.getSnapshot() });
  res.status(result.ok ? 200 : 400).json({
    result,
    kernel: kernelBus.getSnapshot(),
    agents: store.agents,
    projects: store.projects,
    memories: store.memories,
    worldObjects: worldStore.objects,
  });
});

app.post('/api/kernel/approvals/:id/decision', async (req, res) => {
  const decision = req.body?.decision;
  if (decision !== 'approve-once' && decision !== 'always-allow' && decision !== 'deny') {
    res.status(400).json({ error: 'Decision must be approve-once, always-allow, or deny.' });
    return;
  }
  const actor = typeof req.body?.decidedBy === 'string' ? req.body.decidedBy : 'Operator-01';
  const expiryMinutes = Number(req.body?.expiryMinutes ?? 60);
  const outcome = await kernelBus.decideApproval(req.params.id, decision, actor, expiryMinutes);
  if (!outcome) {
    res.status(404).json({ error: 'Approval request not found.' });
    return;
  }
  broadcast({ type: 'halo:state', snapshot: kernelBus.getSnapshot() });
  res.json({
    ...outcome,
    kernel: kernelBus.getSnapshot(),
    agents: store.agents,
    projects: store.projects,
    memories: store.memories,
    worldObjects: worldStore.objects,
  });
});

app.get('/api/kernel/audit/verify', (_req, res) => {
  const verification = verifyAuditChain(kernelBus.auditChain);
  res.json({
    ...verification,
    entriesCount: kernelBus.auditChain.length,
    auditChain: kernelBus.auditChain,
  });
});

app.post('/api/kernel/trace-replay', async (req, res) => {
  const { agentId, prompt } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'Prompt is required for trace replay.' });
    return;
  }
  const cmd = createHaloCommand({
    actor: 'WhatIf-Replay',
    target: String(agentId || store.agents[0]?.id || 'agent-aegis'),
    verb: 'agent.chat',
    args: { message: prompt.trim() },
  });
  const result = await kernelBus.dispatchCommand(cmd);
  broadcast({ type: 'halo:state', snapshot: kernelBus.getSnapshot() });
  res.status(result.ok ? 200 : 400).json({
    result,
    kernel: kernelBus.getSnapshot(),
  });
});

app.get('/api/world/state', (_req, res) => {
  res.json({
    players: worldStore.getPlayerList(),
    objects: worldStore.objects,
    chat: worldStore.chat,
    skybox: worldStore.skybox,
  });
});

// Safe Local Media Upload & Static Serving for 3D Screens (Image, GIF, Video)
app.post(
  '/api/media/upload',
  express.raw({ type: ['image/*', 'video/*'], limit: '20mb' }),
  (req, res) => {
    const contentType = String(req.headers['content-type'] || '');
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = validateMediaUpload({
      mimeType: contentType,
      byteLength: buf.byteLength,
      originalName: String(req.headers['x-file-name'] || ''),
    });
    if (!check.valid || !check.ext || !check.mediaType) {
      res.status(400).json({ error: check.reason || 'Invalid media upload.' });
      return;
    }

    try {
      if (!fs.existsSync(MEDIA_STORAGE_DIR)) {
        fs.mkdirSync(MEDIA_STORAGE_DIR, { recursive: true });
      }
      const id = `media-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
      const filename = `${id}.${check.ext}`;
      const targetPath = path.resolve(MEDIA_STORAGE_DIR, filename);
      if (!targetPath.startsWith(MEDIA_STORAGE_DIR + path.sep)) {
        res.status(400).json({ error: 'Invalid storage path.' });
        return;
      }
      fs.writeFileSync(targetPath, buf);
      res.json({
        url: `/api/media/${filename}`,
        filename,
        mediaType: check.mediaType,
        size: buf.byteLength,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save uploaded media.' });
    }
  },
);

const EXT_CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

app.get('/api/media/:filename', (req, res) => {
  const safeName = path.basename(String(req.params.filename || ''));
  if (!/^[a-zA-Z0-9._-]+$/.test(safeName)) {
    res.status(400).json({ error: 'Invalid media filename.' });
    return;
  }
  const fullPath = path.resolve(MEDIA_STORAGE_DIR, safeName);
  if (!fullPath.startsWith(MEDIA_STORAGE_DIR + path.sep) || !fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Media asset not found.' });
    return;
  }
  const ext = path.extname(safeName).toLowerCase();
  res.setHeader('Content-Type', EXT_CONTENT_TYPE[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(fullPath);
});

app.get('/api/roadmap', (_req, res) => {
  res.json({
    roadmap: buildImplementationRoadmap(store.integrations, isAdminClaimed(), isGeminiConfigured()),
  });
});

// Auth & Multi-Tenant Session
app.post('/api/auth/session', (req, res) => {
  const { passcode, email, role } = req.body ?? {};
  if (typeof passcode !== 'string') {
    res.status(400).json({ error: 'Passcode is required.' });
    return;
  }
  const allowedRole = role === 'Admin' || role === 'Operator' || role === 'Viewer' ? role : 'Admin';
  const result = claimOrVerifyAdminPasscode(
    passcode,
    typeof email === 'string' && email.trim() ? email.trim() : 'vcaslabs@gmail.com',
    allowedRole,
  );
  if (!result.ok || !result.session) {
    res.status(401).json({ error: result.error ?? 'Authentication failed.' });
    return;
  }
  store.addActivity({
    agentId: 'agent-sentinel',
    agentName: 'Sentinel-05',
    stage: 'Auth',
    tool: 'Session Gate',
    message: `Operator session authenticated (${result.session.role}) for ${result.session.operatorEmail}.`,
    severity: 'success',
  });
  res.json({
    token: result.session.token,
    role: result.session.role,
    operatorEmail: result.session.operatorEmail,
    vaultClaimed: isAdminClaimed(),
  });
});

app.post('/api/auth/logout', (req, res) => {
  const session = getSessionFromHeader(req.headers.authorization);
  if (session) revokeSession(session.token);
  res.json({ ok: true });
});

function requireAdminSession(req: express.Request, res: express.Response): boolean {
  const session = getSessionFromHeader(req.headers.authorization);
  if (!session || session.role === 'Viewer') {
    res.status(401).json({ error: 'Operator Admin unlock required in Security Console to mutate vault or approvals.' });
    return false;
  }
  return true;
}

// Vault Secret Storage (AES-256-GCM)
app.post('/api/vault/secrets', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const { id, label, provider, value } = req.body ?? {};
  if (!id || !label || !provider || typeof value !== 'string' || !value.trim()) {
    res.status(400).json({ error: 'id, label, provider, and non-empty secret value are required.' });
    return;
  }
  const masked = storeEncryptedSecret(String(id), String(label), String(provider), value.trim());

  // Update corresponding integration status if matching
  const targetInt = store.integrations.find(
    (i) => i.id === id || i.category === provider || i.name.toLowerCase().includes(String(provider).toLowerCase()),
  );
  if (targetInt) {
    targetInt.status = 'connected';
    targetInt.endpointLabel = `Encrypted Vault Secret (${masked.maskedPreview})`;
    targetInt.lastCheckedAt = Date.now();
  }

  store.pulseRegion('security-gate', `Encrypted secret stored: ${label}`);
  store.addActivity({
    agentId: 'agent-sentinel',
    agentName: 'Sentinel-05',
    stage: 'Vault',
    tool: 'AES-256-GCM Vault',
    message: `Stored encrypted credential for ${label} (${masked.maskedPreview}).`,
    severity: 'success',
  });

  res.json({ secret: masked, integrations: store.integrations });
});

app.delete('/api/vault/secrets/:id', (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const deleted = deleteSecret(req.params.id);
  const targetInt = store.integrations.find((i) => i.id === req.params.id);
  if (targetInt) {
    targetInt.status = 'revoked';
    targetInt.endpointLabel = 'Access revoked by operator';
    targetInt.lastCheckedAt = Date.now();
  }
  store.addActivity({
    agentId: 'agent-sentinel',
    agentName: 'Sentinel-05',
    stage: 'Vault',
    tool: 'Access Revocation',
    message: `Revoked credential ${req.params.id}.`,
    severity: 'warning',
  });
  res.json({ deleted, secrets: listMaskedSecrets(), integrations: store.integrations });
});

// Central Intelligence Command
app.post('/api/central/command', async (req, res) => {
  const { prompt } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'Command prompt is required.' });
    return;
  }

  store.pulseRegion('reasoning-cortex', `Command: ${prompt.slice(0, 40)}`);
  store.addActivity({
    agentId: 'central',
    agentName: 'Central Core',
    stage: 'Reasoning',
    tool: 'Neural Link',
    message: `Received directive: "${prompt.trim()}"`,
    severity: 'info',
  });

  const sysContext = JSON.stringify({
    agents: store.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status, autonomy: a.autonomy })),
    activeProjects: store.projects.map((p) => ({ id: p.id, title: p.title, status: p.status })),
    integrations: store.integrations.map((i) => ({ name: i.name, status: i.status })),
    recentMemories: store.memories.slice(0, 5).map((m) => m.title),
  });

  try {
    const result = await runCentralCommand(prompt.trim(), sysContext);
    store.pulseRegion('memory-lattice', 'Synced central interaction');
    store.addActivity({
      agentId: 'central',
      agentName: 'Central Core',
      stage: 'Response',
      tool: 'Gemini Gateway',
      message: result.reply.slice(0, 160),
      severity: 'success',
      tokens: result.tokens,
      latencyMs: result.latencyMs,
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Central Intelligence request failed.';
    store.addActivity({
      agentId: 'central',
      agentName: 'Central Core',
      stage: 'Error',
      tool: 'Gemini Gateway',
      message: msg,
      severity: 'error',
    });
    res.status(502).json({ error: msg });
  }
});

// Agents CRUD & Direct Conversation
app.post('/api/agents', (req, res) => {
  const body = req.body ?? {};
  if (!body.name || !body.role) {
    res.status(400).json({ error: 'Agent name and role are required.' });
    return;
  }
  const idx = store.agents.length;
  const angle = (idx * 1.15) % (Math.PI * 2);
  const radius = 5.8;
  const created: AgentProfile = {
    id: body.id || `agent-${Date.now()}`,
    name: String(body.name).trim(),
    role: String(body.role).trim(),
    expertise: Array.isArray(body.expertise) ? body.expertise : ['general', 'analysis'],
    personality: String(body.personality || 'Analytical and collaborative'),
    systemPrompt: String(body.systemPrompt || `Act as ${body.role}.`),
    model: 'gemini-4-hydrogen',
    autonomy: body.autonomy === 'AUTONOMOUS' || body.autonomy === 'ASSISTED' ? body.autonomy : 'SUPERVISED',
    status: 'idle',
    currentObjective: 'Initialized and ready for delegation',
    currentStage: 'Standby',
    position: body.position ?? [Number((Math.cos(angle) * radius).toFixed(2)), 0, Number((Math.sin(angle) * radius).toFixed(2))],
    appearance: {
      chassisColor: body.appearance?.chassisColor || '#1E293B',
      accentColor: body.appearance?.accentColor || '#22D3EE',
      visorColor: body.appearance?.visorColor || '#38BDF8',
      wardrobeStyle: body.appearance?.wardrobeStyle || 'tactical-coat',
      expression: body.appearance?.expression || 'focused',
      heightScale: Number(body.appearance?.heightScale ?? 1.0),
      shoulderWidth: Number(body.appearance?.shoulderWidth ?? 1.0),
    },
    voice: {
      pitch: Number(body.voice?.pitch ?? 1.0),
      rate: Number(body.voice?.rate ?? 1.0),
      style: String(body.voice?.style || 'Balanced'),
      preferredVoiceName: body.voice?.preferredVoiceName,
    },
    permissions: {
      terminalRead: Boolean(body.permissions?.terminalRead ?? true),
      terminalWrite: Boolean(body.permissions?.terminalWrite ?? false),
      webBrowse: Boolean(body.permissions?.webBrowse ?? true),
      sendEmail: Boolean(body.permissions?.sendEmail ?? false),
      sendSms: Boolean(body.permissions?.sendSms ?? false),
      makeCalls: Boolean(body.permissions?.makeCalls ?? false),
      codeDeploy: Boolean(body.permissions?.codeDeploy ?? false),
      financialSpendLimitUsd: Number(body.permissions?.financialSpendLimitUsd ?? 25),
    },
    metrics: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0, avgLatencyMs: 0 },
    updatedAt: Date.now(),
  };

  store.agents.push(created);
  broadcast({ type: 'agent:updated', agent: created });
  store.addActivity({
    agentId: created.id,
    agentName: created.name,
    stage: 'Provisioned',
    tool: 'Agent Studio',
    message: `Created custom agent ${created.name} (${created.role}) [${created.autonomy}].`,
    severity: 'success',
  });
  res.json({ agent: created });
});

app.patch('/api/agents/:id', (req, res) => {
  const agent = store.agents.find((a) => a.id === req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found.' });
    return;
  }
  const patch = req.body ?? {};
  if (patch.name) agent.name = String(patch.name);
  if (patch.role) agent.role = String(patch.role);
  if (patch.personality) agent.personality = String(patch.personality);
  if (patch.systemPrompt) agent.systemPrompt = String(patch.systemPrompt);
  if (patch.autonomy) agent.autonomy = patch.autonomy;
  if (Array.isArray(patch.expertise)) agent.expertise = patch.expertise;
  if (patch.appearance) agent.appearance = { ...agent.appearance, ...patch.appearance };
  if (patch.voice) agent.voice = { ...agent.voice, ...patch.voice };
  if (patch.permissions) agent.permissions = { ...agent.permissions, ...patch.permissions };
  agent.updatedAt = Date.now();

  broadcast({ type: 'agent:updated', agent });
  store.addActivity({
    agentId: agent.id,
    agentName: agent.name,
    stage: 'Updated',
    tool: 'Agent Studio',
    message: `Updated configuration and 3D specification for ${agent.name}.`,
    severity: 'info',
  });
  res.json({ agent });
});

app.post('/api/agents/:id/chat', async (req, res) => {
  if (kernelBus.killSwitchActive) {
    res.status(423).json({ error: 'Global KILL SWITCH is active. Resume system in HALO Security Center first.' });
    return;
  }
  const agent = store.agents.find((a) => a.id === req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found.' });
    return;
  }
  const { message } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'Message is required.' });
    return;
  }

  agent.status = 'reasoning';
  agent.currentObjective = message.trim().slice(0, 70);
  agent.currentStage = 'Inference';
  broadcast({ type: 'agent:updated', agent });
  store.pulseRegion('reasoning-cortex', `${agent.name} reasoning`, agent.id);

  const relevantMem = store.memories
    .filter((m) => m.scope === 'central' || m.scope === agent.id)
    .slice(0, 4)
    .map((m) => `- [${m.category}] ${m.title}: ${m.content}`)
    .join('\n');

  try {
    const result = await runAgentTurn({
      agentName: agent.name,
      agentRole: agent.role,
      personality: agent.personality,
      systemPrompt: agent.systemPrompt,
      memoriesText: relevantMem,
      userMessage: message.trim(),
    });
    agent.status = 'idle';
    agent.currentStage = 'Standby';
    agent.metrics.tokensUsed += result.tokens;
    agent.metrics.avgLatencyMs = agent.metrics.avgLatencyMs
      ? Math.round((agent.metrics.avgLatencyMs + result.latencyMs) / 2)
      : result.latencyMs;
    agent.metrics.tasksCompleted += 1;
    broadcast({ type: 'agent:updated', agent });

    store.addActivity({
      agentId: agent.id,
      agentName: agent.name,
      stage: 'Conversation',
      tool: 'Gemini Gateway',
      message: result.reply.slice(0, 140),
      severity: 'success',
      tokens: result.tokens,
      latencyMs: result.latencyMs,
    });
    res.json({ reply: result.reply, tokens: result.tokens, latencyMs: result.latencyMs, agent });
  } catch (err) {
    agent.status = 'error';
    agent.currentStage = 'API Error';
    agent.metrics.tasksFailed += 1;
    broadcast({ type: 'agent:updated', agent });
    const msg = err instanceof Error ? err.message : 'Agent reasoning failed.';
    store.addActivity({
      agentId: agent.id,
      agentName: agent.name,
      stage: 'Error',
      tool: 'Gemini Gateway',
      message: msg,
      severity: 'error',
    });
    res.status(502).json({ error: msg });
  }
});

// Autonomous Project Creation & Multi-Agent Execution
async function executeProjectPipeline(projectId: string) {
  const project = store.projects.find((p) => p.id === projectId);
  if (!project) return;

  project.status = 'active';
  broadcast({ type: 'project:updated', project });

  let safetyLoop = 0;
  while (safetyLoop < 12) {
    if (kernelBus.killSwitchActive) {
      project.status = 'awaiting-approval';
      broadcast({ type: 'project:updated', project });
      return;
    }
    safetyLoop += 1;
    const runnable = getRunnableTasks(project.tasks);
    if (runnable.length === 0) break;

    for (const task of runnable) {
      if (task.requiresApproval) {
        task.status = 'awaiting-approval';
        project.status = 'awaiting-approval';
        broadcast({ type: 'project:updated', project });
        store.addActivity({
          agentId: task.assignedAgentId,
          agentName: store.agents.find((a) => a.id === task.assignedAgentId)?.name || 'Agent',
          stage: 'Approval Gate',
          tool: 'Project Engine',
          message: `Task "${task.title}" paused for operator approval.`,
          severity: 'warning',
        });
        return;
      }

      const agent = store.agents.find((a) => a.id === task.assignedAgentId) ?? store.agents[0];
      task.status = 'in-progress';
      task.startedAt = Date.now();
      agent.status = 'executing';
      agent.currentObjective = task.title;
      agent.currentStage = 'Executing Task';
      broadcast({ type: 'agent:updated', agent });
      broadcast({ type: 'project:updated', project });
      store.pulseRegion('planning-engine', `Executing: ${task.title}`, agent.id);

      try {
        const depOutputs = task.dependsOn
          .map((depId) => project.tasks.find((t) => t.id === depId))
          .filter(Boolean)
          .map((t) => `Prior task "${t!.title}": ${t!.output || 'Done'}`)
          .join('\n');

        const result = await runAgentTurn({
          agentName: agent.name,
          agentRole: agent.role,
          personality: agent.personality,
          systemPrompt: agent.systemPrompt,
          memoriesText: depOutputs,
          userMessage: `Project Objective: ${project.objective}\n\nAssigned Task: ${task.title}\nDetails: ${task.description}\nProvide a concise, concrete deliverable summary.`,
        });

        task.status = 'completed';
        task.completedAt = Date.now();
        task.output = result.reply;
        agent.status = 'idle';
        agent.currentStage = 'Standby';
        agent.metrics.tasksCompleted += 1;
        agent.metrics.tokensUsed += result.tokens;
        agent.metrics.avgLatencyMs = agent.metrics.avgLatencyMs
          ? Math.round((agent.metrics.avgLatencyMs + result.latencyMs) / 2)
          : result.latencyMs;

        broadcast({ type: 'agent:updated', agent });
        broadcast({ type: 'project:updated', project });
        store.pulseRegion('tool-bus', `Completed: ${task.title}`, agent.id);
        store.addActivity({
          agentId: agent.id,
          agentName: agent.name,
          stage: 'Task Completed',
          tool: 'Autonomous Orchestrator',
          message: `${task.title} completed.`,
          severity: 'success',
          tokens: result.tokens,
          latencyMs: result.latencyMs,
        });
      } catch (err) {
        task.status = 'failed';
        task.output = err instanceof Error ? err.message : 'Execution failed';
        project.status = 'failed';
        agent.status = 'error';
        agent.metrics.tasksFailed += 1;
        broadcast({ type: 'agent:updated', agent });
        broadcast({ type: 'project:updated', project });
        store.addActivity({
          agentId: agent.id,
          agentName: agent.name,
          stage: 'Task Failed',
          tool: 'Autonomous Orchestrator',
          message: task.output,
          severity: 'error',
        });
        return;
      }
    }
  }

  const allDone = project.tasks.every((t) => t.status === 'completed');
  if (allDone) {
    project.status = 'completed';
    project.milestones.forEach((m) => {
      m.completed = true;
    });
    project.finalReport = project.tasks.map((t) => `• ${t.title}: ${(t.output || '').slice(0, 180)}`).join('\n');
    project.updatedAt = Date.now();
    broadcast({ type: 'project:updated', project });
  }
}

app.post('/api/projects', async (req, res) => {
  const { objective } = req.body ?? {};
  if (typeof objective !== 'string' || !objective.trim()) {
    res.status(400).json({ error: 'Project objective is required.' });
    return;
  }

  store.pulseRegion('planning-engine', 'Decomposing project objective');
  try {
    const plan = await decomposeProjectObjective(objective.trim());
    const idPrefix = `t-${Date.now()}`;
    const rawTasks = plan.tasks.map((draft, i) => {
      const chosen = selectBestAgentForTask(`${draft.title} ${draft.requiredExpertise} ${draft.description}`, store.agents);
      return {
        id: `${idPrefix}-${i}`,
        title: draft.title,
        description: draft.description,
        assignedAgentId: chosen?.id ?? store.agents[0].id,
        dependsOn: (draft.dependsOnIndex ?? [])
          .filter((depIdx) => depIdx >= 0 && depIdx < i)
          .map((depIdx) => `${idPrefix}-${depIdx}`),
        status: 'queued' as const,
        priority: draft.priority || 'medium',
        requiresApproval: Boolean(draft.requiresApproval),
        estimatedMinutes: Number(draft.estimatedMinutes || 3),
      } satisfies ProjectTask;
    });

    const project: ProjectRecord = {
      id: `proj-${Date.now()}`,
      title: plan.title,
      objective: objective.trim(),
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tasks: rawTasks,
      milestones: plan.milestones.map((m, idx) => ({ id: `m-${idx}`, title: m, completed: false })),
      teamAgentIds: Array.from(new Set(rawTasks.map((t) => t.assignedAgentId))),
    };

    store.projects.unshift(project);
    broadcast({ type: 'project:updated', project });
    store.addActivity({
      agentId: 'central',
      agentName: 'Central Core',
      stage: 'Project Planned',
      tool: 'Planning Engine',
      message: `Formed team of ${project.teamAgentIds.length} agents for "${project.title}" (${project.tasks.length} tasks).`,
      severity: 'info',
      tokens: plan.tokens,
      latencyMs: plan.latencyMs,
    });

    // Kick off asynchronous autonomous execution
    void executeProjectPipeline(project.id);
    res.json({ project });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Project planning failed.';
    res.status(502).json({ error: msg });
  }
});

app.post('/api/projects/:id/approve-task/:taskId', (req, res) => {
  const project = store.projects.find((p) => p.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const task = project.tasks.find((t) => t.id === req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }
  task.requiresApproval = false;
  task.status = 'queued';
  project.status = 'active';
  broadcast({ type: 'project:updated', project });
  void executeProjectPipeline(project.id);
  res.json({ project });
});

// Virtual Computer Terminal & File Workspace
app.get('/api/workspace/files', (_req, res) => {
  res.json({ files: listSandboxFiles() });
});

app.get('/api/workspace/file', (req, res) => {
  const relPath = String(req.query.path || '');
  try {
    const content = readSandboxFile(relPath);
    res.json({ path: relPath, content });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to read file.' });
  }
});

app.post('/api/workspace/file', (req, res) => {
  const { path: relPath, content } = req.body ?? {};
  if (typeof relPath !== 'string' || typeof content !== 'string') {
    res.status(400).json({ error: 'path and content are required.' });
    return;
  }
  try {
    const node = writeSandboxFile(relPath, content);
    store.pulseRegion('tool-bus', `Saved ${node.path}`);
    store.addActivity({
      agentId: 'agent-kestrel',
      agentName: 'Kestrel-03',
      stage: 'Code Studio',
      tool: 'Workspace FS',
      message: `Updated sandbox file ${node.path} (${node.size} bytes).`,
      severity: 'info',
    });
    res.json({ file: node, files: listSandboxFiles() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to write file.' });
  }
});

app.post('/api/workspace/ai-code', async (req, res) => {
  const { path: relPath, instruction } = req.body ?? {};
  if (typeof relPath !== 'string' || typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'path and instruction are required.' });
    return;
  }
  let existingCode = '';
  try {
    existingCode = readSandboxFile(relPath);
  } catch {
    // New file
  }
  store.pulseRegion('tool-bus', `AI coding ${relPath}`, 'agent-kestrel');
  try {
    const result = await generateWorkspaceCode({ filePath: relPath, instruction: instruction.trim(), existingCode });
    const saved = writeSandboxFile(relPath, result.code);
    store.addActivity({
      agentId: 'agent-kestrel',
      agentName: 'Kestrel-03',
      stage: 'Code Generation',
      tool: 'Dev Studio',
      message: `${relPath}: ${result.summary}`,
      severity: 'success',
      tokens: result.tokens,
      latencyMs: result.latencyMs,
    });
    res.json({ file: saved, code: result.code, summary: result.summary, files: listSandboxFiles() });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'AI code generation failed.' });
  }
});

app.post('/api/terminal/exec', async (req, res) => {
  const { command } = req.body ?? {};
  if (typeof command !== 'string') {
    res.status(400).json({ error: 'Command string is required.' });
    return;
  }
  store.pulseRegion('tool-bus', `Exec: ${command.slice(0, 30)}`);
  const result = await executeSandboxCommand(command);
  store.addActivity({
    agentId: 'agent-kestrel',
    agentName: 'Kestrel-03',
    stage: 'Terminal',
    tool: 'Isolated Shell',
    message: `$ ${command} (exit ${result.exitCode}, ${result.durationMs}ms)`,
    severity: result.exitCode === 0 ? 'info' : 'warning',
    latencyMs: result.durationMs,
  });
  res.json(result);
});

// VCAOS (YukiOS Clone) Persistent OS State, Workspace & Config VFS
app.get('/api/vcaos/state', (_req, res) => {
  res.json(vcaOsService.getSnapshot());
});

app.post('/api/vcaos/state', (req, res) => {
  const { mode, activeWorkspace, tilingConfig } = req.body ?? {};
  const next = vcaOsService.updateState({ mode, activeWorkspace, tilingConfig });
  store.pulseRegion('tool-bus', `VCAOS: ${next.mode} WS-${next.activeWorkspace}`);
  res.json(next);
});

app.post('/api/vcaos/vfs', (req, res) => {
  const { path: relPath, content } = req.body ?? {};
  if (typeof relPath !== 'string' || typeof content !== 'string') {
    res.status(400).json({ error: 'path and content strings are required.' });
    return;
  }
  try {
    const next = vcaOsService.upsertVfsNode(relPath, content);
    store.pulseRegion('memory-lattice', `VCAOS VFS saved ${relPath}`);
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to write VFS node.' });
  }
});

app.delete('/api/vcaos/vfs', (req, res) => {
  const relPath = String(req.query.path || '');
  try {
    const next = vcaOsService.deleteVfsNode(relPath);
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to delete VFS node.' });
  }
});

// Web Intelligence (SSRF-guarded URL Fetch + Gemini Grounded Research)
app.post('/api/web/browse', async (req, res) => {
  const { url } = req.body ?? {};
  const check = validateExternalUrl(String(url || ''));
  if (!check.valid || !check.normalizedUrl) {
    res.status(400).json({ error: check.reason || 'Invalid URL' });
    return;
  }

  store.pulseRegion('tool-bus', `Browse: ${check.normalizedUrl}`, 'agent-vega');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(check.normalizedUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VCALABS-WebIntel/1.0' },
    });
    clearTimeout(timer);

    const raw = await response.text();
    const { cleanText, injectionWarning } = sanitizeUntrustedWebText(raw, 5000);

    if (injectionWarning) {
      kernelBus.recordInjectionAlert(
        check.normalizedUrl,
        cleanText,
        'Untrusted prompt-injection pattern detected and isolated',
      );
      broadcast({ type: 'halo:state', snapshot: kernelBus.getSnapshot() });
      store.pulseRegion('security-gate', 'Flagged untrusted prompt text on web page', 'agent-sentinel');
      store.addActivity({
        agentId: 'agent-sentinel',
        agentName: 'Sentinel-05',
        stage: 'Security Alert',
        tool: 'Web Sandbox',
        message: `Potential prompt-injection phrase detected and isolated from ${check.normalizedUrl}.`,
        severity: 'warning',
      });
    }

    res.json({
      url: check.normalizedUrl,
      status: response.status,
      contentType: response.headers.get('content-type') || 'text/plain',
      cleanText,
      injectionWarning,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Unable to fetch remote page.' });
  }
});

app.post('/api/web/research', async (req, res) => {
  const { query } = req.body ?? {};
  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'Research query is required.' });
    return;
  }
  store.pulseRegion('reasoning-cortex', `Web Research: ${query.slice(0, 35)}`, 'agent-vega');
  try {
    const result = await runWebResearchGrounded(query.trim());
    store.addActivity({
      agentId: 'agent-vega',
      agentName: 'Vega-02',
      stage: 'Web Research',
      tool: 'Google Search Grounding',
      message: `Completed grounded research for "${query.trim()}" (${result.sources.length} sources).`,
      severity: 'success',
      tokens: result.tokens,
      latencyMs: result.latencyMs,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Web research failed.' });
  }
});

// Memory CRUD
app.post('/api/memories', (req, res) => {
  const body = req.body ?? {};
  if (!body.title || !body.content) {
    res.status(400).json({ error: 'Memory title and content are required.' });
    return;
  }
  const item: MemoryItem = {
    id: body.id || `mem-${Date.now()}`,
    scope: String(body.scope || 'central'),
    category: body.category || 'verified-fact',
    title: String(body.title).trim(),
    content: String(body.content).trim(),
    tags: Array.isArray(body.tags) ? body.tags : [],
    confidence: Number(body.confidence ?? 0.9),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.memories.unshift(item);
  store.pulseRegion('memory-lattice', `Stored: ${item.title}`);
  res.json({ memory: item });
});

app.delete('/api/memories/:id', (req, res) => {
  const idx = store.memories.findIndex((m) => m.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Memory not found.' });
    return;
  }
  store.memories.splice(idx, 1);
  res.json({ ok: true });
});

// Plugin Registry
app.post('/api/plugins/:id/toggle', (req, res) => {
  const plugin = store.plugins.find((p) => p.id === req.params.id);
  if (!plugin) {
    res.status(404).json({ error: 'Plugin not found.' });
    return;
  }
  if (!plugin.installed) {
    plugin.installed = true;
    plugin.enabled = true;
    plugin.healthStatus = 'healthy';
  } else {
    plugin.enabled = !plugin.enabled;
    plugin.healthStatus = plugin.enabled ? 'healthy' : 'disabled';
  }
  plugin.updatedAt = Date.now();
  store.addActivity({
    agentId: 'agent-sentinel',
    agentName: 'Sentinel-05',
    stage: 'Plugin Registry',
    tool: 'Extension Bus',
    message: `${plugin.name} ${plugin.enabled ? 'enabled' : 'disabled'} (v${plugin.version}).`,
    severity: 'info',
  });
  res.json({ plugin, plugins: store.plugins });
});

app.post('/api/plugins', (req, res) => {
  const { name, description, sourceRepo, permissions } = req.body ?? {};
  if (!name || !description) {
    res.status(400).json({ error: 'Plugin name and description are required.' });
    return;
  }
  const created = {
    id: `plugin-${Date.now()}`,
    name: String(name).trim(),
    version: '1.0.0',
    description: String(description).trim(),
    author: 'Operator Proposal',
    sourceRepo: String(sourceRepo || 'custom/local-extension'),
    permissions: Array.isArray(permissions) ? permissions : ['sandbox:read'],
    dependencies: [],
    installed: true,
    enabled: false,
    healthStatus: 'needs-config' as const,
    securityReviewed: false,
    updatedAt: Date.now(),
  };
  store.plugins.push(created);
  res.json({ plugin: created, plugins: store.plugins });
});

// Communications Queue & Approval Dispatch
app.post('/api/comms/draft', (req, res) => {
  const { channel, agentId, recipient, subject, body } = req.body ?? {};
  if (!recipient || !body) {
    res.status(400).json({ error: 'Recipient and body are required.' });
    return;
  }
  const agent = store.agents.find((a) => a.id === agentId) ?? store.agents[3];
  const draft: OutboundCommDraft = {
    id: `comm-${Date.now()}`,
    channel: channel === 'sms' || channel === 'voice-call' ? channel : 'email',
    agentId: agent.id,
    agentName: agent.name,
    recipient: String(recipient).trim(),
    subject: subject ? String(subject).trim() : undefined,
    body: String(body).trim(),
    status: 'pending-approval',
    statusNote: 'Awaiting operator authorization before dispatch.',
    createdAt: Date.now(),
  };
  store.commDrafts.unshift(draft);
  broadcast({ type: 'comm:updated', draft });
  res.json({ draft });
});

app.post('/api/comms/:id/decision', async (req, res) => {
  const draft = store.commDrafts.find((d) => d.id === req.params.id);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found.' });
    return;
  }
  const { decision } = req.body ?? {};
  if (decision === 'reject') {
    draft.status = 'rejected';
    draft.statusNote = 'Rejected by operator.';
    broadcast({ type: 'comm:updated', draft });
    res.json({ draft });
    return;
  }

  // Real check: only mark dispatched if webhook/vault provider exists
  const webhookUrl =
    draft.channel === 'email'
      ? process.env.EMAIL_WEBHOOK_URL || decryptSecretInternal('int-email')
      : process.env.TELEPHONY_WEBHOOK_URL || decryptSecretInternal('int-telephony');

  if (!webhookUrl) {
    draft.status = 'blocked-unconfigured';
    draft.statusNote =
      draft.channel === 'email'
        ? 'No EMAIL_WEBHOOK_URL or Email provider token configured in Security Vault.'
        : 'No TELEPHONY_WEBHOOK_URL or Telephony API token configured in Security Vault.';
    broadcast({ type: 'comm:updated', draft });
    res.status(400).json({ error: draft.statusNote, draft });
    return;
  }

  const urlCheck = validateExternalUrl(webhookUrl);
  if (!urlCheck.valid || !urlCheck.normalizedUrl) {
    draft.status = 'blocked-unconfigured';
    draft.statusNote = `Configured endpoint failed safety validation: ${urlCheck.reason}`;
    broadcast({ type: 'comm:updated', draft });
    res.status(400).json({ error: draft.statusNote, draft });
    return;
  }

  try {
    const resp = await fetch(urlCheck.normalizedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: draft.channel,
        recipient: draft.recipient,
        subject: draft.subject,
        body: draft.body,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Provider returned HTTP ${resp.status}`);
    }
    draft.status = 'dispatched';
    draft.statusNote = `Dispatched via configured provider at ${new Date().toLocaleTimeString()}.`;
    broadcast({ type: 'comm:updated', draft });
    res.json({ draft });
  } catch (err) {
    draft.status = 'blocked-unconfigured';
    draft.statusNote = err instanceof Error ? err.message : 'Provider delivery failed.';
    broadcast({ type: 'comm:updated', draft });
    res.status(502).json({ error: draft.statusNote, draft });
  }
});

// Financial Governance & Spending Approvals
app.post('/api/finance/request', (req, res) => {
  const { vendor, service, amountUsd, billingCycle, rationale, agentId } = req.body ?? {};
  if (!vendor || !service || Number(amountUsd) <= 0) {
    res.status(400).json({ error: 'Vendor, service, and positive amountUsd are required.' });
    return;
  }
  const agent = store.agents.find((a) => a.id === agentId) ?? store.agents[0];
  const item = {
    id: `fin-${Date.now()}`,
    vendor: String(vendor),
    service: String(service),
    amountUsd: Number(amountUsd),
    billingCycle: billingCycle === 'one-time' || billingCycle === 'usage' ? billingCycle : 'monthly',
    requestedByAgentId: agent.id,
    requestedByAgentName: agent.name,
    rationale: String(rationale || 'Infrastructure scaling recommendation.'),
    status: 'pending-approval' as const,
    createdAt: Date.now(),
  };
  store.financialRequests.unshift(item);
  broadcast({ type: 'finance:updated', item });
  res.json({ item });
});

app.post('/api/finance/:id/decision', (req, res) => {
  const item = store.financialRequests.find((f) => f.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Financial request not found.' });
    return;
  }
  const { decision } = req.body ?? {};
  if (decision === 'approve') {
    if (store.monthlyCommittedUsd + item.amountUsd > store.monthlyBudgetUsd) {
      res.status(400).json({ error: 'Exceeds operator monthly spending cap.' });
      return;
    }
    item.status = 'approved';
    if (item.billingCycle === 'monthly') {
      store.monthlyCommittedUsd += item.amountUsd;
    }
    store.addActivity({
      agentId: 'agent-sentinel',
      agentName: 'Sentinel-05',
      stage: 'Finance Approved',
      tool: 'Spend Governance',
      message: `Approved ${item.vendor} (${item.service}) for $${item.amountUsd}/${item.billingCycle}.`,
      severity: 'success',
    });
  } else {
    item.status = 'rejected';
    store.addActivity({
      agentId: 'agent-sentinel',
      agentName: 'Sentinel-05',
      stage: 'Finance Rejected',
      tool: 'Spend Governance',
      message: `Rejected spend request for ${item.vendor} ($${item.amountUsd}).`,
      severity: 'warning',
    });
  }
  broadcast({ type: 'finance:updated', item });
  res.json({ item, monthlyCommittedUsd: store.monthlyCommittedUsd, monthlyBudgetUsd: store.monthlyBudgetUsd });
});

app.post('/api/finance/budget', (req, res) => {
  const { monthlyBudgetUsd } = req.body ?? {};
  const val = Number(monthlyBudgetUsd);
  if (!Number.isFinite(val) || val < 0) {
    res.status(400).json({ error: 'Valid positive budget required.' });
    return;
  }
  store.monthlyBudgetUsd = val;
  res.json({ monthlyBudgetUsd: store.monthlyBudgetUsd });
});

// ---------- Vite / Static Serving ----------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VCALABS Command Environment listening on http://localhost:${PORT}`);
  });
}

void startServer();
