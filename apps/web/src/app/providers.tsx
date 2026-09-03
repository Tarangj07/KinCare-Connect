'use client';

import type { ReactElement, ReactNode } from 'react';

/**
 * Client-side providers wrapper. Phase 1 only contains a passthrough
 * shell. Real providers (query client, auth context, i18n) are added
 * in their owning phase.
 */
export function AppProviders({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}
