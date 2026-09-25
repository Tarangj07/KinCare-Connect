import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { palette, spacing, typography, controlSize } from '@ecc/ui';
import { api } from '../../src/services/api';

interface Document {
  id: string;
  title: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  seniorId: string;
}

export default function DocumentsListScreen() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seniorId = '00000000-0000-0000-0000-000000000001';

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<Document[]>(`/api/v1/seniors/${seniorId}/documents`);
      setDocuments(Array.isArray(data) ? data : []);
    } catch (e) {
      setError('Could not load documents.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (docId: string) => {
    try {
      const data = await api.get<{ fileContent: string; fileName: string }>(
        `/api/v1/seniors/${seniorId}/documents/${docId}/download`
      );
      Alert.alert('Download Started', `File: ${data.fileName}`);
    } catch (e) {
      Alert.alert('Download Failed', 'You may not have access to this document.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Documents</Text>
      {loading ? (
        <ActivityIndicator size="large" color={palette.primary} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : documents.length === 0 ? (
        <Text style={styles.empty}>No documents found.</Text>
      ) : (
        documents.map((doc) => (
          <View key={doc.id} style={styles.docCard}>
            <Text style={styles.docTitle}>{doc.title}</Text>
            <Text style={styles.docMeta}>{doc.contentType} • {doc.sizeBytes} bytes</Text>
            <Text style={styles.docMeta}>{doc.createdAt}</Text>
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={() => handleDownload(doc.id)}
              accessibilityRole="button"
              accessibilityLabel={`Download ${doc.title}`}
            >
              <Text style={styles.downloadText}>Download</Text>
            </TouchableOpacity>
          </View>
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
  docCard: {
    backgroundColor: palette.surface,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  docTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: palette.text,
  },
  docMeta: {
    fontSize: typography.fontSize.sm,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  downloadButton: {
    backgroundColor: palette.info,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    minHeight: controlSize.minTouchTarget,
    justifyContent: 'center',
  },
  downloadText: {
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
