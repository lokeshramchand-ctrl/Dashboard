import { BRANCHES, MAX_BRANCHES, REGION, STROKE_WIDTH, branchTone, buildBranchPath, flattenBranch } from "./constants";

export interface LiquidMask {
  /** RGBA: R blurred coverage, G sharp coverage, B shading, A 255. */
  base: Uint8Array;
  /** RGBA: R branch id (0.5,1.5,2.5,3.5 of 4 scaled to 0-255), G/B 16-bit arc length. */
  meta: Uint8Array;
  width: number;
  height: number;
  /** Per-branch distance-like field, half resolution. */
  field: Float32Array;
  fieldWidth: number;
  fieldHeight: number;
}

type Rasterize = (branch: Path2D, width: number, height: number) => Uint8Array;

const regionHeightFor = (width: number) => Math.round((width * REGION.height) / REGION.width);

/** Creates a cached canvas-2d stroke rasterizer: branch path -> alpha coverage. */
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createRasterizer(makeContext: (width: number, height: number) => Context2D): Rasterize {
  const cache = new Map<number, Context2D>();
  return (branch, width, height) => {
    let ctx = cache.get(width);
    if (!ctx) {
      ctx = makeContext(width, height);
      cache.set(width, ctx);
    }
    const scale = width / REGION.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, -REGION.x * scale, -REGION.y * scale);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = "butt";
    ctx.strokeStyle = "#fff";
    ctx.stroke(branch);
    const data = ctx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[4 * i + 3];
    return alpha;
  };
}

/** Nearest-point-on-polyline distance field + arc-length param, at field resolution. */
function arcLengthField(
  points: Float64Array,
  cumulative: Float64Array,
  total: number,
  fieldWidth: number,
  fieldHeight: number,
): Uint16Array {
  const scale = fieldWidth / REGION.width;
  const offsetX = -REGION.x * scale;
  const offsetY = -REGION.y * scale;
  const pad = (STROKE_WIDTH / 2) * scale + 8;
  const minDistSq = new Float32Array(fieldWidth * fieldHeight).fill(Infinity);
  const param = new Uint16Array(fieldWidth * fieldHeight);

  for (let i = 1; i < cumulative.length; i++) {
    const x0 = points[2 * i - 2] * scale + offsetX;
    const y0 = points[2 * i - 1] * scale + offsetY;
    const x1 = points[2 * i] * scale + offsetX;
    const y1 = points[2 * i + 1] * scale + offsetY;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLenSq = dx * dx + dy * dy;
    const t0 = cumulative[i - 1] / total;
    const t1 = cumulative[i] / total;

    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
    const maxX = Math.min(fieldWidth - 1, Math.ceil(Math.max(x0, x1) + pad));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
    const maxY = Math.min(fieldHeight - 1, Math.ceil(Math.max(y0, y1) + pad));

    for (let py = minY; py <= maxY; py++) {
      const row = py * fieldWidth;
      for (let px = minX; px <= maxX; px++) {
        const t = segLenSq > 0 ? Math.min(Math.max(((px - x0) * dx + (py - y0) * dy) / segLenSq, 0), 1) : 0;
        const ex = px - (x0 + t * dx);
        const ey = py - (y0 + t * dy);
        const distSq = ex * ex + ey * ey;
        const idx = row + px;
        if (distSq < minDistSq[idx]) {
          minDistSq[idx] = distSq;
          param[idx] = Math.round((t0 + (t1 - t0) * t) * 65535);
        }
      }
    }
  }
  return param;
}

/** Separable 5-wide box blur. */
function boxBlur5(src: Uint8Array, width: number, height: number): Uint8Array {
  const horizontal = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += src[row + Math.min(Math.max(k, 0), width - 1)];
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / 5;
      sum += src[row + Math.min(x + 3, width - 1)] - src[row + Math.max(x - 2, 0)];
    }
  }
  // Vertical pass walks rows with one running sum per column: the column-major
  // version strides `width` floats per step and thrashes the cache (it was
  // half the whole mask build at 2048px).
  const out = new Uint8Array(src.length);
  const sums = new Float64Array(width);
  for (let k = -2; k <= 2; k++) {
    const row = Math.min(Math.max(k, 0), height - 1) * width;
    for (let x = 0; x < width; x++) sums[x] += horizontal[row + x];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const add = Math.min(y + 3, height - 1) * width;
    const sub = Math.max(y - 2, 0) * width;
    for (let x = 0; x < width; x++) {
      out[row + x] = Math.round(sums[x] / 5);
      sums[x] += horizontal[add + x] - horizontal[sub + x];
    }
  }
  return out;
}

