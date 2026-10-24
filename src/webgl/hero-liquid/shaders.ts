// Hero liquid shader, adapted from splsystems.com's: 8 ribbon slots and a
// calmer, flow-only look (no swirl) for a bundle of lines streaming rightward.

export const VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = pos;
  gl_Position = vec4(pos * 2. - 1., 0., 1.);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform sampler2D u_meta;
uniform sampler2D u_edge;
uniform vec2 u_resolution;
uniform float u_time;

uniform float u_softness;
uniform float u_repetition;
uniform float u_shiftRed;
uniform float u_shiftBlue;
uniform float u_shadowBlue;
uniform float u_distortion;
uniform float u_contour;
uniform float u_angle;
uniform float u_flow;
uniform vec2 u_pointer;
uniform float u_hover;

uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;

uniform float u_branchReveal[8];
uniform float u_feather;

in vec2 v_uv;
out vec4 fragColor;

#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float getColorChanges(float c1, float c2, float stripe_p, vec3 w, float blur, float bump) {
  float ch = mix(c2, c1, smoothstep(.0, 2. * blur, stripe_p));

  float border = w[0];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  bump = smoothstep(.2, .8, bump);
  border = w[0] + .4 * (1. - bump) * w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + .5 * (1. - bump) * w[1];
  ch = mix(ch, c2, smoothstep(border, border + 2. * blur, stripe_p));

  border = w[0] + w[1];
  ch = mix(ch, c1, smoothstep(border, border + 2. * blur, stripe_p));

  float gradient_t = (stripe_p - w[0] - w[1]) / w[2];
  float gradient = mix(c1, c2, smoothstep(0., 1., gradient_t));
  ch = mix(ch, gradient, smoothstep(border, border + .5 * blur, stripe_p));

  return ch;
}

// Bicubic B-spline reconstruction of the float edge field via 4 bilinear
// taps. Plain bilinear is only piecewise-smooth: the crease shading amplifies
// its texel-cell boundaries into visible squares.
float sampleEdgeField(vec2 uv) {
  vec2 ts = vec2(textureSize(u_edge, 0));
  vec2 coord = uv * ts - 0.5;
  vec2 f = fract(coord);
  vec2 b = coord - f;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1. - 3. * f + 3. * f2 - f3) / 6.;
  vec2 w1 = (4. - 6. * f2 + 3. * f3) / 6.;
  vec2 w2 = (1. + 3. * f + 3. * f2 - 3. * f3) / 6.;
  vec2 w3 = f3 / 6.;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 p0 = (b - 1. + w1 / g0 + 0.5) / ts;
  vec2 p1 = (b + 1. + w3 / g1 + 0.5) / ts;
  float s00 = texture(u_edge, vec2(p0.x, p0.y)).r;
  float s10 = texture(u_edge, vec2(p1.x, p0.y)).r;
  float s01 = texture(u_edge, vec2(p0.x, p1.y)).r;
  float s11 = texture(u_edge, vec2(p1.x, p1.y)).r;
  return g0.y * (g0.x * s00 + g1.x * s10) + g1.y * (g0.x * s01 + g1.x * s11);
}

