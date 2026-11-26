import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRmsLevel,
  downsampleFloat32,
  float32ToInt16Pcm,
  float32ToPcm16Base64,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_VOICES,
  pcm16Base64ToFloat32,
} from './geminiLiveAudio';

test('GEMINI_LIVE_MODEL targets gemini-3.8-live and includes expected prebuilt voices', () => {
  assert.equal(GEMINI_LIVE_MODEL, 'gemini-3.8-live');
  assert.deepEqual([...GEMINI_LIVE_VOICES], ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir']);
});

test('float32ToInt16Pcm clamps extremes cleanly without wrapping', () => {
  const input = new Float32Array([-1.5, -1, 0, 0.5, 1, 2.0]);
  const pcm = float32ToInt16Pcm(input);
  assert.equal(pcm[0], -32768);
  assert.equal(pcm[1], -32768);
  assert.equal(pcm[2], 0);
  assert.ok(pcm[3] > 16000 && pcm[3] < 16400);
  assert.equal(pcm[4], 32767);
  assert.equal(pcm[5], 32767);
});

test('downsampleFloat32 converts 48kHz buffers cleanly to 16kHz (1/3 sample count)', () => {
  const input = new Float32Array(480);
  for (let i = 0; i < input.length; i++) {
    input[i] = Math.sin((i / 480) * Math.PI * 2);
  }
  const downsampled = downsampleFloat32(input, 48000, 16000);
  assert.equal(downsampled.length, 160);
  assert.ok(Math.abs(downsampled[0]) < 1e-6);
  assert.ok(Math.abs(downsampled[40] - 1) < 0.02);
});

test('float32ToPcm16Base64 and pcm16Base64ToFloat32 round-trip mono PCM16 accurately', () => {
  const original = new Float32Array([0, 0.25, -0.5, 0.75, -0.9]);
  const base64 = float32ToPcm16Base64(original, 16000, 16000);
  const decoded = pcm16Base64ToFloat32(base64);
  assert.equal(decoded.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.ok(Math.abs(decoded[i] - original[i]) < 0.001);
  }
});

test('computeRmsLevel returns bounded [0, 1] amplitude', () => {
  assert.equal(computeRmsLevel(new Float32Array(0)), 0);
  assert.equal(computeRmsLevel(new Float32Array([0, 0, 0])), 0);
  const loud = computeRmsLevel(new Float32Array([0.8, -0.8, 0.8, -0.8]));
  assert.equal(loud, 1);
  const quiet = computeRmsLevel(new Float32Array([0.05, -0.05, 0.05, -0.05]));
  assert.ok(quiet > 0 && quiet < 0.5);
});
