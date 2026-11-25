import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeoReconPrompt,
  cartesianToLatLon,
  formatLatLonDms,
  latLonAltToCartesian,
  OPTICAL_PRESETS,
  parseGeoQuery,
} from './godsEyeLogic';

test('latLonAltToCartesian and cartesianToLatLon round-trip accurately', () => {
  const samples = [
    { lat: 0, lon: 0 },
    { lat: 37.7749, lon: -122.4194 },
    { lat: 35.6762, lon: 139.6503 },
    { lat: -33.8688, lon: 151.2093 },
    { lat: 64.1466, lon: -21.9426 },
  ];

  for (const s of samples) {
    const vec = latLonAltToCartesian(s.lat, s.lon, 0, 10);
    const out = cartesianToLatLon(vec.x, vec.y, vec.z);
    assert.ok(Math.abs(out.lat - s.lat) < 0.01, `lat mismatch for ${s.lat}: got ${out.lat}`);
    assert.ok(Math.abs(out.lon - s.lon) < 0.01, `lon mismatch for ${s.lon}: got ${out.lon}`);
  }
});

test('parseGeoQuery parses decimal pairs and geo URIs and rejects invalid bounds', () => {
  assert.deepEqual(parseGeoQuery('37.7749, -122.4194'), { lat: 37.7749, lon: -122.4194 });
  assert.deepEqual(parseGeoQuery('geo:39.7392,-104.9903'), { lat: 39.7392, lon: -104.9903 });
  assert.equal(parseGeoQuery('120.5, 45.0'), null);
  assert.equal(parseGeoQuery('Tokyo'), null);
});

test('formatLatLonDms formats hemispheres clearly', () => {
  const dms = formatLatLonDms(35.6762, -122.4194);
  assert.match(dms.latStr, /^35°\d{2}'\d{2}"N$/);
  assert.match(dms.lonStr, /^122°\d{2}'\d{2}"W$/);
});

test('OPTICAL_PRESETS includes all 5 tactical optical modes from gods-eye-view', () => {
  assert.deepEqual(Object.keys(OPTICAL_PRESETS), ['normal', 'nvg', 'flir', 'crt', 'noir']);
});

test('buildGeoReconPrompt formats agent-targeted or central intelligence briefing', () => {
  const prompt = buildGeoReconPrompt(
    {
      kind: 'earthquake',
      id: 'eq-1',
      title: 'M5.4 Seismic Event',
      subtitle: 'Near Honshu Coast',
      lat: 36.2,
      lon: 141.1,
      details: ['Depth 22 km', 'Tsunami: None'],
    },
    { lat: 36.2, lon: 141.1, temperatureC: 14, windKmh: 28, cloudCoverPct: 40, condition: 'Clear' },
    'Sentinel',
  );
  assert.match(prompt, /^@Sentinel God's Eye geospatial recon brief/);
  assert.match(prompt, /36\.200, 141\.100/);
  assert.match(prompt, /14°C/);
});
