import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { palette, spacing, typography } from '@ecc/ui';
import { useAuth } from '../src/hooks/useAuth';
import { logoutUser } from '../src/services/auth';
import { router } from 'expo-router';

export default function ProfileScreen() {
  const { user, isAuthenticated } = useAuth();

  const handleLogout = async () => {
    await logoutUser();
    router.replace('/login');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Profile</Text>
      {isAuthenticated && user ? (
        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{user.fullName}</Text>

          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user.email}</Text>

          <Text style={styles.label}>Global Role</Text>
          <Text style={styles.value}>{user.globalRole}</Text>

          <Text style={styles.label}>User ID</Text>
          <Text style={styles.value}>{user.id}</Text>
        </View>
      ) : (
        <Text style={styles.empty}>Not signed in.</Text>
      )}

      <TouchableOpacity
        style={styles.button}
        onPress={handleLogout}
        accessibilityRole="button"
        accessibilityLabel="Log out"
      >
        <Text style={styles.buttonText}>Log Out</Text>
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
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.fontSize.sm,
    color: palette.textMuted,
  },
  value: {
    fontSize: typography.fontSize.md,
    color: palette.text,
    fontWeight: typography.fontWeight.semibold,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: palette.danger,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    minHeight: 48,
  },
  buttonText: {
    color: palette.textInverse,
    fontWeight: typography.fontWeight.semibold,
  },
  empty: {
    color: palette.textMuted,
  },
});
