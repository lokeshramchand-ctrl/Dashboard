import { buildLiquidMask, createRasterizer } from "./mask";

export interface MaskRequest {
  width: number;
  shadeFloor: number;
}

/**
 * Builds the liquid mask off the main thread. The build (rasterize + distance
 * fields + relaxation) takes ~1s on desktop and several on phones; run inline
 * it froze the page right after load.
 */
self.onmessage = (event: MessageEvent<MaskRequest>) => {
  const rasterize = createRasterizer((width, height) => {
    const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d context unavailable");
    return ctx;
  });
  const mask = buildLiquidMask(event.data, rasterize);
  self.postMessage(mask, { transfer: [mask.base.buffer, mask.meta.buffer, mask.field.buffer] });
};
