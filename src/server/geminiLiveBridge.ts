import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import type { WebSocket } from 'ws';
import type { AgentProfile } from '../types/os';
import type { OsStateStore } from './stateStore';
import { isGeminiConfigured } from './aiGateway';
import {
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_VOICES,
  type GeminiLiveVoiceName,
  type LivePersonaKind,
} from '../utils/geminiLiveAudio';

export type LiveClientInboundMessage =
  | { type: 'start'; voice?: string; persona?: string; agentId?: string }
  | { type: 'audio'; data: string }
  | { audio: string }
  | { type: 'text'; text: string }
  | { type: 'video'; data: string; mimeType?: string }
  | { type: 'stop' };

export function resolveLiveVoiceName(voice?: string): GeminiLiveVoiceName {
  if (voice && (GEMINI_LIVE_VOICES as readonly string[]).includes(voice)) {
    return voice as GeminiLiveVoiceName;
  }
  return 'Zephyr';
}

export function resolveLivePersonaKind(persona?: string): LivePersonaKind {
  if (persona === 'jarvis' || persona === 'agent') return persona;
  return 'central';
}

export function buildLiveSystemInstruction(params: {
  persona: LivePersonaKind;
  agent?: AgentProfile | null;
  activeAgentNames: string[];
  pendingTasksCount: number;
}): string {
  const opsSnapshot = `Live VCALABS telemetry: ${params.activeAgentNames.length} active agents (${
    params.activeAgentNames.join(', ') || 'all standing by'
  }), ${params.pendingTasksCount} tasks running.`;

  if (params.persona === 'agent' && params.agent) {
    return [
      `You are ${params.agent.name}, ${params.agent.role} inside VCALABS.`,
      `Personality: ${params.agent.personality}.`,
      `System directive: ${params.agent.systemPrompt}`,
      opsSnapshot,
      'You are in a natural two-way real-time voice conversation with the operator. Speak concisely in 1 to 3 clear sentences, avoid markdown or code blocks in speech, and ask clarifying questions naturally.',
    ].join(' ');
  }

  if (params.persona === 'jarvis') {
    return [
      'You are J.A.R.V.I.S., the tactical central command voice intelligence for VCALABS.',
      opsSnapshot,
      'Respond naturally in crisp, spoken sentences (1 to 3 sentences by default) suitable for real-time two-way voice conversation. Never read markdown syntax, JSON, or raw identifiers aloud.',
    ].join(' ');
  }

  return [
    'You are the Central Intelligence Core of VCALABS, an autonomous 3D AI command environment.',
    opsSnapshot,
    'Engage in natural, responsive two-way voice conversation. Keep spoken replies concise, conversational, and operational without markdown formatting.',
  ].join(' ');
}

