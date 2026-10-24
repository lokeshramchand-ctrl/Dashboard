
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createMetallicSwirlRenderer, type MetallicSwirlRenderer } from "./renderer";
import { METALLIC_SWIRL_DEFAULTS, type MetallicSwirlParams } from "./shaders";

export interface MetallicSwirlHandle {
  setParams(next: MetallicSwirlParams): void;
}

export interface MetallicSwirlProps {
  params?: MetallicSwirlParams;
  className?: string;
}

/** Canvas wrapper for the shared "metallic swirl" scroll backdrop shader. */
export const MetallicSwirl = forwardRef<MetallicSwirlHandle, MetallicSwirlProps>(function MetallicSwirl(
  { params = METALLIC_SWIRL_DEFAULTS, className = "" },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MetallicSwirlRenderer | null>(null);
  const latestParams = useRef(params);

  useImperativeHandle(ref, () => ({
    setParams(next) {
      latestParams.current = next;
      rendererRef.current?.setParams(next);
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const create = () => {
      try {
        rendererRef.current = createMetallicSwirlRenderer(canvas, {
          params: latestParams.current,
          animated: true,
          onReady: () => {},
          onError: () => {},
        });
      } catch {
        // Left blank: no WebGL2 support. The section's own background stands in.
      }
    };

    // These canvases sit far below the fold: don't spend a WebGL context and
    // a shader compile on them until the reader is about to scroll to them.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        create();
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      aria-hidden="true"
    />
  );
});
