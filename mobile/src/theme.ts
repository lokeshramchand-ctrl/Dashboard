import { useColorScheme } from 'react-native';

// Mirrors the web UI tokens (src/styles.css): ink on off-white, black dark theme, logo colours for status.
const light = {
  bg: '#f6f6f7', surface: '#ffffff', surface2: '#fafafa', border: '#e6e6e6', border2: '#cfcfcf',
  text: '#181818', muted: '#6b6b6b', accent: '#181818', onAccent: '#ffffff', soft: '#f0f0f0',
  green: '#217a30', greenSoft: 'rgba(62,184,80,0.13)', red: '#c4161c', redSoft: 'rgba(237,39,46,0.09)',
  amber: '#4a5fc2', amberSoft: 'rgba(132,153,226,0.16)', blue: '#0870b9', blueSoft: 'rgba(8,112,185,0.09)',
  chart: '#0870b9', chart2: '#3eb850',
};
const dark: typeof light = {
  bg: '#000000', surface: '#0b0b0b', surface2: '#141414', border: '#232323', border2: '#3c3c3c',
  text: '#f4f4f4', muted: '#9b9b9b', accent: '#f4f4f4', onAccent: '#000000', soft: '#1a1a1a',
  green: '#6fdc83', greenSoft: 'rgba(85,208,106,0.13)', red: '#ff7c82', redSoft: 'rgba(255,81,88,0.13)',
  amber: '#b7c4fa', amberSoft: 'rgba(163,180,245,0.15)', blue: '#5db7f2', blueSoft: 'rgba(47,157,230,0.14)',
  chart: '#2f9de6', chart2: '#55d06a',
};

export type Theme = typeof light & { dark: boolean };
export type Tone = 'green' | 'red' | 'amber' | 'blue' | 'gray';

export const radius = 14;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export function useTheme(): Theme {
  const dk = useColorScheme() === 'dark';
  return { ...(dk ? dark : light), dark: dk };
}

export function toneColors(t: Theme, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'green': return { fg: t.green, bg: t.greenSoft };
    case 'red': return { fg: t.red, bg: t.redSoft };
    case 'amber': return { fg: t.amber, bg: t.amberSoft };
    case 'blue': return { fg: t.blue, bg: t.blueSoft };
    default: return { fg: t.muted, bg: t.soft };
  }
}
