import Constants from 'expo-constants';

/**
 * Centralised API base URL. Reads from Expo's `extra` config so the
 * same constant works in dev, preview, and production builds.
 */
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.['apiBaseUrl'] as string | undefined) ?? 'http://localhost:3000';
