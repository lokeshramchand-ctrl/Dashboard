import { FRAGMENT_SHADER, QUAD_VERTICES, VERTEX_SHADER, hexToRgba, type MetallicSwirlParams } from "./shaders";

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log ?? "unknown"}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("program allocation failed");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
  const log = ok ? "" : [gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment), gl.getProgramInfoLog(program)].filter(Boolean).join(" | ");
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!ok) {
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log || "unknown"}`);
  }
  return program;
}

export interface MetallicSwirlRenderer {
  setParams(next: MetallicSwirlParams): void;
  dispose(): void;
}

export interface CreateMetallicSwirlRendererOptions {
  params: MetallicSwirlParams;
  animated: boolean;
  onReady: () => void;
  onError: () => void;
}

export function createMetallicSwirlRenderer(
  canvas: HTMLCanvasElement,
  { params, animated, onReady, onError }: CreateMetallicSwirlRendererOptions,
): MetallicSwirlRenderer {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error("webgl2 unavailable");

  const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
  const positionLoc = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const loc = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    time: loc("uTime"), res: loc("uRes"), zoom: loc("uZoom"), iter: loc("uIter"), eps: loc("uEps"),
    tangent: loc("uTangent"), grad: loc("uGrad"), bright: loc("uBright"), contrast: loc("uContrast"), bg: loc("uBg"),
    alpha: loc("uAlpha"), radial: loc("uRadial"), beams: loc("uBeams"), stretch: loc("uStretch"), flow: loc("uFlow"),
    spinPhase: loc("uSpinPhase"), beamWidth: loc("uBeamWidth"), twist: loc("uTwist"), vortex: loc("uVortex"),
    hole: loc("uHole"), center: loc("uCenter"), vignette: loc("uVignette"), colorMode: loc("uColorMode"),
    colorA: loc("uColorA"), colorB: loc("uColorB"), colorC: loc("uColorC"), tint: loc("uTint"),
    repetition: loc("uRepetition"), softness: loc("uSoftness"), bandWidth: loc("uBandWidth"), shiftRed: loc("uShiftRed"),
    shiftBlue: loc("uShiftBlue"), stripePhase: loc("uStripePhase"), stripeRadial: loc("uStripeRadial"),
    spread: loc("uSpread"), threshold: loc("uThreshold"), detailFade: loc("uDetailFade"), fadeLeft: loc("uFadeLeft"),
    fadeRight: loc("uFadeRight"), fadeTop: loc("uFadeTop"), fadeBottom: loc("uFadeBottom"),
  };

  let p = params;
  const writeParams = () => {
    const [bgR, bgG, bgB, bgA] = hexToRgba(p.backgroundColor);
    const [aR, aG, aB, aA] = hexToRgba(p.colorA);
    const [bR, bG, bB, bA] = hexToRgba(p.colorB);
    const [cR, cG, cB, cA] = hexToRgba(p.colorC);
    const [tR, tG, tB, tA] = hexToRgba(p.tintColor);
    gl.uniform1f(u.zoom, p.zoom);
    gl.uniform1f(u.iter, p.iterations);
    gl.uniform1f(u.eps, Math.max(p.sampleGap, 1e-4));
    gl.uniform1f(u.tangent, p.tangentForce);
    gl.uniform1f(u.grad, p.gradientForce);
    gl.uniform1f(u.bright, p.brightness);
    gl.uniform1f(u.contrast, p.contrast);
    gl.uniform4f(u.bg, bgR, bgG, bgB, bgA);
    gl.uniform1f(u.alpha, p.opacity);
    gl.uniform1f(u.radial, p.radialMix);
    gl.uniform1f(u.beams, Math.round(p.beams));
    gl.uniform1f(u.stretch, p.radialStretch);
    gl.uniform1f(u.flow, p.radialFlow);
    gl.uniform1f(u.beamWidth, p.beamWidth);
    gl.uniform1f(u.twist, p.twist);
    gl.uniform1f(u.vortex, p.vortex);
    gl.uniform1f(u.hole, p.hole);
    gl.uniform2f(u.center, p.centerX, p.centerY);
    gl.uniform1f(u.vignette, p.vignette);
    gl.uniform1i(u.colorMode, p.colorMode === "stripes" ? 1 : 0);
    gl.uniform4f(u.colorA, aR, aG, aB, aA);
    gl.uniform4f(u.colorB, bR, bG, bB, bA);
    gl.uniform4f(u.colorC, cR, cG, cB, cA);
    gl.uniform4f(u.tint, tR, tG, tB, tA);
    gl.uniform1f(u.repetition, p.repetition);
    gl.uniform1f(u.softness, p.softness);
    gl.uniform1f(u.bandWidth, p.bandWidth);
    gl.uniform1f(u.shiftRed, p.shiftRed);
    gl.uniform1f(u.shiftBlue, p.shiftBlue);
    gl.uniform1f(u.spread, p.spread);
    gl.uniform1f(u.stripeRadial, p.stripeRadial);
    gl.uniform1f(u.threshold, p.threshold);
    gl.uniform1f(u.detailFade, p.detailFade);
    gl.uniform1f(u.fadeLeft, p.fadeLeft);
    gl.uniform1f(u.fadeRight, p.fadeRight);
    gl.uniform1f(u.fadeTop, p.fadeTop);
    gl.uniform1f(u.fadeBottom, p.fadeBottom);
  };
  writeParams();

  // Elapsed intrinsic time (speed-scaled). Stripe/spin phases integrate
  // their *rate* each frame rather than recomputing `time * flow`, so a
  // mid-scroll change to stripeFlow/radialSpin (the scroll keyframes vary
  // them continuously) never snaps the pattern.
  let elapsed = 0;
  const time = () => p.initialTime + elapsed;
  let lastTime = time();
  let stripePhase = lastTime * p.stripeFlow;
  let spinPhase = lastTime * p.radialSpin;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      if (!running) draw();
    }
  };

  const draw = () => {
    const now = time();
    const dt = now - lastTime;
    lastTime = now;
    stripePhase += dt * p.stripeFlow;
    spinPhase += dt * p.radialSpin;
    gl.uniform1f(u.time, now);
    gl.uniform1f(u.stripePhase, stripePhase);
    gl.uniform1f(u.spinPhase, spinPhase);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (!firedReady) {
      firedReady = true;
      onReady();
    }
  };

  let firedReady = false;
  let disposed = false;
  let running = false;
  let rafId = 0;
  let lastFrameTime = 0;
  let visible = true;

  const shouldRun = () => !disposed && visible && document.visibilityState === "visible" && animated && p.speed !== 0;

  const tick = (now: number) => {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    elapsed += dt * p.speed;
    draw();
    if (shouldRun()) {
      rafId = requestAnimationFrame(tick);
    } else {
      running = false;
    }
  };

  const setRunning = (next: boolean) => {
    if (running === next) return;
    running = next;
    if (next) {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafId);
    }
  };

  const evaluate = () => setRunning(shouldRun());

  resize();
  draw();
  evaluate();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    evaluate();
  });
  intersectionObserver.observe(canvas);

  const onVisibilityChange = () => evaluate();
  document.addEventListener("visibilitychange", onVisibilityChange);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    setRunning(false);
    onError();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  return {
    setParams(next) {
      if (disposed) return;
      p = next;
      writeParams();
      if (!running) draw();
      evaluate();
    },
    dispose() {
      disposed = true;
      setRunning(false);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      // See hero-liquid/renderer.ts: no explicit loseContext() so React's
      // dev-mode double effect invocation can safely reuse this canvas.
    },
  };
}
