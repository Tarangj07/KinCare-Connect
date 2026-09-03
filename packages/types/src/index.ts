/**
 * @ecc/types
 *
 * Cross-app shared types. Phase 1 ships the package shell only — domain
 * types and zod schemas are added in later phases.
 */

export const APP_NAME = 'elderly-care-coordination-platform' as const;

export type AppName = typeof APP_NAME;
