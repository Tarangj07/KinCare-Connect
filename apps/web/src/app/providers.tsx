'use client';

import type { ReactElement, ReactNode } from 'react';

/**
 * Phase 50 — client providers.
 *
 * Deliberately minimal. Authentication state lives in an HTTP-only cookie read
 * on the server; there is no client-side token store, and therefore no
 * hydration mismatch to reconcile and no token available to client JavaScript.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}
