import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '../src/hooks/useAuth';
import { palette, spacing } from '@ecc/ui';

export default function IndexScreen() {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace('/home');
      } else {
        router.replace('/login');
      }
    }
  }, [isLoading, isAuthenticated]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background, justifyContent: 'center', alignItems: 'center' }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ActivityIndicator size="large" color={palette.primary} />
    </View>
  );
}
