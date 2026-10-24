import { Alert, Linking, Pressable, View } from 'react-native';
import { api } from '../api';
import { Async, Badge, Button, Card, Screen, Txt } from '../components/ui';
import { useSession } from '../session';
import { space } from '../theme';
import { useQuery } from '../useQuery';

export default function More() {
  const { user, serverUrl, signOut } = useSession();
  const dash = useQuery(api.dashboards, 0);

  function confirmSignOut() {
    Alert.alert('Sign out?', `You will be signed out of ${serverUrl}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => { signOut(); } },
    ]);
  }

  return (
    <Screen title="More" queries={[dash]}>
      <Card style={{ gap: space.sm }}>
        <Txt muted small>Signed in as</Txt>
        <Txt bold>{user}</Txt>
        <Txt muted small>Server</Txt>
        <Txt numberOfLines={1}>{serverUrl}</Txt>
        <View style={{ marginTop: space.sm }}><Button title="Sign out" kind="danger" onPress={confirmSignOut} /></View>
      </Card>

      <View style={{ gap: space.md }}>
        <Txt bold>Grafana dashboards</Txt>
        <Async q={dash} rows={3} h={64} isEmpty={(d) => d.length === 0} empty={{ title: 'No dashboards', hint: 'Grafana returned no dashboards, or it is not configured.' }}>
          {(list) => (
            <View style={{ gap: space.md }}>
              {list.map((d) => (
                <Pressable key={d.uid} onPress={() => Linking.openURL(d.url).catch(() => Alert.alert('Cannot open link', d.url))} accessibilityRole="link" accessibilityLabel={`Open ${d.title} in browser`}>
                  <Card style={{ gap: 4 }}>
                    <Txt bold numberOfLines={1}>{d.title}</Txt>
                    <Txt muted small>{d.folder}</Txt>
                    {d.tags.length ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{d.tags.map((t) => <Badge key={t}>{t}</Badge>)}</View> : null}
                  </Card>
                </Pressable>
              ))}
            </View>
          )}
        </Async>
      </View>
    </Screen>
  );
}
