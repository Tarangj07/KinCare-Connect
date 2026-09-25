import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { palette, spacing, typography } from '@ecc/ui';
import { useAuth } from '../src/hooks/useAuth';
import { logoutUser } from '../src/services/auth';

export default function HomeScreen() {
  const { user, isAuthenticated } = useAuth();

  const handleLogout = async () => {
    await logoutUser();
    router.replace('/login');
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Not Authenticated</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/login')}>
          <Text style={styles.buttonText}>Go to Login</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Welcome, {user?.fullName || 'User'}</Text>
      <Text style={styles.subtitle}>Role: {user?.globalRole || 'Unknown'}</Text>

      <View style={styles.grid}>
        <TouchableOpacity style={styles.card} onPress={() => router.push('/emergency/index')} accessibilityRole="button" accessibilityLabel="Emergency Alerts">
          <Text style={styles.cardTitle}>Emergency Alerts</Text>
          <Text style={styles.cardDesc}>View and manage alerts</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push('/documents/index')} accessibilityRole="button" accessibilityLabel="Documents">
          <Text style={styles.cardTitle}>Documents</Text>
          <Text style={styles.cardDesc}>Health records and files</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="Profile">
          <Text style={styles.cardTitle}>Profile</Text>
          <Text style={styles.cardDesc}>Account and settings</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} accessibilityRole="button" accessibilityLabel="Log out">
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    backgroundColor: palette.background,
    flexGrow: 1,
  },
  title: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: palette.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.fontSize.md,
    color: palette.textMuted,
    marginBottom: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 8,
    padding: spacing.md,
    width: '46%',
    minHeight: 100,
    justifyContent: 'center',
    shadowColor: palette.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: palette.text,
    marginBottom: spacing.xs,
  },
  cardDesc: {
    fontSize: typography.fontSize.sm,
    color: palette.textMuted,
  },
  button: {
    backgroundColor: palette.primary,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  buttonText: {
    color: palette.textInverse,
    fontWeight: typography.fontWeight.semibold,
  },
  logoutButton: {
    marginTop: spacing.xl,
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  logoutText: {
    color: palette.danger,
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.semibold,
  },
});
