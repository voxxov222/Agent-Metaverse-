import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrbitalPositionFromElements,
  normalizeAdsbFlights,
  normalizeUsgsEarthquakes,
  searchLocalPlaces,
} from './godsEyeService';

test('normalizeUsgsEarthquakes parses GeoJSON features sorted by magnitude', () => {
  const sample = {
    features: [
      { id: 'a', properties: { mag: 2.3, place: 'California', time: 1000, tsunami: 0 }, geometry: { coordinates: [-122.1, 37.5, 8.2] } },
      { id: 'b', properties: { mag: 5.8, place: 'Japan Trench', time: 2000, tsunami: 1 }, geometry: { coordinates: [142.4, 38.1, 32.0] } },
    ],
  };
  const out = normalizeUsgsEarthquakes(sample, 10);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'b');
  assert.equal(out[0].mag, 5.8);
  assert.equal(out[0].tsunami, true);
  assert.equal(out[1].depthKm, 8.2);
});

test('normalizeAdsbFlights extracts valid tactical aircraft vectors', () => {
  const sample = {
    ac: [
      { hex: 'ae1234', flight: 'REACH42 ', lat: 38.9, lon: -77.0, alt_baro: 31000, gs: 445, track: 88, t: 'C17' },
      { hex: 'invalid', flight: 'BAD' }, // missing lat/lon
    ],
  };
  const out = normalizeAdsbFlights(sample, 20);
  assert.equal(out.length, 1);
  assert.equal(out[0].callsign, 'REACH42');
  assert.equal(out[0].altFt, 31000);
  assert.equal(out[0].aircraftType, 'C17');
});

test('computeOrbitalPositionFromElements computes bounded lat/lon and orbital speed', () => {
  const sat = computeOrbitalPositionFromElements(25544, 'ISS (ZARYA)', 51.6, 20, 92.9, 418, 1_700_000_000_000, 'station');
  assert.ok(sat.lat >= -52 && sat.lat <= 52);
  assert.ok(sat.lon >= -180 && sat.lon <= 180);
  assert.ok(sat.velocityKmh > 25000);
});

test('searchLocalPlaces finds major cities in bundled Natural Earth dataset', () => {
  const matches = searchLocalPlaces('Tokyo', 3);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].name, 'Tokyo');
  assert.ok(Math.abs(matches[0].lat - 35.68) < 0.2);
});
