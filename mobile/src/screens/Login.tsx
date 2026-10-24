import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field, Txt } from '../components/ui';
import { useSession } from '../session';
import { space, useTheme } from '../theme';

export default function Login() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, serverUrl, notice } = useSession();
  const [url, setUrl] = useState(serverUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(url, username, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.xl, paddingTop: insets.top + space.xl, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginBottom: space.md }}>
            <Text style={{ color: t.onAccent, fontSize: 24, fontWeight: '800' }}>H</Text>
          </View>
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 }}>Homelab Console</Text>
          <Txt muted>Sign in to your dashboard.</Txt>
        </View>

        <Card style={{ gap: space.lg }}>
          <Field label="Dashboard address" value={url} onChangeText={setUrl} placeholder="https://dash.home.lan" keyboardType="url" textContentType="URL" />
          <Field label="Username" value={username} onChangeText={setUsername} textContentType="username" autoComplete="username" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoComplete="password" onSubmitEditing={submit} returnKeyType="go" />
          {notice && !error ? <Txt tone="amber" small>{notice}</Txt> : null}
          {error ? <Txt tone="red" small>{error}</Txt> : null}
          <Button kind="primary" title="Sign in" onPress={submit} busy={busy} disabled={!url || !username || !password} />
        </Card>

        <Txt muted small style={{ textAlign: 'center' }}>Use https:// when possible. The server sets a secure session cookie.</Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