/** Relaxes a pseudo-distance field inside the binary stroke mask (SOR smoothing). */
function relax(mask: Uint8Array, width: number, height: number): Float32Array {
  const red: number[] = [];
  const black: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - width] && mask[i + width] &&
          mask[i - width - 1] && mask[i - width + 1] && mask[i + width - 1] && mask[i + width + 1]) {
        if (((x + y) & 1) === 0) red.push(i);
        else black.push(i);
      }
    }
  }
  const redIdx = Uint32Array.from(red);
  const blackIdx = Uint32Array.from(black);
  const field = new Float32Array(width * height);
  for (let iter = 0; iter < 40; iter++) {
    for (const group of [redIdx, blackIdx]) {
      for (let i = 0; i < group.length; i++) {
        const idx = group[i];
        const avg = (0.01 + field[idx - 1] + field[idx + 1] + field[idx - width] + field[idx + width]) * 0.25;
        field[idx] = 1.9 * avg - 0.9 * field[idx];
      }
    }
  }
  return field;
}

/** Normalizes `field` against its own max, kept only where `mask` is set. */
function normalizeAgainstMax(field: Float32Array, mask: Uint8Array): Float32Array {
  let max = 0;
  for (const v of field) if (v > max) max = v;
  const out = new Float32Array(field.length).fill(1);
  if (max <= 0) return out;
  for (let i = 0; i < field.length; i++) if (mask[i]) out[i] = 1 - field[i] / max;
  return out;
}

export function buildLiquidMask({ width, shadeFloor }: { width: number; shadeFloor: number }, rasterize: Rasterize): LiquidMask {
  const height = regionHeightFor(width);
  const fieldWidth = Math.round(width / 2);
  const fieldHeight = regionHeightFor(fieldWidth);

  const base = new Uint8Array(width * height * 4);
  const meta = new Uint8Array(width * height * 4);
  for (let i = 0; i < base.length; i += 4) {
    base[i + 3] = 255;
    meta[i + 3] = 255;
  }
  const field = new Float32Array(fieldWidth * fieldHeight).fill(1);

  BRANCHES.forEach((branch, branchIndex) => {
    const flat = flattenBranch(branch);
    const path = buildBranchPath(branch);
    const coverage = rasterize(path, width, height);
    const arcLength = arcLengthField(flat.points, flat.cumulative, flat.total, width, height);
    const blurred = boxBlur5(coverage, width, height);

    const fieldCoverage = rasterize(path, fieldWidth, fieldHeight);
    const fieldMask = new Uint8Array(fieldCoverage.length);
    for (let i = 0; i < fieldMask.length; i++) fieldMask[i] = fieldCoverage[i] > 127 ? 1 : 0;

    const relaxed = relax(fieldMask, fieldWidth, fieldHeight);
    const normalized = normalizeAgainstMax(relaxed, fieldMask);

    for (let i = 0; i < field.length; i++) {
      const t = fieldCoverage[i] / 255;
      if (t > 0) field[i] = normalized[i] * t + field[i] * (1 - t);
    }

    const branchId = Math.round((branchIndex + 0.5) * (255 / MAX_BRANCHES));
    const shade = Math.round(255 * branchTone(branch.gray, shadeFloor));

    for (let i = 0; i < coverage.length; i++) {
      const sharp = coverage[i];
      const blur = blurred[i];
      if (!sharp && !blur) continue;
      const o = 4 * i;
      const blurAlpha = blur / 255;
      base[o] = Math.round(blur + base[o] * (1 - blurAlpha));
      base[o + 1] = Math.round(sharp + base[o + 1] * (1 - sharp / 255));
      base[o + 2] = Math.round(shade * blurAlpha + base[o + 2] * (1 - blurAlpha));
      if (sharp) {
        meta[o] = branchId;
        meta[o + 1] = arcLength[i] >> 8;
        meta[o + 2] = arcLength[i] & 255;
      }
    }
  });

  return { base, meta, width, height, field, fieldWidth, fieldHeight };
}
