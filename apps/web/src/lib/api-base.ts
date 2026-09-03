/**
 * Centralised API base URL. Reads from public env so the same
 * constant works on server and client. Phase 1 leaves a sensible
 * default; production deployment will inject the real value at
 * build time.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
