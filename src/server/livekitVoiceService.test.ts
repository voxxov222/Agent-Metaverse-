import crypto from 'crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveKitParticipantToken, getLiveKitVoiceConfig } from './livekitVoiceService';

test('getLiveKitVoiceConfig reports unconfigured cleanly without exposing secrets', () => {
  const cfg = getLiveKitVoiceConfig({});
  assert.equal(cfg.configured, false);
  assert.equal(cfg.agentName, 'assistant-0ab');
  assert.equal(cfg.voice, 'zenith');
  assert.equal(cfg.model, 'xai/grok-voice-3.0');
  assert.equal(cfg.enhancerModel, 'QUAIL_VF_S');
  assert.ok(cfg.reason && cfg.reason.includes('LIVEKIT_URL'));
});

test('createLiveKitParticipantToken signs valid HS256 LiveKit JWT with assistant-0ab agent dispatch', () => {
  const fakeEnv = {
    LIVEKIT_URL: 'wss://example.livekit.cloud',
    LIVEKIT_API_KEY: 'APIKeyTest123',
    LIVEKIT_API_SECRET: 'SuperSecretKeyValueForSigning123456',
    LIVEKIT_AGENT_NAME: 'assistant-0ab',
  };

  const res = createLiveKitParticipantToken(
    {
      roomName: 'vca-jarvis-voice',
      participantIdentity: 'operator-alpha',
      participantName: 'Admin Operator',
    },
    fakeEnv,
  );

  assert.equal(res.wsUrl, 'wss://example.livekit.cloud');
  assert.equal(res.agentName, 'assistant-0ab');

  const parts = res.token.split('.');
  assert.equal(parts.length, 3);

  const [h, p, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', fakeEnv.LIVEKIT_API_SECRET)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  assert.equal(sig, expectedSig);

  const decodedPayload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as {
    iss: string;
    sub: string;
    video: { roomJoin: boolean; room: string; canPublish: boolean };
    roomConfig: { agents: Array<{ agentName: string }> };
  };
  assert.equal(decodedPayload.iss, 'APIKeyTest123');
  assert.equal(decodedPayload.sub, 'operator-alpha');
  assert.equal(decodedPayload.video.roomJoin, true);
  assert.equal(decodedPayload.video.room, 'vca-jarvis-voice');
  assert.equal(decodedPayload.roomConfig.agents[0]?.agentName, 'assistant-0ab');
});