void main() {
  const float firstFrameOffset = 2.8;
  float t = .3 * (u_time + firstFrameOffset);

  // Screen maps to the visible sub-rect of the padded mask texture
  vec2 uv = u_uvOffset + vec2(v_uv.x, 1.0 - v_uv.y) * u_uvScale;
  vec2 dudx = dFdx(uv);
  vec2 dudy = dFdy(uv);
  vec4 img = textureGrad(u_image, uv, dudx, dudy);
  vec4 meta = textureGrad(u_meta, uv, dudx, dudy);

  int branch = clamp(int(meta.r * 8.0), 0, 7);

  // Interleaved gradient noise, shared by the reveal front and the color
  // banding fix (sin-based hashes pattern up on Apple GPUs)
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - .5;

  // Trim-path reveal with a feathered front. The edge field (0 at the pipe
  // centerline, 1 at its sides) bows the fade forward in the middle, so the
  // soft tip rounds outward like a cap instead of a flat cut caving in.
  // Arc length is 16-bit across the G/B pair (NEAREST keeps them consistent)
  float pathParam = (meta.g * 65280. + meta.b * 255.) / 65535.;
  float edgeRaw = clamp(sampleEdgeField(uv), 0., 1.);
  float reveal = u_branchReveal[branch];
  float front = pathParam + u_feather * edgeRaw;
  float visible = 1.0 - smoothstep(reveal - u_feather, reveal, front);

  float cycleWidth = u_repetition;

  vec2 rotatedUV = uv - vec2(.5);
  float angle = (-u_angle + 70.) * PI / 180.;
  float cosA = cos(angle);
  float sinA = sin(angle);
  rotatedUV = vec2(
    rotatedUV.x * cosA - rotatedUV.y * sinA,
    rotatedUV.x * sinA + rotatedUV.y * cosA
  ) + vec2(.5);

  float edge = pow(edgeRaw, 1.6);
  edge *= smoothstep(0.0, 0.4, u_contour);

  // Coverage is re-thresholded against its own screen-space derivative:
  // magnified bilinear ramps become a crisp, consistently anti-aliased edge
  float aaw = max(fwidth(img.g), 1e-4);
  float opacity = clamp((img.g - .5) / aaw + .5, 0., 1.) * visible;

  // Un-premultiplied branch gray: B and R are a matched feathered pair, so
  // the ratio is smooth across branch seams and stable at the silhouette
  float shade = clamp(img.b / max(img.r, 0.004), 0., 1.);

  float diagBLtoTR = rotatedUV.x - rotatedUV.y;

  float c1 = min(1., .72 + .5 * shade);
  float c2 = .05 + .85 * shade;
  vec3 color1 = vec3(.98 * c1, .98 * c1, c1);
  vec3 color2 = vec3(c2, c2, c2 + u_shadowBlue);

  vec2 grad_uv = uv - .5;

  float dist = length(grad_uv + vec2(0., .2 * diagBLtoTR));
  // The spatially varying rotation makes the scroll swirl around the center;
  // u_flow fades it out so the phase gradient straightens to +x and the
  // pattern translates left to right (time is subtracted from the phase)
  grad_uv = rotate(grad_uv, (1. - u_flow) * (.25 - .2 * diagBLtoTR) * PI);
  float direction = grad_uv.x;

  float bump = pow(1.8 * dist, 1.2);
  bump = 1. - bump;
  bump *= pow(uv.y, .3);

  float thin_strip_1_ratio = .12 / cycleWidth * (1. - .4 * bump);
  float thin_strip_2_ratio = .07 / cycleWidth * (1. + .4 * bump);
  float wide_strip_ratio = (1. - thin_strip_1_ratio - thin_strip_2_ratio);

  float thin_strip_1_width = cycleWidth * thin_strip_1_ratio;
  float thin_strip_2_width = cycleWidth * thin_strip_2_ratio;

  // Noise drifts with the flow: diagonal for the original look, horizontal
  // when flowing left to right
  float noise = snoise(uv - mix(vec2(t), vec2(t, 0.), u_flow));

  edge += (1. - edge) * u_distortion * noise;

  // In flow mode the diagonal tilt is toned down — at full strength its
  // constant gradient dominates the x-ramp and drags the motion off-axis
  direction += mix(1., .3, u_flow) * diagBLtoTR;
  direction -= 2. * noise * diagBLtoTR * (smoothstep(0., 1., edge) * (1.0 - smoothstep(0., 1., edge)));
  direction *= mix(1., 1. - edge, smoothstep(.5, 1., u_contour));
  direction -= 1.7 * edge * smoothstep(.5, 1., u_contour);
  direction += .2 * pow(u_contour, 4.) * (1.0 - smoothstep(0., 1., edge));

  bump *= clamp(pow(uv.y, .1), .3, 1.);
  // Multiplying the traveling x-ramp by the radial bump bends the phase
  // gradient toward the center (motion reads as radiating from the middle);
  // in flow mode a flat factor keeps the stripe richness without the pull
  direction *= (.1 + (1.1 - edge) * mix(bump, .6, u_flow));

  direction *= (.4 + .6 * (1.0 - smoothstep(.5, 1., edge)));
  direction += .18 * (smoothstep(.1, .2, uv.y) * (1.0 - smoothstep(.2, .4, uv.y)));
  direction += .03 * (smoothstep(.1, .2, 1. - uv.y) * (1.0 - smoothstep(.2, .4, 1. - uv.y)));

  // Same reasoning: the y-dependent scale is center-symmetric on the x-ramp
  direction *= mix(.5 + .5 * pow(uv.y, 2.), 1., u_flow);
  direction *= cycleWidth;
  direction -= t;
  // No per-branch phase offset: any phase coupling to shade sweeps through
  // whole stripe cycles inside the 2px seam blend, rendering a torn glitter
  // line where pipes cross

  float colorDispersion = clamp(1. - bump, 0., 1.);
  float dispersionRed = colorDispersion;
  dispersionRed += .03 * bump * noise;
  dispersionRed += 5. * (smoothstep(-.1, .2, uv.y) * (1.0 - smoothstep(.1, .5, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, 1., bump)));
  dispersionRed -= diagBLtoTR;

  float dispersionBlue = colorDispersion * 1.3;
  dispersionBlue += (smoothstep(0., .4, uv.y) * (1.0 - smoothstep(.1, .8, uv.y))) * (smoothstep(.4, .6, bump) * (1.0 - smoothstep(.4, .8, bump)));
  dispersionBlue -= .2 * edge;

  dispersionRed *= (u_shiftRed / 20.);
  dispersionBlue *= (u_shiftBlue / 20.);

  float softness = 0.05 * u_softness;
  float blur = softness + .5 * smoothstep(1., 10., u_repetition) * smoothstep(.0, 1., edge);
  float smallCanvasT = 1.0 - smoothstep(100., 500., min(u_resolution.x, u_resolution.y));
  blur += smallCanvasT * smoothstep(.0, 1., edge);
  float rExtraBlur = softness * (0.05 + .1 * (u_shiftRed / 20.) * bump);
  float gExtraBlur = softness * 0.05 / max(0.001, abs(1. - diagBLtoTR));

  vec3 w = vec3(thin_strip_1_width, thin_strip_2_width, wide_strip_ratio);
  w[1] -= .02 * smoothstep(.0, 1., edge + bump);
  // AA widths are taken from the continuous phase, not its fract: fract's
  // wrap jumps make fwidth spike on alternating quads, which shows up as a
  // checkerboard on Apple GPUs
  // Two-regime stripe AA: moderate derivatives are clamped (their per-quad
  // estimation noise reads as a checkerboard on Apple GPUs), but large ones
  // pass through — the crease flanks sweep whole stripe cycles across a few
  // pixels and alias into ragged sparkle without real derivative AA
  float fwCap = .2 * blur;
  float fw_r = fwidth(direction + dispersionRed);
  float fw_g = fwidth(direction);
  float fw_b = fwidth(direction - dispersionBlue);
  fw_r = mix(min(fw_r, fwCap), fw_r, smoothstep(4. * fwCap, 12. * fwCap, fw_r));
  fw_g = mix(min(fw_g, fwCap), fw_g, smoothstep(4. * fwCap, 12. * fwCap, fw_g));
  fw_b = mix(min(fw_b, fwCap), fw_b, smoothstep(4. * fwCap, 12. * fwCap, fw_b));
  float stripe_r = fract(direction + dispersionRed);
  float r = getColorChanges(color1.r, color2.r, stripe_r, w, blur + fw_r + rExtraBlur, bump);
  float stripe_g = fract(direction);
  float g = getColorChanges(color1.g, color2.g, stripe_g, w, blur + fw_g + gExtraBlur, bump);
  float stripe_b = fract(direction - dispersionBlue);
  float b = getColorChanges(color1.b, color2.b, stripe_b, w, blur + fw_b, bump);

  // Four bands in the logo's four colours, in logo order: S red #ed272e,
  // P blue #0870b9, L green #3eb850, SYSTEMS periwinkle #8499e2. Each band
  // bleeds toward its right-hand neighbour's hue as the flow phase passes,
  // so the wave reads as one continuous gradient across the group.
  const vec3 cols[4] = vec3[4](
    vec3(.929, .153, .180),
    vec3(.031, .439, .725),
    vec3(.243, .722, .314),
    vec3(.518, .600, .886)
  );
  vec3 base = cols[branch % 4];
  vec3 accent = cols[(branch + 1) % 4];

  float fl = pathParam - .3 * u_time * .5;
  float wave = .5 + .5 * cos(2. * PI * (fl * 1.2 + float(branch) * .17));
  wave = smoothstep(0., 1., wave);
  // Hover: near the pointer, bands lean into the next brand color and brighten
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.);
  float hoverD = distance(vec2(v_uv.x, 1.0 - v_uv.y) * aspect, u_pointer * aspect);
  float h = u_hover * (1. - smoothstep(0., .45, hoverD));
  vec3 hue = mix(base, accent, clamp(.55 * smoothstep(.55, 1., wave) * (1. - edgeRaw) + .75 * h, 0., 1.));

  // Crisp rim at the band sides, soft glow toward the center, fading out
  // toward the bottom-left tail
  float rim = smoothstep(.55, .95, edgeRaw);
  float glow = pow(1. - edgeRaw, 1.3) * (.25 + .75 * wave);
  float along = smoothstep(.05, .6, pathParam);
  float intensity = clamp((.55 * rim + glow) * (.25 + .75 * along), 0., 1.);
  opacity *= clamp(intensity * (1. + .7 * h), 0., 1.);
  vec3 smoothColor = hue;

  vec3 color = smoothColor * opacity;

  // Dither against banding: interleaved gradient noise — sin-based hashes
  // produce structured patterns on Apple GPUs. Scaled by opacity to keep the
  // premultiplied color valid, or it composites as a dot grid onto the page
  color = clamp(color + (1. / 255.) * dither * opacity, 0., opacity);

  fragColor = vec4(color, opacity);
}
`;

export interface LiquidEffectParams {
  repetition: number;
  softness: number;
  shiftRed: number;
  shiftBlue: number;
  shadowBlue: number;
  distortion: number;
  contour: number;
  angle: number;
  flow: number;
  speed: number;
}

export const HERO_LIQUID_EFFECT: LiquidEffectParams = {
  repetition: 1.1,
  softness: 1,
  shiftRed: 0.61,
  shiftBlue: 0.33,
  shadowBlue: 0.075,
  distortion: 0.03,
  contour: 0.97,
  angle: 0,
  flow: 1,
  speed: 0.36,
};

export interface IntroTiming {
  startDelay: number;
  stagger: number;
  duration: number;
  feather: number;
}

export const HERO_LIQUID_INTRO: IntroTiming = {
  startDelay: 0,
  stagger: 0.12,
  duration: 2.5,
  feather: 0.2,
};
