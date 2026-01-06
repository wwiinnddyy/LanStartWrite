const DEFAULT_PEN_TAIL = {
  enabled: false,
  intensity: 50,
  samplePoints: 10,
  speedSensitivity: 100,
  pressureSensitivity: 100,
  shape: 'natural',
  profile: 'standard'
};

const PROFILES = {
  standard: { intensity: 50, samplePoints: 10, speedSensitivity: 100, pressureSensitivity: 100, shape: 'natural' },
  calligraphy: { intensity: 72, samplePoints: 12, speedSensitivity: 85, pressureSensitivity: 140, shape: 'sharp' },
  speed: { intensity: 62, samplePoints: 9, speedSensitivity: 155, pressureSensitivity: 80, shape: 'round' }
};

function _clamp(n, a, b){
  const v = Number(n);
  if (!Number.isFinite(v)) return a;
  return Math.max(a, Math.min(b, v));
}

export function getPenTailDefaultProfiles(){
  return Object.keys(PROFILES);
}

export function normalizePenTailSettings(input){
  const src = input && typeof input === 'object' ? input : {};
  const p = String(src.profile || DEFAULT_PEN_TAIL.profile);
  const base = PROFILES[p] ? Object.assign({}, DEFAULT_PEN_TAIL, PROFILES[p]) : Object.assign({}, DEFAULT_PEN_TAIL);
  const shape = String(src.shape || base.shape);
  const out = {
    enabled: !!src.enabled,
    intensity: Math.round(_clamp(src.intensity ?? base.intensity, 0, 100)),
    samplePoints: Math.round(_clamp(src.samplePoints ?? base.samplePoints, 5, 20)),
    speedSensitivity: Math.round(_clamp(src.speedSensitivity ?? base.speedSensitivity, 0, 200)),
    pressureSensitivity: Math.round(_clamp(src.pressureSensitivity ?? base.pressureSensitivity, 0, 200)),
    shape: (shape === 'sharp' || shape === 'round' || shape === 'natural' || shape === 'custom') ? shape : 'natural',
    profile: PROFILES[p] ? p : 'standard'
  };
  return out;
}

function _getPointTimeMs(p){
  const t = p && typeof p === 'object' ? Number(p.t) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function _getPointPressure(p){
  const v = p && typeof p === 'object' ? Number(p.p) : NaN;
  if (!Number.isFinite(v)) return NaN;
  return _clamp(v, 0, 1);
}

function _distance(a, b){
  return Math.hypot((b.x - a.x), (b.y - a.y));
}

function _avgSpeedAndPressure(points){
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return { speed: 0, pressure: NaN };

  let dist = 0;
  let dt = 0;
  let pSum = 0;
  let pCount = 0;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    dist += _distance(a, b);
    const ta = _getPointTimeMs(a);
    const tb = _getPointTimeMs(b);
    if (Number.isFinite(ta) && Number.isFinite(tb) && tb >= ta) dt += (tb - ta);
    const pb = _getPointPressure(b);
    if (Number.isFinite(pb) && pb > 0) { pSum += pb; pCount += 1; }
  }

  const speed = dt > 0 ? (dist / (dt / 1000)) : 0;
  const pressure = pCount ? (pSum / pCount) : NaN;
  return { speed, pressure };
}

export function simulatePressureFromSpeed(speed){
  const v = Math.max(0, Number(speed) || 0);
  const s = 1 - (1 / (1 + (v / 1.2)));
  const p = 1 - Math.pow(s, 1.6);
  return _clamp(p, 0.15, 1);
}

function _nonlinearSpeedFactor(speed){
  const v = Math.max(0, Number(speed) || 0);
  const s = 1 - Math.exp(-v / 2.2);
  return _clamp(s, 0, 1);
}

function _nonlinearPressureFactor(pressure){
  const p = _clamp(Number(pressure) || 0, 0, 1);
  return Math.pow(p, 1.6);
}

function _shapeLengthScale(shape){
  if (shape === 'sharp') return 1.15;
  if (shape === 'round') return 0.92;
  return 1.0;
}

