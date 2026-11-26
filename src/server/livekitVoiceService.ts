import crypto from 'crypto';
import { JARVIS_VOICE_CONFIG } from '../utils/jarvisVoice';

export interface LiveKitVoiceConfigSnapshot {
  configured: boolean;
  wsUrl: string;
  agentName: string;
  model: string;
  voice: string;
  enhancerModel: string;
  reason?: string;
}

export interface LiveKitTokenRequest {
  roomName: string;
  participantIdentity: string;
  participantName?: string;
  ttlSeconds?: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function getLiveKitVoiceConfig(
  env: Record<string, string | undefined> = process.env,
): LiveKitVoiceConfigSnapshot {
  const wsUrl = String(env.LIVEKIT_URL || '').trim();
  const apiKey = String(env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(env.LIVEKIT_API_SECRET || '').trim();
  const agentName = String(env.LIVEKIT_AGENT_NAME || JARVIS_VOICE_CONFIG.agentName).trim();

  const configured = Boolean(wsUrl && apiKey && apiSecret);
  return {
    configured,
    wsUrl,
    agentName,
    model: JARVIS_VOICE_CONFIG.model,
    voice: JARVIS_VOICE_CONFIG.voice,
    enhancerModel: JARVIS_VOICE_CONFIG.enhancerModel,
    ...(configured
      ? {}
      : {
          reason:
            'Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in environment variables and start jarvis-voice-agent/agent.py to enable LiveKit RTC voice.',
        }),
  };
}

export function createLiveKitParticipantToken(
  req: LiveKitTokenRequest,
  env: Record<string, string | undefined> = process.env,
): { token: string; wsUrl: string; roomName: string; agentName: string } {
  const cfg = getLiveKitVoiceConfig(env);
  const apiKey = String(env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(env.LIVEKIT_API_SECRET || '').trim();

  if (!cfg.configured || !apiKey || !apiSecret) {
    throw new Error(cfg.reason || 'LiveKit environment credentials are not configured.');
  }

  const cleanRoom = req.roomName.trim() || 'vca-jarvis-voice';
  const cleanIdentity = req.participantIdentity.trim() || 'operator-01';
  const cleanName = (req.participantName || cleanIdentity).trim();
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(86400, Number(req.ttlSeconds ?? 3600)));

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: cleanIdentity,
    name: cleanName,
    nbf: nowSec - 5,
    iat: nowSec,
    exp: nowSec + ttl,
    jti: crypto.randomUUID(),
    video: {
      roomJoin: true,
      room: cleanRoom,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
    roomConfig: {
      agents: [{ agentName: cfg.agentName }],
    },
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', apiSecret).update(signingInput).digest(),
  );

  return {
    token: `${signingInput}.${signature}`,
    wsUrl: cfg.wsUrl,
    roomName: cleanRoom,
    agentName: cfg.agentName,
  };
}
