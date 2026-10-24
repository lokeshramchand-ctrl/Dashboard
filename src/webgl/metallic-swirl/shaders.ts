// Shaders and presets decompiled from splsystems.com's production bundle
// (the "metallic swirl" scroll backdrop used behind Asset Management,
// Proprietary Investments and Infrastructure). Kept byte-for-byte identical
// to the source's GLSL.

export const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform float uTime;
uniform vec2 uRes;
uniform float uZoom;
uniform float uIter;
uniform float uEps;
uniform float uTangent;
uniform float uGrad;
uniform float uBright;
uniform float uContrast;
uniform vec4 uBg;
uniform float uAlpha;
uniform float uRadial;
uniform float uBeams;
uniform float uStretch;
uniform float uFlow;
uniform float uSpinPhase;
uniform float uBeamWidth;
uniform float uTwist;
uniform float uVortex;
uniform float uHole;
uniform vec2 uCenter;
uniform float uVignette;
uniform int uColorMode;
uniform vec4 uColorA;
uniform vec4 uColorB;
uniform vec4 uColorC;
uniform vec4 uTint;
uniform float uRepetition;
uniform float uSoftness;
uniform float uBandWidth;
uniform float uShiftRed;
uniform float uShiftBlue;
uniform float uStripePhase;
uniform float uStripeRadial;
uniform float uSpread;
uniform float uThreshold;
uniform float uDetailFade;
uniform float uFadeLeft;
uniform float uFadeRight;
uniform float uFadeTop;
uniform float uFadeBottom;

float edgeFade(float v, float width) {
  return width > 0.0001 ? smoothstep(0.0, width, v) : 1.0;
}

float detailMask(float cyclesPerPx) {
  return 1.0 - uDetailFade * smoothstep(0.05, 0.2, cyclesPerPx);
}

float stripe(float c1, float c2, float c3, float p, vec3 w, float blur, float bump, float tint) {
  float ch = mix(c2, c1, smoothstep(0.0, 2.0 * blur, p));
  float border = w[0];
  ch = mix(ch, c3, smoothstep(border, border + 2.0 * blur, p));
  border = w[0] + 0.4 * (1.0 - bump) * w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2.0 * blur, p));
  border = w[0] + 0.5 * (1.0 - bump) * w[1];
  ch = mix(ch, c3, smoothstep(border, border + 2.0 * blur, p));
  border = w[0] + w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2.0 * blur, p));
  float gradientT = (p - w[0] - w[1]) / w[2];
  float gradient = mix(c3, c2, smoothstep(0.0, uSpread, gradientT));
  ch = mix(ch, gradient, smoothstep(border, border + 0.5 * blur, p));
  ch = mix(ch, 1.0 - min(1.0, (1.0 - ch) / max(tint, 0.0001)), uTint.a);
  return ch;
}

vec4 stripeColor(float val, float r, float t) {
  float bump = clamp(1.0 - pow(r / uZoom * 1.8, 1.2), 0.0, 1.0);
  float direction = val / 6.28318 * uRepetition - uStripePhase + uStripeRadial * r / uZoom;
  float thin1 = uBandWidth / uRepetition * (1.0 - 0.4 * bump);
  float thin2 = uBandWidth * 0.5833 / uRepetition * (1.0 + 0.4 * bump);
  vec3 w = vec3(thin1 * uRepetition, thin2 * uRepetition, 1.0 - thin1 - thin2);
  w[1] -= 0.02 * smoothstep(0.0, 1.0, bump);
  float dispersion = clamp(1.0 - bump, 0.0, 1.0);
  float dR = dispersion * uShiftRed / 20.0;
  float dB = dispersion * 1.3 * uShiftBlue / 20.0;
  float blur = uSoftness / 3.0;
  float sR = fract(direction + dR);
  float sG = fract(direction);
  float sB = fract(direction - dB);
  vec3 pA = uColorA.rgb * uColorA.a;
  vec3 pB = uColorB.rgb * uColorB.a;
  vec3 pC = uColorC.rgb * uColorC.a;
  float density = min(fwidth(sG), fwidth(fract(direction + 0.5)));
  return vec4(
    stripe(pA.r, pB.r, pC.r, sR, w, blur + fwidth(sR), bump, uTint.r),
    stripe(pA.g, pB.g, pC.g, sG, w, blur + fwidth(sG), bump, uTint.g),
    stripe(pA.b, pB.b, pC.b, sB, w, blur + fwidth(sB), bump, uTint.b),
    stripe(uColorA.a, uColorB.a, uColorC.a, sG, w, blur + fwidth(sG), bump, 1.0)
  ) * detailMask(density);
}

