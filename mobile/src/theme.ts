import { useColorScheme } from 'react-native';

// Mirrors the CSS variables in the web UI's "refined neutral theme" (src/styles.css).
const light = {
  bg: '#ffffff', surface: '#ffffff', surface2: '#fafafb', border: '#ebebef', border2: '#dcdce3',
  text: '#0e0e12', muted: '#6e6e7a', accent: '#18181b', onAccent: '#ffffff', soft: '#f3f3f6',
  green: '#12a366', greenSoft: '#e8f8f1', red: '#e03131', redSoft: '#fff1f1',
  amber: '#b7791f', amberSoft: '#fffaeb', blue: '#0a8fe0', blueSoft: '#e8f4fd',
};
const dark: typeof light = {
  bg: '#0b0b0f', surface: '#131318', surface2: '#18181f', border: '#26262f', border2: '#33333e',
  text: '#f4f4f6', muted: '#8d8d9a', accent: '#fafafa', onAccent: '#111111', soft: '#1c1c24',
  green: '#3dd68c', greenSoft: '#0f2a1f', red: '#ff6b6b', redSoft: '#2d1416',
  amber: '#f0b44a', amberSoft: '#2a210d', blue: '#4cb4ff', blueSoft: '#10263a',
};

export type Theme = typeof light & { dark: boolean };
export type Tone = 'green' | 'red' | 'amber' | 'blue' | 'gray';

export const radius = 16;
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
