
import { useEffect, useRef, useState } from "react";
import { BRANCHES, STROKE_WIDTH } from "./constants";
import { buildLiquidMask, createRasterizer, type LiquidMask } from "./mask";
import type { MaskRequest } from "./mask.worker";
import { createLiquidRenderer, type LiquidRenderer } from "./renderer";
import { HERO_LIQUID_EFFECT, type LiquidEffectParams } from "./shaders";

/** Flat-color fallback ribbons, generated from the same branch geometry the WebGL mask uses. */
function HeroLines({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  // Logo colours, same red / blue / green / periwinkle order as the shader.
  const grays =
    tone === "light"
      ? ["#f8bcbe", "#a9cce6", "#bfe6c5", "#d4dbf5"]
      : ["#ed272e", "#0870b9", "#3eb850", "#8499e2"];
  return (
    <svg
      className={className}
      viewBox="0 0 1440 810"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      {BRANCHES.map((branch, i) => (
        <path
          key={i}
          d={`M${branch.start[0]} ${branch.start[1]} ${branch.curves
            .map(([c1x, c1y, c2x, c2y, ex, ey]) => `C${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`)
            .join(" ")}`}
          stroke={grays[i]}
          strokeWidth={STROKE_WIDTH}
        />
      ))}
    </svg>
  );
}

// Promises, so a remount (React dev double-invoke, client-side return to
// Home) reuses an in-flight build instead of starting another.
const maskCache = new Map<string, Promise<LiquidMask>>();

/** Main-thread build, for browsers without OffscreenCanvas in workers. */
function buildOnMainThread(width: number, shadeFloor: number): Promise<LiquidMask> {
  return new Promise((resolve, reject) => {
    // Let the first paint and the intro splash go out before blocking.
    window.setTimeout(() => {
      try {
        const rasterize = createRasterizer((w, h) => {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) throw new Error("2d context unavailable");
          return ctx;
        });
        resolve(buildLiquidMask({ width, shadeFloor }, rasterize));
      } catch (error) {
        reject(error);
      }
    }, 150);
  });
}

function buildInWorker(width: number, shadeFloor: number): Promise<LiquidMask> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mask.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<LiquidMask>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new Error(event.message || "mask worker failed"));
    };
    worker.postMessage({ width, shadeFloor } satisfies MaskRequest);
  });
}

function loadLiquidMask(width: number, shadeFloor: number): Promise<LiquidMask> {
  const key = `${width}:${shadeFloor}`;
  const cached = maskCache.get(key);
  if (cached) return cached;
  const canUseWorker = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
  const mask = canUseWorker
    ? buildInWorker(width, shadeFloor).catch(() => buildOnMainThread(width, shadeFloor))
    : buildOnMainThread(width, shadeFloor);
  // A failed build shouldn't poison later mounts.
  mask.catch(() => maskCache.delete(key));
  maskCache.set(key, mask);
  return mask;
}

export interface HeroLiquidProps {
  intro?: boolean;
  shadeFloor?: number;
  /** Overrides applied on top of the hero's default shader tuning, so other sections can reuse the same proven effect with a distinct look. */
  params?: Partial<LiquidEffectParams>;
  /** Flips the ribbon composition horizontally for compositional variety between sections. */
  mirror?: boolean;
  /** Fallback stroke tone for prefers-reduced-motion / no-WebGL, matched to the section's background. */
  fallbackTone?: "dark" | "light";
  className?: string;
}

export function HeroLiquid({
  intro = true,
  shadeFloor = 0.35,
  params,
  mirror = false,
  fallbackTone = "dark",
  className = "",
}: HeroLiquidProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "active" | "fallback">("loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // One-time feature detection on mount (reduced-motion / no canvas), not a
      // response to a prop/state change — the synchronous setState here is the
      // progressive-enhancement fallback, mirroring the source site's behavior.
      setStatus("fallback");
      return;
    }
    let cancelled = false;
    let renderer: LiquidRenderer | null = null;

    const width = Math.max(window.innerWidth, window.innerHeight * 1.25) >= 1024 ? 2048 : 1024;

    loadLiquidMask(width, shadeFloor).then(
      (mask) => {
        if (cancelled) return;
        try {
          renderer = createLiquidRenderer(canvas, mask, {
            intro,
            params: params ? { ...HERO_LIQUID_EFFECT, ...params } : undefined,
            onActive: () => !cancelled && setStatus("active"),
            onError: () => !cancelled && setStatus("fallback"),
          });
        } catch {
          setStatus("fallback");
        }
      },
      () => !cancelled && setStatus("fallback"),
    );

    return () => {
      cancelled = true;
      renderer?.dispose();
    };
    // `params`/`mirror`/`fallbackTone` are a fixed per-instance tuning, not reactive
    // state — each section mounts its own HeroLiquid once and never changes the tuning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro, shadeFloor]);

  const linesHidden = status !== "fallback" && (intro || status === "active");

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden="true"
    >
      <HeroLines
        tone={fallbackTone}
        className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${linesHidden ? "opacity-0" : "opacity-20"}`}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        data-active={status === "active"}
        hidden={status === "fallback"}
      />
    </div>
  );
}