function _shapeWidthDecay(shape, u){
  const x = _clamp(u, 0, 1);
  const inv = 1 - x;
  if (shape === 'sharp') return Math.pow(inv, 2.2);
  if (shape === 'round') return Math.pow(inv, 0.75);
  return Math.pow(inv, 1.35);
}

function _resampleQuadraticSegment(p0, p1, p2, steps){
  const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const out = [];
  const s = Math.max(1, steps | 0);
  for (let i = 1; i <= s; i++) {
    const t = i / (s + 1);
    const mt = 1 - t;
    const x = mt * mt * mid1.x + 2 * mt * t * p1.x + t * t * mid2.x;
    const y = mt * mt * mid1.y + 2 * mt * t * p1.y + t * t * mid2.y;
    out.push({ x, y });
  }
  out.push({ x: mid2.x, y: mid2.y });
  return out;
}

function _normalizeDir(points){
  const pts = Array.isArray(points) ? points : [];
  for (let i = pts.length - 1; i >= 1; i--) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.001) return { dx: dx / len, dy: dy / len };
  }
  return { dx: 1, dy: 0 };
}

export function buildPenTailSegment(pointsSegment, baseSize, penTail){
  const cfg = normalizePenTailSettings(penTail);
  const pts = Array.isArray(pointsSegment) ? pointsSegment : [];
  if (!cfg.enabled) return { segment: pts.slice(), meta: { enabled: false } };
  if (pts.length < 3) return { segment: pts.slice(), meta: { enabled: true, degraded: false } };

  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  const sampleN = Math.max(5, Math.min(20, cfg.samplePoints | 0));
  const tailCore = pts.slice(Math.max(0, pts.length - sampleN));
  const { speed, pressure } = _avgSpeedAndPressure(tailCore);
  const sp = _nonlinearSpeedFactor(speed);
  const pr = Number.isFinite(pressure) ? _nonlinearPressureFactor(pressure) : _nonlinearPressureFactor(simulatePressureFromSpeed(speed));

  const intensity = _clamp(cfg.intensity / 100, 0, 1);
  const speedSens = _clamp(cfg.speedSensitivity / 100, 0, 2);
  const pressureSens = _clamp(cfg.pressureSensitivity / 100, 0, 2);
  const shape = cfg.shape === 'custom' ? 'natural' : cfg.shape;

  const base = Math.max(0.5, Number(baseSize) || 1);
  const lenScale = _shapeLengthScale(shape);
  const lengthPx = base * (2.2 + 7.2 * intensity) * lenScale * (1 + speedSens * (0.15 + 0.85 * sp));

  const widthGain = 1 + intensity * pressureSens * (0.25 + 1.15 * pr);
  const tailBaseWidth = base * widthGain;

  const dir = _normalizeDir(pts);
  const last = pts[pts.length - 1];

  const segmentOut = [];
  segmentOut.push({ x: pts[0].x, y: pts[0].y });

  const steps = Math.max(1, Math.min(5, Math.round(1 + intensity * 3)));
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const samples = _resampleQuadraticSegment(p0, p1, p2, steps);
    for (const s of samples) segmentOut.push({ x: s.x, y: s.y });
  }
  segmentOut.push({ x: last.x, y: last.y, w: tailBaseWidth });

  const tailCount = Math.max(6, Math.min(24, Math.round(8 + intensity * 14)));
  for (let i = 1; i <= tailCount; i++) {
    const u = i / tailCount;
    const posEase = 1 - Math.pow(1 - u, 1.25);
    const dx = dir.dx * (lengthPx * posEase);
    const dy = dir.dy * (lengthPx * posEase);
    const w = tailBaseWidth * _shapeWidthDecay(shape, u);
    segmentOut.push({ x: last.x + dx, y: last.y + dy, w: Math.max(0.15, w) });
  }

  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  return {
    segment: segmentOut,
    meta: {
      enabled: true,
      speed,
      pressure: Number.isFinite(pressure) ? pressure : null,
      simulatedPressure: Number.isFinite(pressure) ? false : true,
      ms: Math.max(0, t1 - t0)
    }
  };
}

