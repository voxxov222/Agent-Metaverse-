import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeObjectMotionTransform,
  getDefaultSkyboxForTheme,
  MAX_MEDIA_BYTES,
  sanitizeMediaUrl,
  sanitizeSkyboxConfig,
  validateMediaUpload,
} from './worldEnhancements';

test('sanitizeSkyboxConfig clamps out-of-range numeric values and invalid hex codes', () => {
  const clean = sanitizeSkyboxConfig({
    enabled: true,
    preset: 'aurora-horizon',
    zenithColor: 'not-a-hex',
    horizonColor: '#112233',
    sunElevation: 200,
    sunAzimuth: -30,
    sunSize: 99,
    starDensity: -5,
    auroraIntensity: 2.5,
    cloudCoverage: 0.44,
    envIntensity: 10,
    exposure: 0.1,
  });

  assert.equal(clean.enabled, true);
  assert.equal(clean.preset, 'aurora-horizon');
  assert.equal(clean.zenithColor, '#030b16'); // falls back to preset default
  assert.equal(clean.horizonColor, '#112233');
  assert.equal(clean.sunElevation, 75);
  assert.equal(clean.sunAzimuth, 0);
  assert.equal(clean.sunSize, 3);
  assert.equal(clean.starDensity, 0);
  assert.equal(clean.auroraIntensity, 1);
  assert.equal(clean.cloudCoverage, 0.44);
  assert.equal(clean.envIntensity, 2.2);
  assert.equal(clean.exposure, 0.6);
});

test('getDefaultSkyboxForTheme returns distinct hyper-realistic sky defaults', () => {
  const orbital = getDefaultSkyboxForTheme('orbital-station', 14);
  const alpine = getDefaultSkyboxForTheme('alpine-observatory', 20);
  const cyber = getDefaultSkyboxForTheme('cyber-metropolis', 21);
  const canyon = getDefaultSkyboxForTheme('bioluminescent-canyon', 18);

  assert.equal(orbital.preset, 'orbital-deep-space');
  assert.ok(orbital.starDensity > 0.9);
  assert.equal(alpine.preset, 'aurora-horizon');
  assert.ok(alpine.auroraIntensity > 0.8);
  assert.equal(cyber.preset, 'cyber-neon-rain');
  assert.equal(canyon.sunColor, '#e879f9');
});

test('validateMediaUpload accepts PNG, GIF, MP4 and rejects unsupported or oversized payloads', () => {
  assert.deepEqual(
    validateMediaUpload({ mimeType: 'image/png', byteLength: 1024 }),
    { valid: true, ext: 'png', mediaType: 'image' },
  );
  assert.deepEqual(
    validateMediaUpload({ mimeType: 'image/gif', byteLength: 2048 }),
    { valid: true, ext: 'gif', mediaType: 'gif' },
  );
  assert.deepEqual(
    validateMediaUpload({ mimeType: 'video/mp4; codecs="avc1"', byteLength: 500_000 }),
    { valid: true, ext: 'mp4', mediaType: 'video' },
  );
  assert.equal(validateMediaUpload({ mimeType: 'application/x-msdownload', byteLength: 100 }).valid, false);
  assert.equal(validateMediaUpload({ mimeType: 'image/png', byteLength: 0 }).valid, false);
  assert.equal(validateMediaUpload({ mimeType: 'video/webm', byteLength: MAX_MEDIA_BYTES + 1 }).valid, false);
});

test('sanitizeMediaUrl allows safe /api/media paths and rejects javascript: URLs', () => {
  assert.equal(sanitizeMediaUrl('/api/media/media-1234.gif'), '/api/media/media-1234.gif');
  assert.equal(sanitizeMediaUrl('https://cdn.example.com/clip.mp4'), 'https://cdn.example.com/clip.mp4');
  assert.equal(sanitizeMediaUrl('javascript:alert(1)'), undefined);
  assert.equal(sanitizeMediaUrl('/api/media/../../etc/passwd'), undefined);
});

test('computeObjectMotionTransform produces expected kinematic transforms', () => {
  const base: [number, number, number] = [2, 0, -3];

  const stat = computeObjectMotionTransform('static', base, 0.5, 4.2, 0);
  assert.deepEqual(stat, { x: 2, y: 0, z: -3, rotationY: 0.5 });

  const hover = computeObjectMotionTransform('hover', base, 0, 1.0, 0);
  assert.equal(hover.x, 2);
  assert.equal(hover.z, -3);
  assert.ok(hover.y >= 0 && hover.y <= 0.5);

  const spin = computeObjectMotionTransform('spin', base, 0.25, 2.0, 0);
  assert.ok(Math.abs(spin.rotationY - (0.25 + 1.7)) < 1e-6);

  const orbit = computeObjectMotionTransform('orbit', base, 0, 0, 0);
  assert.ok(Math.abs(orbit.x - (2 + 1.65)) < 1e-6);
  assert.ok(Math.abs(orbit.z - -3) < 1e-6);

  const patrolA = computeObjectMotionTransform('patrol', base, 0, 0, 0);
  const patrolB = computeObjectMotionTransform('patrol', base, 0, Math.PI / (2 * 0.75), 0);
  assert.ok(patrolB.x > patrolA.x);
});
