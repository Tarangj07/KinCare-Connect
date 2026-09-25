import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { palette } from '@ecc/ui';
import { AuthProvider } from '../src/hooks/useAuth';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.surface },
            headerTintColor: palette.text,
            headerTitleStyle: { fontSize: 20, fontWeight: '600' },
            contentStyle: { backgroundColor: palette.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Elderly Care' }} />
          <Stack.Screen name="login" options={{ title: 'Sign In', headerBackTitle: 'Back' }} />
          <Stack.Screen name="home" options={{ title: 'Dashboard', headerBackTitle: 'Back' }} />
          <Stack.Screen name="emergency/index" options={{ title: 'Emergency Alerts', headerBackTitle: 'Back' }} />
          <Stack.Screen name="emergency/[alertId]" options={{ title: 'Alert Details', headerBackTitle: 'Back' }} />
          <Stack.Screen name="documents/index" options={{ title: 'Documents', headerBackTitle: 'Back' }} />
          <Stack.Screen name="profile" options={{ title: 'Profile', headerBackTitle: 'Back' }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