float ramp(float c1, float c2, float c3, float s, float tint) {
  float ch = s < 0.5 ? mix(c2, c3, s * 2.0) : mix(c3, c1, s * 2.0 - 1.0);
  ch = mix(ch, 1.0 - min(1.0, (1.0 - ch) / max(tint, 0.0001)), uTint.a);
  return ch;
}

vec4 phaseColor(float val, float along, float r) {
  val += uStripeRadial * 6.28318 * r / uZoom;
  float bump = clamp(1.0 - pow(r / uZoom * 1.8, 1.2), 0.0, 1.0);
  float dispersion = clamp(1.0 - bump, 0.0, 1.0);
  float dR = clamp(dispersion * uShiftRed * 12.0 * along, -4.0, 4.0);
  float dB = clamp(dispersion * uShiftBlue * 12.0 * along, -4.0, 4.0);
  float soft = mix(0.02, 0.5, uSoftness) + min(abs(along), 0.2) * 0.5;
  vec3 s = sin(3.11 + vec3(val + dR, val, val - dB)) * 0.5 + 0.5;
  s = smoothstep(vec3(uThreshold - soft), vec3(uThreshold + soft), s);
  vec3 pA = uColorA.rgb * uColorA.a;
  vec3 pB = uColorB.rgb * uColorB.a;
  vec3 pC = uColorC.rgb * uColorC.a;
  return vec4(
    ramp(pA.r, pB.r, pC.r, s.r, uTint.r),
    ramp(pA.g, pB.g, pC.g, s.g, uTint.g),
    ramp(pA.b, pB.b, pC.b, s.b, uTint.b),
    ramp(uColorA.a, uColorB.a, uColorC.a, s.g, 1.0)
  ) * detailMask(fwidth(val) / 6.28318);
}

float sharpen(float c, float k, float w) {
  float m = max(abs(c), max(w, 1e-4));
  return c / m * pow(m, k);
}

float wave(vec2 p, float t) {
  return sin(p.x + sin(p.y + t * 0.1)) * sin(p.y * p.x * 0.1 + t * 0.2);
}

