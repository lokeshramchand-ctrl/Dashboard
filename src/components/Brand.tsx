import { METALLIC_SWIRL_DEFAULTS } from '../webgl/metallic-swirl/shaders';
import type { MetallicSwirlParams } from '../webgl/metallic-swirl/shaders';
import { MetallicSwirl } from '../webgl/metallic-swirl/MetallicSwirl';

/** SPL Systems wordmark (public/brand/spl-systems.svg), as on the company site. */
export function Logo({ className = '' }: { className?: string }) {
  return <img className={`wordmark ${className}`} src="./brand/spl-systems.svg" alt="SPL Systems" width={3000} height={350} />;
}

const SWIRL: MetallicSwirlParams = { ...METALLIC_SWIRL_DEFAULTS, speed: 0.09, zoom: 1.25 };

/**
 * The company site's metallic-swirl shader (white on black), multiplied against a
 * slow gradient of the four logo colours so every highlight is a brand colour.
 */
export function BrandSwirl({ className = '', calm = false }: { className?: string; calm?: boolean }) {
  return (
    <div className={`swirl ${calm ? 'calm' : ''} ${className}`} aria-hidden="true">
      <MetallicSwirl params={calm ? { ...SWIRL, speed: 0.04 } : SWIRL} />
    </div>
  );
}
