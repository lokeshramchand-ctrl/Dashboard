import { DarkTheme, DefaultTheme, NavigationContainer, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Guests from './src/screens/Guests';
import Login from './src/screens/Login';
import Node from './src/screens/Node';
import More from './src/screens/More';
import Overview from './src/screens/Overview';
import Uptime from './src/screens/Uptime';
import { SessionProvider, useSession } from './src/session';
import { useTheme } from './src/theme';

const Tab = createBottomTabNavigator();

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Overview: 'speedometer-outline', Guests: 'server-outline', Uptime: 'pulse-outline', Node: 'hardware-chip-outline', More: 'ellipsis-horizontal',
};

function OverviewTab() {
  const nav = useNavigation<{ navigate: (name: string) => void }>();
  return <Overview go={(tab) => nav.navigate(tab)} />;
}

function Tabs() {
  const t = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: t.text,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        tabBarIcon: ({ color, size }) => <Ionicons name={ICONS[route.name]} size={size} color={color} />,
      })}
    >
      <Tab.Screen name="Overview" component={OverviewTab} />
      <Tab.Screen name="Guests" component={Guests} />
      <Tab.Screen name="Node" component={Node} />
      <Tab.Screen name="Uptime" component={Uptime} />
      <Tab.Screen name="More" component={More} />
    </Tab.Navigator>
  );
}

function Root() {
  const t = useTheme();
  const { status } = useSession();
  if (status === 'loading') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}><ActivityIndicator color={t.muted} /></View>;
  }
  if (status === 'out') return <Login />;
  const base = t.dark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer theme={{ ...base, colors: { ...base.colors, background: t.bg, card: t.surface, border: t.border, text: t.text, primary: t.accent } }}>
      <Tabs />
    </NavigationContainer>
  );
}

export default function App() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Root />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