export function parseLiveClientMessage(raw: string): LiveClientInboundMessage | null {
  if (!raw || raw.length > 2 * 1024 * 1024) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.audio === 'string' && !parsed.type) {
      return { audio: parsed.audio };
    }
    if (typeof parsed.type !== 'string') return null;

    if (parsed.type === 'start') {
      return {
        type: 'start',
        voice: typeof parsed.voice === 'string' ? parsed.voice : undefined,
        persona: typeof parsed.persona === 'string' ? parsed.persona : undefined,
        agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
      };
    }
    if (parsed.type === 'audio' && typeof parsed.data === 'string' && parsed.data.length > 0) {
      return { type: 'audio', data: parsed.data };
    }
    if (parsed.type === 'text' && typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
      return { type: 'text', text: parsed.text.trim().slice(0, 4000) };
    }
    if (parsed.type === 'video' && typeof parsed.data === 'string' && parsed.data.length > 0) {
      return {
        type: 'video',
        data: parsed.data,
        mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : 'image/jpeg',
      };
    }
    if (parsed.type === 'stop') {
      return { type: 'stop' };
    }
    return null;
  } catch {
    return null;
  }
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachGeminiLiveSession(clientWs: WebSocket, store: OsStateStore): void {
  let upstreamSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
  let connectingPromise: Promise<void> | null = null;
  let clientClosed = false;
  let hadUpstreamError = false;

  const closeUpstream = () => {
    if (upstreamSession) {
      try {
        upstreamSession.close();
      } catch {
        // Ignore close errors
      }
      upstreamSession = null;
    }
  };

  async function startSession(startMsg: { voice?: string; persona?: string; agentId?: string }) {
    if (upstreamSession || connectingPromise || clientClosed) return;
    hadUpstreamError = false;

    if (!isGeminiConfigured()) {
      hadUpstreamError = true;
      sendJson(clientWs, {
        type: 'error',
        error:
          'GEMINI_API_KEY is not configured. Check or select an API key in Settings > Secrets to start two-way Gemini Live voice conversations.',
      });
      return;
    }

    const voiceName = resolveLiveVoiceName(startMsg.voice);
    const persona = resolveLivePersonaKind(startMsg.persona);
    const targetAgent =
      persona === 'agent' && startMsg.agentId
        ? store.agents.find((a) => a.id === startMsg.agentId) ?? store.agents[0]
        : null;

    const systemInstruction = buildLiveSystemInstruction({
      persona,
      agent: targetAgent,
      activeAgentNames: store.agents.filter((a) => a.status !== 'idle').map((a) => a.name),
      pendingTasksCount: store.projects
        .flatMap((p) => p.tasks)
        .filter((t) => t.status === 'in-progress').length,
    });

    const apiKey = process.env.GEMINI_API_KEY!.trim();
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    connectingPromise = (async () => {
      try {
        const session = await ai.live.connect({
          model: GEMINI_LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction,
          },
          callbacks: {
            onopen: () => {
              if (clientClosed) return;
              store.pulseRegion(
                'reasoning-cortex',
                `Gemini Live connected (${voiceName})`,
                targetAgent?.id ?? 'central',
              );
              sendJson(clientWs, {
                type: 'ready',
                model: GEMINI_LIVE_MODEL,
                voice: voiceName,
                persona: targetAgent ? targetAgent.name : persona,
              });
            },
            onmessage: (message: LiveServerMessage) => {
              if (clientClosed) return;
              const content = message.serverContent;
              if (content?.inputTranscription?.text) {
                sendJson(clientWs, {
                  type: 'input_transcript',
                  text: content.inputTranscription.text,
                });
              }
              if (content?.outputTranscription?.text) {
                sendJson(clientWs, {
                  type: 'output_transcript',
                  text: content.outputTranscription.text,
                });
              }
              for (const part of content?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  sendJson(clientWs, {
                    type: 'audio',
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                  });
                }
              }
              if (content?.interrupted) {
                sendJson(clientWs, { type: 'interrupted' });
              }
              if (content?.turnComplete) {
                store.pulseRegion('reasoning-cortex', 'Live Voice turn complete', targetAgent?.id ?? 'central');
                sendJson(clientWs, { type: 'turn_complete' });
              }
            },
            onerror: (errEvent) => {
              hadUpstreamError = true;
              const rawMsg =
                errEvent && typeof errEvent === 'object' && 'message' in errEvent
                  ? String((errEvent as { message?: unknown }).message || 'Gemini Live stream error')
                  : 'Gemini Live session error.';
              const errMsg = rawMsg.includes('404')
                ? `Gemini Live (${GEMINI_LIVE_MODEL}) endpoint returned 404 (${rawMsg}). Ensure your API key in Settings > Secrets supports the Gemini Live WebSocket API.`
                : rawMsg;
              sendJson(clientWs, { type: 'error', error: errMsg });
            },
            onclose: (closeEvent) => {
              upstreamSession = null;
              if (!clientClosed && !hadUpstreamError) {
                const reason =
                  closeEvent && typeof closeEvent === 'object' && 'reason' in closeEvent
                    ? String((closeEvent as { reason?: unknown }).reason || '')
                    : '';
                sendJson(clientWs, { type: 'closed', reason: reason || 'Live session closed' });
              }
            },
          },
        });

        if (clientClosed) {
          session.close();
          return;
        }
        upstreamSession = session;
      } catch (err) {
        hadUpstreamError = true;
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to establish Gemini Live API connection. Verify your API key in Settings > Secrets.';
        sendJson(clientWs, { type: 'error', error: msg });
      } finally {
        connectingPromise = null;
      }
    })();

    await connectingPromise;
  }

  clientWs.on('message', async (rawBuf) => {
    const msg = parseLiveClientMessage(rawBuf.toString());
    if (!msg) return;

    if (!('type' in msg)) {
      if (connectingPromise) await connectingPromise;
      if (!upstreamSession) return;
      try {
        upstreamSession.sendRealtimeInput({
          audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
        });
      } catch (err) {
        sendJson(clientWs, {
          type: 'error',
          error: err instanceof Error ? err.message : 'Failed forwarding live audio to Gemini Live.',
        });
      }
      return;
    }

    if (msg.type === 'start') {
      await startSession(msg);
      return;
    }

    if (msg.type === 'stop') {
      closeUpstream();
      sendJson(clientWs, { type: 'closed', reason: 'Stopped by operator' });
      return;
    }

    if (connectingPromise) {
      await connectingPromise;
    }

    if (!upstreamSession) {
      if (msg.type === 'text') {
        await startSession({});
        if (!upstreamSession) return;
      } else {
        return;
      }
    }

    try {
      if (msg.type === 'audio') {
        upstreamSession.sendRealtimeInput({
          audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (msg.type === 'video') {
        upstreamSession.sendRealtimeInput({
          video: { data: msg.data, mimeType: msg.mimeType || 'image/jpeg' },
        });
      } else if (msg.type === 'text') {
        store.pulseRegion('reasoning-cortex', `Live text turn: ${msg.text.slice(0, 40)}`, 'central');
        upstreamSession.sendRealtimeInput({ text: msg.text });
      }
    } catch (err) {
      sendJson(clientWs, {
        type: 'error',
        error: err instanceof Error ? err.message : 'Failed forwarding live input to Gemini Live.',
      });
    }
  });

  clientWs.on('close', () => {
    clientClosed = true;
    closeUpstream();
  });
}