vec2 flow(vec2 st, float t) {
  float r = length(st);
  float a = atan(st.y, st.x) + uSpinPhase + log(r + 0.05) * uTwist + uVortex / (r + 0.15);
  float pxSt = uZoom / uRes.y;
  float daPx = pxSt * (1.0 / max(r, 0.001) + abs(uTwist) / (r + 0.05) + abs(uVortex) / ((r + 0.15) * (r + 0.15)));
  float angular = sharpen(cos(a * uBeams), uBeamWidth, daPx * uBeams) + 0.5 * sharpen(sin(a * (uBeams + 1.0) + t * 0.3), uBeamWidth, daPx * (uBeams + 1.0));
  vec2 polar = vec2(angular * 3.14159, log(r + 0.05) * uStretch);
  float centerFade = smoothstep(0.0, 0.15 * uZoom, r);
  float radialMix = uRadial * centerFade;

  vec2 ep = vec2(uEps, 0.0);
  vec2 p = mix(st, polar, radialMix);
  float localT = t - r * uFlow * radialMix;
  vec2 outV = vec2(0.0);

  for (int i = 0; i < 12; i++) {
    float w = clamp(uIter - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    float s0 = wave(p, localT);
    float sx = wave(p + ep, localT);
    float sy = wave(p + ep.yx, localT);
    vec2 g = vec2(sx - s0, sy - s0) / ep.xx;
    vec2 tang = vec2(-g.y, g.x);
    p += (uTangent * tang + g * uGrad) * w;
    outV = mix(outV, tang, w);
  }
  return outV;
}

void main() {
  vec2 aspect = vec2(uRes.x / uRes.y, 1.0);
  vec2 st = (vUv - uCenter) * aspect * uZoom;
  float t = uTime;
  float r = length(st);

  vec2 outV = flow(st, t);
  vec4 layer;
  if (uColorMode == 1) {
    layer = stripeColor(atan(outV.y, outV.x), r, t);
  } else {
    vec2 dir = st / max(r, 0.001);
    vec2 px = dir * (uZoom / uRes.y);
    vec2 outA = flow(st + px, t);
    vec2 outB = flow(st - px, t);
    float along = ((outA.x - outA.y) - (outB.x - outB.y)) * 0.5;
    layer = phaseColor(outV.x - outV.y, along, r);
  }
  vec3 col = layer.rgb;
  float cover = layer.a;
  col = (col - 0.5 * cover) * uContrast + 0.5 * cover;
  col *= uBright;
  float vd = length((vUv - 0.5) * aspect) / length(aspect * 0.5);
  float edges = edgeFade(vUv.x, uFadeLeft) * edgeFade(1.0 - vUv.x, uFadeRight) * edgeFade(1.0 - vUv.y, uFadeTop) * edgeFade(vUv.y, uFadeBottom);
  float shape = smoothstep(0.0, max(uHole * uZoom * 0.25, 0.001), r) * (1.0 - uVignette * smoothstep(0.35, 1.1, vd)) * edges;
  col *= shape;
  cover *= shape;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float mask = clamp(lum * 4.0, 0.0, 1.0);

  vec3 rgb = mix(uBg.rgb, col, mask);
  float alpha = (uBg.a + (1.0 - uBg.a) * cover * mask) * uAlpha;

  fragColor = vec4(rgb, alpha);
}
`;

/** Full-screen quad (two triangles), matching the source's static vertex buffer. */
export const QUAD_VERTICES = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export interface MetallicSwirlParams {
  speed: number;
  initialTime: number;
  zoom: number;
  iterations: number;
  sampleGap: number;
  tangentForce: number;
  gradientForce: number;
  brightness: number;
  contrast: number;
  backgroundColor: string;
  opacity: number;
  radialMix: number;
  beams: number;
  radialStretch: number;
  radialFlow: number;
  radialSpin: number;
  beamWidth: number;
  twist: number;
  vortex: number;
  hole: number;
  centerX: number;
  centerY: number;
  vignette: number;
  colorMode: "stripes" | "phase";
  colorA: string;
  colorB: string;
  colorC: string;
  tintColor: string;
  repetition: number;
  softness: number;
  bandWidth: number;
  shiftRed: number;
  shiftBlue: number;
  stripeFlow: number;
  stripeRadial: number;
  spread: number;
  threshold: number;
  detailFade: number;
  fadeLeft: number;
  fadeRight: number;
  fadeTop: number;
  fadeBottom: number;
}

export const METALLIC_SWIRL_DEFAULTS: MetallicSwirlParams = {
  speed: 0.11,
  initialTime: 0,
  zoom: 0.9,
  iterations: 4,
  sampleGap: 0.005,
  tangentForce: 0.81,
  gradientForce: 0.08,
  brightness: 1,
  contrast: 1,
  backgroundColor: "#000000ff",
  opacity: 1,
  radialMix: 1,
  beams: 5,
  radialStretch: 0.49,
  radialFlow: 3,
  radialSpin: 0.2,
  beamWidth: 0.2,
  twist: 1.4,
  vortex: 0,
  hole: 0,
  centerX: 0.5,
  centerY: 0.5,
  vignette: 0,
  colorMode: "stripes",
  colorA: "#fafaff",
  colorB: "#000000",
  colorC: "#8b93a6",
  tintColor: "#ffffff00",
  repetition: 1.1,
  softness: 0.2,
  bandWidth: 0.12,
  shiftRed: 0,
  shiftBlue: 0,
  stripeFlow: -1.69,
  stripeRadial: 0,
  spread: 0.02,
  threshold: 0.72,
  detailFade: 0,
  fadeLeft: 0,
  fadeRight: 0,
  fadeTop: 0,
  fadeBottom: 0,
};

/** Parses "#rgb"/"#rgba"/"#rrggbb"/"#rrggbbaa" into [r,g,b,a] in 0..1. */
export function hexToRgba(hex: string): [number, number, number, number] {
  const body = hex.replace("#", "");
  const expand = (s: string) => s.split("").map((c) => c + c).join("");
  const full = body.length === 3 ? expand(body) + "ff" : body.length === 4 ? expand(body) : body.length === 6 ? body + "ff" : body;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
    parseInt(full.slice(6, 8), 16) / 255,
  ];
}

/**
 * Scroll keyframes for the shared backdrop behind Asset Management,
 * Proprietary Investments and Infrastructure. Keyframe 0 sits at the band's
 * top (Asset Management's start), keyframes 1-3 sit at the vertical
 * midpoint of each section's anchor element, keyframe 4 sits at the band's
 * bottom (Infrastructure's end / Values' start).
 */
const BASE: Partial<MetallicSwirlParams>[] = [
  {
    speed: 0.05, initialTime: 0, zoom: 2.1, iterations: 2, sampleGap: 0.14, tangentForce: 0.83, gradientForce: 0.27,
    centerX: 0.17, centerY: 0.95, radialMix: 0, beams: 5, beamWidth: 0.62, radialStretch: 1.46, radialFlow: 2,
    radialSpin: -0.3, twist: -0.19, vortex: -0.55, hole: 0.16, colorMode: "stripes", colorA: "#9aaef2",
    colorB: "#00000000", colorC: "#dfeaff00", tintColor: "#ffffff00", softness: 0.7, shiftRed: 0.3, shiftBlue: 0.2,
    repetition: 3, stripeFlow: 0.56, spread: 0.03, brightness: 1, contrast: 1, vignette: 0, detailFade: 1,
    backgroundColor: "#00000000", opacity: 1, fadeTop: 0.5, fadeBottom: 0.5, threshold: 0.69,
  },
  {
    speed: 0.05, initialTime: 0, zoom: 2.11, iterations: 2, sampleGap: 0.14, tangentForce: 0.83, gradientForce: 0.27,
    centerX: 0.17, centerY: 0.45, radialMix: 0, beams: 5, beamWidth: 1, radialStretch: 0.69, radialFlow: -2.07,
    radialSpin: -0.3, twist: -0.19, vortex: -0.55, hole: 0, colorMode: "stripes", colorA: "#9aaef2",
    colorB: "#00000000", colorC: "#dfeaff00", tintColor: "#ffffff00", softness: 0.31, shiftRed: 0.3, shiftBlue: 0.2,
    repetition: 1.9, stripeFlow: 0.99, spread: 0.02, brightness: 1, contrast: 1, vignette: 0, detailFade: 1,
    backgroundColor: "#00000000", opacity: 1, fadeTop: 0.5, fadeBottom: 0.5,
  },
  {
    speed: 0.05, initialTime: 0, zoom: 0.25, iterations: 2, sampleGap: 0.147, tangentForce: 0.83, gradientForce: 0.2,
    centerX: 0.5, centerY: 0.59, radialMix: 0.39, beams: 5, beamWidth: 0.84, radialStretch: 1.3, radialFlow: -2.07,
    radialSpin: -0.3, twist: 0.12, vortex: -0.52, hole: 1, colorMode: "stripes", colorA: "#9aaef2",
    colorB: "#00000000", colorC: "#dfeaff00", tintColor: "#ffffff00", softness: 0.31, shiftRed: 0.3, shiftBlue: 0.2,
    repetition: 3.5, stripeFlow: 0.99, spread: 0.02, brightness: 0.14, contrast: 1, vignette: 0, detailFade: 1,
    backgroundColor: "#00000000", opacity: 1, fadeTop: 0.5, fadeBottom: 0.5,
  },
  {
    speed: 0.1, initialTime: 0, zoom: 2, iterations: 3, sampleGap: 0.147, tangentForce: -1.2, gradientForce: 0.5,
    centerX: 0.5, centerY: 0.594, radialMix: 1, beams: 5, beamWidth: 1, radialStretch: 2, radialFlow: 1.91,
    radialSpin: -0.24, twist: -0, vortex: -0, hole: 1, colorMode: "stripes", colorA: "#ffffffff",
    colorB: "#00000000", colorC: "#dfeaff00", tintColor: "#ffffff00", softness: 0.41, shiftRed: -0.7, shiftBlue: -0.59,
    repetition: 1.14, stripeFlow: 0.99, spread: 0.02, brightness: 1, contrast: 1, vignette: 0, detailFade: 1,
    backgroundColor: "#00000000", opacity: 1, fadeTop: 0.5, fadeBottom: 0.5, threshold: 0.72,
  },
  {
    speed: 0.05, initialTime: 0, zoom: 2, iterations: 3, sampleGap: 0.147, tangentForce: -1.2, gradientForce: 0.5,
    centerX: 0.5, centerY: 1, radialMix: 1, beams: 5, beamWidth: 1, radialStretch: 2, radialFlow: 1.91,
    radialSpin: -0.24, twist: -0, vortex: -0, hole: 1, colorMode: "stripes", colorA: "#ffffffff",
    colorB: "#00000000", colorC: "#dfeaff00", tintColor: "#ffffff00", softness: 0.41, shiftRed: -0.7, shiftBlue: -0.59,
    repetition: 1.14, stripeFlow: 0.99, spread: 0.02, brightness: 1, contrast: 1, vignette: 0, detailFade: 1,
    backgroundColor: "#00000000", opacity: 1, fadeTop: 0.5, fadeBottom: 0.5, threshold: 0.72,
  },
];

export const SWIRL_BACKDROP_KEYFRAMES: MetallicSwirlParams[] = BASE.map((p) => ({ ...METALLIC_SWIRL_DEFAULTS, ...p }));

/**
 * Keyframes for the second backdrop (Values + AI band). Frame 0 continues
 * the first backdrop's last frame (same palette and flow, centre moved to
 * the top edge so the swirl carries across the seam); later frames drift the
 * centre, spin and beam count so each section gets its own shapes while the
 * motion stays continuous. Opacity eases down so the footer approach is calm.
 */
const TAIL = SWIRL_BACKDROP_KEYFRAMES[SWIRL_BACKDROP_KEYFRAMES.length - 1];
const TAIL_BASE: Partial<MetallicSwirlParams>[] = [
  { centerX: 0.5, centerY: 0, speed: 0.1 },
  { centerX: 0.3, centerY: 0.5, speed: 0.1, radialFlow: 1.5, radialSpin: -0.18, twist: 0.15, vortex: -0.1, beams: 4, radialStretch: 1.6, opacity: 0.6 },
  { centerX: 0.7, centerY: 0.5, speed: 0.1, radialFlow: 1.7, radialSpin: -0.3, twist: -0.1, vortex: -0.05, beams: 3, radialStretch: 1.3, opacity: 0.45 },
  { centerX: 0.5, centerY: 0.9, speed: 0.1, radialFlow: 1.9, radialSpin: -0.24, beams: 4, radialStretch: 1.8, opacity: 0.3 },
];
export const SWIRL_TAIL_KEYFRAMES: MetallicSwirlParams[] = TAIL_BASE.map((p) => ({ ...TAIL, ...p }));
