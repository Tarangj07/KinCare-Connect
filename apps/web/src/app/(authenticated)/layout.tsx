/**
 * Phase 50 — authenticated route boundary (SERVER-SIDE).
 *
 * Protection layer: **Next.js Server Component guard**. This module redirects
 * to `/login` during server rendering, BEFORE any protected markup is produced.
 * An unauthenticated request to `/dashboard` therefore never receives
 * dashboard content — not "hidden links", not a client-side redirect after
 * hydration.
 *
 * What this layer is NOT:
 *  - It is not backend authorization. `AuthorizationService` decides whether a
 *    user may act on a senior; nothing here duplicates or overrides that.
 *  - A signed-in user with no authorized seniors still reaches this shell and
 *    is shown an explicit empty state, not a 403 — because "no seniors" is a
 *    legitimate state, not an authentication failure.
 */
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { readIdentity } from '@/app/api/_session';
import ShellLayout from './layout-shell';

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const user = await readIdentity();

  if (!user) {
    // Server-side redirect. No protected content is rendered.
    redirect('/login');
  }

  return <ShellLayout>{children}</ShellLayout>;
}