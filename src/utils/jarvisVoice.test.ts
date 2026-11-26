import test from 'node:test';
import assert from 'node:assert/strict';
import { JARVIS_VOICE_CONFIG, sanitizeJarvisVoiceText } from './jarvisVoice';

test('JARVIS_VOICE_CONFIG matches assistant-0ab LiveKit specification', () => {
  assert.equal(JARVIS_VOICE_CONFIG.agentName, 'assistant-0ab');
  assert.equal(JARVIS_VOICE_CONFIG.model, 'xai/grok-voice-3.0');
  assert.equal(JARVIS_VOICE_CONFIG.voice, 'zenith');
  assert.equal(JARVIS_VOICE_CONFIG.enhancerModel, 'QUAIL_VF_S');
});

test('sanitizeJarvisVoiceText enforces plain-text voice output rules', () => {
  const input =
    '### Status Report\n- **CPU load**: `42%` across 4 cores.\n- Visit https://yukios.pages.dev for docs 🚀.\n- Third sentence stays.\n- Fourth sentence gets trimmed out.';

  const out = sanitizeJarvisVoiceText(input);
  assert.ok(!out.includes('###'));
  assert.ok(!out.includes('**'));
  assert.ok(!out.includes('`'));
  assert.ok(!out.includes('https://'));
  assert.ok(!out.includes('🚀'));
  assert.ok(out.includes('42 percent'));
  assert.ok(out.includes('four cores'));
  assert.ok(out.includes('yukios.pages.dev'));
  assert.ok(!out.includes('Fourth sentence'));
});

test('sanitizeJarvisVoiceText replaces raw JSON objects with a concise spoken summary', () => {
  const out = sanitizeJarvisVoiceText('{"status":"ok","nodes":[1,2,3]}');
  assert.equal(out, 'Task update completed. Check the command log for details.');
});
