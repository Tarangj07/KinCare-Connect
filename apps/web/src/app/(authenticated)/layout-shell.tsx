/**
 * Phase 50 — application shell.
 *
 * Renders the real signed-in identity, the active senior, and navigation to
 * functionality that actually exists.
 *
 * Everything shown here is real data from the backend. Where a product area is
 * not implemented in this phase, it is labelled "Not available yet" rather
 * than being linked as if it worked. No metrics are invented.
 */
import Link from 'next/link';
import type { ReactElement } from 'react';

import styles from './shell.module.css';
import { readIdentity } from '@/app/api/_session';
import { loadAppShell } from '@/lib/shell-data';
import { seniorLabel } from '@/lib/seniors';

export const dynamic = 'force-dynamic';

/**
 * Product areas that are NOT built yet. Listed explicitly so the absence is
 * visible rather than implied by a working link.
 */
const NOT_YET_AVAILABLE = [
  'Care tasks',
  'Notifications',
  'Messaging',
  'Document upload',
  'Family updates feed',
  'Emergency contacts',
];

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const [user, shell] = await Promise.all([readIdentity(), loadAppShell()]);

  if (!user) {
    // The route boundary already redirects; this is defence in depth.
    return (
      <main className={styles.shell}>
        <p role="alert">Your session has ended. Please sign in again.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  }

  const { seniors } = shell;
  const selectedSeniorId = seniors.selected?.id ?? null;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <span className={styles.brand}>KinCare Connect</span>
          <span className={styles.brandSub}>Elderly care coordination</span>
        </div>

        <div className={styles.identity}>
          <span className={styles.userName}>{user.fullName}</span>
          <span className={styles.userEmail}>{user.email}</span>
        </div>

        <form action="/api/auth/logout" method="post">
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Main">
          <h2 className={styles.navHeading}>Navigation</h2>
          <ul className={styles.navList}>
            <li>
              <Link href="/dashboard">Dashboard</Link>
            </li>
            <li>
              <Link href="/seniors">My seniors</Link>
            </li>
          </ul>

          <h2 className={styles.navHeading}>Active senior</h2>
          {seniors.selected ? (
            <div className={styles.activeSenior}>
              <strong>{seniorLabel(seniors.selected)}</strong>
              <span className={styles.role}>{seniors.selected.role.replace('_', ' ').toLowerCase()}</span>
            </div>
          ) : (
            <p className={styles.muted}>
              {seniors.isEmpty ? 'No seniors yet' : 'Choose a senior to continue'}
            </p>
          )}

          {seniors.seniors.length > 1 ? (
            <nav aria-label="Switch senior" className={styles.seniorLinks}>
              {seniors.seniors.map((s) => (
                <a
                  key={s.id}
                  className={selectedSeniorId === s.id ? styles.seniorLinkActive : styles.seniorLink}
                  href={`/seniors?senior=${encodeURIComponent(s.id)}`}
                  aria-current={selectedSeniorId === s.id ? 'page' : undefined}
                >
                  {seniorLabel(s)}
                </a>
              ))}
            </nav>
          ) : null}

          <h2 className={styles.navHeading}>Not available yet</h2>
          <ul className={styles.unavailable}>
            {NOT_YET_AVAILABLE.map((area) => (
              <li key={area}>{area}</li>
            ))}
          </ul>
        </nav>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
