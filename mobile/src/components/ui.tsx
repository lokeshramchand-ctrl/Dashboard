import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, toneColors, useTheme } from '../theme';
import type { Tone } from '../theme';
import type { Query } from '../useQuery';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

export function Txt({ children, muted, small, bold, tone, style, numberOfLines }: {
  children: ReactNode; muted?: boolean; small?: boolean; bold?: boolean; tone?: Tone; style?: StyleProp<import('react-native').TextStyle>; numberOfLines?: number;
}) {
  const t = useTheme();
  const color = tone ? toneColors(t, tone).fg : muted ? t.muted : t.text;
  return <Text numberOfLines={numberOfLines} style={[{ color, fontSize: small ? 12.5 : 14.5, fontWeight: bold ? '600' : '400' }, style]}>{children}</Text>;
}

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      <View style={[s.dot, { backgroundColor: c.fg }]} />
      <Text style={{ color: c.fg, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' }}>{children}</Text>
    </View>
  );
}

export function Meter({ value, tone }: { value: number; tone?: Tone }) {
  const t = useTheme();
  const v = Math.max(0, Math.min(1, value));
  const color = tone ? toneColors(t, tone).fg : v > 0.9 ? t.red : v > 0.75 ? t.amber : t.blue;
  return (
    <View style={[s.meter, { backgroundColor: t.soft }]}>
      <View style={{ width: `${v * 100}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

export function Button({ title, onPress, kind = 'default', disabled, busy }: {
  title: string; onPress: () => void; kind?: 'default' | 'primary' | 'danger'; disabled?: boolean; busy?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.red : t.surface;
  const fg = kind === 'default' ? t.text : kind === 'danger' ? '#fff' : t.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === 'default' ? t.border2 : bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const t = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text, fontWeight: '600', fontSize: 13.5 }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        style={[s.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border2 }, style]}
      />
    </View>
  );
}

export function Skeleton({ rows = 4, h = 72 }: { rows?: number; h?: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.md }} accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => <View key={i} style={{ height: h, borderRadius: radius, backgroundColor: t.soft }} />)}
    </View>
  );
}

export function StateView({ title, hint, error, onRetry }: { title: string; hint?: string; error?: boolean; onRetry?: () => void }) {
  return (
    <View style={s.state}>
      <Txt bold tone={error ? 'red' : undefined}>{title}</Txt>
      {hint ? <Txt muted small style={{ textAlign: 'center' }}>{hint}</Txt> : null}
      {onRetry ? <View style={{ marginTop: space.sm, width: 160 }}><Button title="Try again" onPress={onRetry} /></View> : null}
    </View>
  );
}

/** Loading / error / empty wrapper used by every data panel. */
export function Async<T>({ q, isEmpty, empty, rows, h, children }: {
  q: Query<T>; isEmpty?: (d: T) => boolean; empty?: { title: string; hint?: string }; rows?: number; h?: number; children: (d: T) => ReactNode;
}) {
  if (q.data === undefined) {
    if (q.error) return <StateView error title="Couldn't load this" hint={q.error.message} onRetry={q.reload} />;
    return <Skeleton rows={rows} h={h} />;
  }
  if (isEmpty?.(q.data)) return <StateView title={empty?.title ?? 'Nothing here yet'} hint={empty?.hint} />;
  return (
    <>
      {q.error ? (
        <View style={{ marginBottom: space.md }}><Badge tone="amber">Offline: showing last known data</Badge></View>
      ) : null}
      {children(q.data)}
    </>
  );
}

/** Scrolling screen with a large title and pull-to-refresh bound to the given queries. */
export function Screen({ title, sub, queries = [], children, header, back }: {
  title: string; sub?: string; queries?: Query<unknown>[]; children: ReactNode; header?: ReactNode; back?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const refreshing = queries.some((q) => q.refreshing && q.data !== undefined);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: space.xl * 2, gap: space.lg }}
      refreshControl={queries.length ? <RefreshControl refreshing={refreshing} tintColor={t.muted} onRefresh={() => { queries.forEach((q) => q.reload()); }} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 2 }}>
        {back ? <View style={{ marginBottom: space.sm }}><BackBar title={back.label} onBack={back.onPress} /></View> : null}
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.6 }}>{title}</Text>
        {sub ? <Txt muted>{sub}</Txt> : null}
      </View>
      {header}
      {children}
    </ScrollView>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const t = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={t.muted}
      autoCapitalize="none"
      autoCorrect={false}
      clearButtonMode="while-editing"
      accessibilityLabel={placeholder}
      style={[s.input, { color: t.text, backgroundColor: t.surface2, borderColor: t.border }]}
    />
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number }[] }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.id)}
            style={[s.chip, { backgroundColor: on ? t.accent : t.soft }]}>
            <Text style={{ color: on ? t.onAccent : t.muted, fontWeight: '600', fontSize: 13.5 }}>
              {o.label}{o.count !== undefined ? `  ${o.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius, padding: space.lg },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, height: 22, borderRadius: 11, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  meter: { height: 6, borderRadius: 4, overflow: 'hidden' },
  btn: { height: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  input: { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 15.5 },
  state: { alignItems: 'center', gap: 6, paddingVertical: 40, paddingHorizontal: space.lg },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center' },
  kv: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 13 },
});

/** Label / value rows, like the PVE summary panels. */
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  const t = useTheme();
  return (
    <View>
      {rows.map(([k, v], i) => (
        <View key={k} style={[s.kv, { borderTopColor: t.border, borderTopWidth: i ? StyleSheet.hairlineWidth * 2 : 0 }]}>
          <Txt muted small style={{ width: 112 }}>{k}</Txt>
          <View style={{ flex: 1 }}>{typeof v === 'string' || typeof v === 'number' ? <Txt small bold>{v}</Txt> : v}</View>
        </View>
      ))}
    </View>
  );
}

/** Dependency-free column chart: one bar per sample, scaled to the series max. */
export function Bars({ values, color, height = 72, label }: { values: number[]; color?: string; height?: number; label: string }) {
  const t = useTheme();
  const max = Math.max(...values, 1e-9);
  const step = Math.max(1, Math.ceil(values.length / 60));
  const pts = values.filter((_, i) => i % step === 0);
  return (
    <View accessibilityLabel={label} style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
      {pts.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(1, (v / max) * height), backgroundColor: color ?? t.chart, borderTopLeftRadius: 2, borderTopRightRadius: 2, opacity: 0.35 + 0.65 * (i / pts.length) }} />
      ))}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm }}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>{children}</Text>
      {right}
    </View>
  );
}

export function BackBar({ title, onBack }: { title: string; onBack: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={`Back to ${title}`} hitSlop={12} style={{ alignSelf: 'flex-start' }}>
      <Text style={{ color: t.blue, fontSize: 15, fontWeight: '600' }}>‹ {title}</Text>
    </Pressable>
  );
}

/** Tappable settings-style row. */
export function ListRow({ title, sub, right, onPress, first }: { title: string; sub?: string; right?: ReactNode; onPress?: () => void; first?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [s.row, { borderTopColor: t.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth * 2, opacity: pressed ? 0.6 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt bold numberOfLines={1}>{title}</Txt>
        {sub ? <Txt muted small numberOfLines={2}>{sub}</Txt> : null}
      </View>
      {right ?? (onPress ? <Txt muted>›</Txt> : null)}
    </Pressable>
  );
}
