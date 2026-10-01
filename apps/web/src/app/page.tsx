import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { readIdentity } from '@/app/api/_session';

/**
 * Phase 50 — entry point.
 *
 * A signed-in user is sent to the dashboard; an anonymous visitor is sent to
 * sign in. The decision is made on the SERVER, so no landing markup is
 * produced for either audience.
 */
export const dynamic = 'force-dynamic';
export const metadata = { title: 'KinCare Connect' };

export default async function HomePage(): Promise<ReactElement> {
  const user = await readIdentity();
  redirect(user ? '/dashboard' : '/login');
}