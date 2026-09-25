import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { palette, spacing, typography, controlSize } from '@ecc/ui';
import { api } from '../../src/services/api';

interface EmergencyAlert {
  id: string;
  seniorId: string;
  type: string;
  severity: string;
  status: string;
  message?: string | null;
  detectedAt: string;
}

export default function EmergencyListScreen() {
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Note: seniorId is required by the backend; this screen uses a demo senior ID.
  // In production, the senior context should come from the user's active circle.
  const seniorId = '00000000-0000-0000-0000-000000000001';

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<EmergencyAlert[]>(`/api/v1/seniors/${seniorId}/emergency-alerts`);
      setAlerts(Array.isArray(data) ? data : []);
    } catch (e) {
      setError('Could not load emergency alerts.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const payload = {
      type: 'SOS',
      severity: 'HIGH',
      message: 'Emergency triggered from mobile app.',
      source: 'manual',
    };
    try {
      await api.post(`/api/v1/seniors/${seniorId}/emergency-alerts`, payload);
      Alert.alert('Success', 'Emergency alert created.');
      loadAlerts();
    } catch (e) {
      Alert.alert('Error', 'Failed to create alert.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Emergency Alerts</Text>
      <TouchableOpacity style={styles.createButton} onPress={handleCreate} accessibilityRole="button" accessibilityLabel="Create emergency alert">
        <Text style={styles.createButtonText}>Create Alert</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color={palette.primary} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : alerts.length === 0 ? (
        <Text style={styles.empty}>No emergency alerts found.</Text>
      ) : (
        alerts.map((alert) => (
          <TouchableOpacity
            key={alert.id}
            style={styles.alertCard}
            onPress={() => router.push(`/emergency/${alert.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Alert ${alert.type} ${alert.severity}`}
          >
            <Text style={styles.alertTitle}>{alert.type} — {alert.severity}</Text>
            <Text style={styles.alertStatus}>Status: {alert.status}</Text>
            <Text style={styles.alertTime}>{alert.detectedAt}</Text>
            {alert.message ? <Text style={styles.alertMessage}>{alert.message}</Text> : null}
          </TouchableOpacity>
        ))
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
  createButton: {
    backgroundColor: palette.danger,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    minHeight: controlSize.minTouchTarget,
    marginBottom: spacing.md,
  },
  createButtonText: {
    color: palette.textInverse,
    fontWeight: typography.fontWeight.bold,
    fontSize: typography.fontSize.md,
  },
  alertCard: {
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
  alertTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: palette.text,
  },
  alertStatus: {
    fontSize: typography.fontSize.sm,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  alertTime: {
    fontSize: typography.fontSize.sm,
    color: palette.textMuted,
  },
  alertMessage: {
    fontSize: typography.fontSize.md,
    color: palette.text,
    marginTop: spacing.sm,
  },
  error: {
    color: palette.danger,
    fontSize: typography.fontSize.md,
  },
  empty: {
    fontSize: typography.fontSize.md,
    color: palette.textMuted,
  },
});
