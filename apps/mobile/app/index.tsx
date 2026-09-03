import { StyleSheet, Text, View } from 'react-native';

import { palette, spacing, typography } from '@ecc/ui';

/**
 * Phase 1 placeholder. The real navigation graph and feature
 * screens are added in their owning phase.
 */
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Phase 1 · Foundation</Text>
      <Text style={styles.title}>Elderly Care</Text>
      <Text style={styles.subtitle}>
        A secure family and caregiver coordination platform. The mobile app shell is in place; the
        real screens come in later phases.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: palette.background,
    justifyContent: 'center',
  },
  eyebrow: {
    color: palette.primary,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.08,
    marginBottom: spacing.sm,
  },
  title: {
    color: palette.text,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.md,
  },
  subtitle: {
    color: palette.textMuted,
    fontSize: typography.fontSize.md,
    lineHeight: typography.fontSize.md * typography.lineHeight.relaxed,
  },
});
