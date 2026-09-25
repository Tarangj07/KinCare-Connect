import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { palette, spacing, typography, controlSize } from '@ecc/ui';
import { api } from '../../src/services/api';

interface EmergencyAlert {
  id: string;
  seniorId: string;
  type: string;
  severity: string;
  status: string;
  message?: string | null;
  source?: string | null;
  detectedAt: string;
  createdAt: string;
}

export default function EmergencyDetailScreen() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  const [alert, setAlert] = useState<EmergencyAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const seniorId = '00000000-0000-0000-0000-000000000001';

  useEffect(() => {
    if (alertId) loadAlert();
  }, [alertId]);

  const loadAlert = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<EmergencyAlert>(`/api/v1/seniors/${seniorId}/emergency-alerts/${alertId}`);
      setAlert(data);
    } catch (e) {
      setError('Could not load alert details.');
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async () => {
    try {
      await api.post(`/api/v1/seniors/${seniorId}/emergency-alerts/${alertId}/acknowledge`);
      Alert.alert('Acknowledged', 'Alert acknowledged.');
      loadAlert();
    } catch (e) {
      Alert.alert('Error', 'Acknowledgment failed. You may not have permission.');
    }
  };

  const handleResolve = async () => {
    try {
      await api.post(`/api/v1/seniors/${seniorId}/emergency-alerts/${alertId}/resolve`);
      Alert.alert('Resolved', 'Alert resolved.');
      loadAlert();
    } catch (e) {
      Alert.alert('Error', 'Resolution failed. You may not have permission.');
    }
  };

  const handleCancel = async () => {
    try {
      await api.post(`/api/v1/seniors/${seniorId}/emergency-alerts/${alertId}/cancel`);
      Alert.alert('Cancelled', 'Alert cancelled.');
      loadAlert();
    } catch (e) {
      Alert.alert('Error', 'Cancellation failed. You may not have permission.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Alert Details</Text>
      {loading ? (
        <ActivityIndicator size="large" color={palette.primary} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : alert ? (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Type</Text>
            <Text style={styles.value}>{alert.type}</Text>

            <Text style={styles.label}>Severity</Text>
            <Text style={styles.value}>{alert.severity}</Text>

            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>{alert.status}</Text>

            <Text style={styles.label}>Detected</Text>
            <Text style={styles.value}>{alert.detectedAt}</Text>

            {alert.message ? (
              <>
                <Text style={styles.label}>Message</Text>
                <Text style={styles.value}>{alert.message}</Text>
              </>
            ) : null}
          </View>

          <View style={styles.actions}>
            {alert.status === 'ACTIVE' && (
              <>
                <TouchableOpacity style={[styles.actionButton, { backgroundColor: palette.accent }]} onPress={handleAcknowledge} accessibilityRole="button" accessibilityLabel="Acknowledge alert">
                  <Text style={styles.actionText}>Acknowledge</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionButton, { backgroundColor: palette.success }]} onPress={handleResolve} accessibilityRole="button" accessibilityLabel="Resolve alert">
                  <Text style={styles.actionText}>Resolve</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionButton, { backgroundColor: palette.danger }]} onPress={handleCancel} accessibilityRole="button" accessibilityLabel="Cancel alert">
                  <Text style={styles.actionText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
            {alert.status === 'ACKNOWLEDGED' && (
              <TouchableOpacity style={[styles.actionButton, { backgroundColor: palette.success }]} onPress={handleResolve} accessibilityRole="button" accessibilityLabel="Resolve alert">
                <Text style={styles.actionText}>Resolve</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : (
        <Text style={styles.empty}>No alert found.</Text>
      )}
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
    shadowColor: palette.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  label: {
    fontSize: typography.fontSize.sm,
    color: palette.textMuted,
    marginTop: spacing.sm,
  },
  value: {
    fontSize: typography.fontSize.md,
    color: palette.text,
    fontWeight: typography.fontWeight.semibold,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  actionButton: {
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    minHeight: controlSize.minTouchTarget,
    flex: 1,
    minWidth: '30%',
  },
  actionText: {
    color: palette.textInverse,
    fontWeight: typography.fontWeight.semibold,
  },
  error: {
    color: palette.danger,
  },
  empty: {
    color: palette.textMuted,
  },
});
