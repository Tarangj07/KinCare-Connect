import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import styles from '../shell.module.css';
import SeniorPreference from './senior-preference';
import { loadAppShell, loadMedications } from '@/lib/shell-data';
import { readSeniorPreference } from '@/app/api/_session';
import { looksLikeUuid, seniorLabel } from '@/lib/seniors';

/**
 * Phase 50 — accessible seniors and senior detail.
 *
 * CRITICAL: the `?senior=` query parameter is NOT an authorization source. It
 * is validated against the list the BACKEND returned from `GET /me/seniors`;
 * anything absent from that list is discarded and replaced by the resolution
 * rules in `resolveActiveSenior`. Selecting a senior here changes a UI
 * preference cookie only — the backend re-authorizes every senior-scoped read.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My seniors · KinCare Connect' };

export default async function SeniorsPage({
  searchParams,
}: {
  searchParams: { senior?: string };
}): Promise<ReactElement> {
  const requested = searchParams.senior;
  const cookiePreference = readSeniorPreference();

  // An explicit, well-formed `?senior=` wins for THIS request ONLY if the
  // backend authorizes it. Otherwise fall back to the stored preference.
  // Either way the id is validated against the server's own list below, so a
  // fabricated value can never become the active senior.
  const candidate =
    requested && looksLikeUuid(requested)
      ? requested
      : cookiePreference;

  const shell = await loadAppShell(candidate);

  if (shell.seniorsError) {
    return (
      <section>
        <h1>We could not load your seniors</h1>
        <p role="alert" className={styles.error}>
          {shell.seniorsError.message}
        </p>
      </section>
    );
  }

  if (shell.seniors.isEmpty) {
    return (
      <section>
        <h1>No seniors are linked to your account</h1>
        <p>
          A senior appears here only when a care-circle administrator adds you. There is no self-service linking in
          this release.
        </p>
      </section>
    );
  }

  const selected = shell.seniors.selected;

  return (
    <section aria-labelledby="seniors-heading">
      <h1 id="seniors-heading">Seniors you can help</h1>
      <p className={styles.muted}>
        {shell.seniors.seniors.length === 1
          ? 'You have access to 1 senior.'
          : `You have access to ${shell.seniors.seniors.length} seniors.`}{' '}
        This list comes from the server and reflects your care-circle membership.
      </p>

      <ul className={styles.seniorList}>
        {shell.seniors.seniors.map((s) => (
          <li key={s.id}>
            <a href={`/seniors?senior=${encodeURIComponent(s.id)}`}>{seniorLabel(s)}</a>{' '}
            <span className={styles.muted}>— {s.role.replace('_', ' ').toLowerCase()}</span>
            {selected?.id === s.id ? <strong> (active)</strong> : null}
          </li>
        ))}
      </ul>

      {shell.seniors.seniors.length > 1 ? (
        <div className={styles.preferenceBox}>
          <SeniorPreference
            currentSeniorId={selected?.id ?? shell.seniors.seniors[0]!.id}
            seniors={shell.seniors.seniors.map((s) => ({ id: s.id, label: seniorLabel(s) }))}
          />
        </div>
      ) : null}

      {selected ? <SeniorSummary seniorId={selected.id} label={seniorLabel(selected)} /> : null}
    </section>
  );
}

async function SeniorSummary({
  seniorId,
  label,
}: {
  seniorId: string;
  label: string;
}): Promise<ReactElement> {
  const medications = await loadMedications(seniorId);

  return (
    <article className={styles.card} style={{ marginTop: '1.5rem' }}>
      <h2>{label}</h2>
      {medications.error ? (
        <p role="alert" className={styles.error}>
          {medications.error.kind === 'forbidden'
            ? 'You are not permitted to view medications for this senior.'
            : medications.error.message}
        </p>
      ) : medications.data === null ? (
        <p>Not available yet.</p>
      ) : medications.data.length === 0 ? (
        <p className={styles.muted}>No medications recorded.</p>
      ) : (
        <p className={styles.muted}>{medications.data.length} medication(s) recorded.</p>
      )}
    </article>
  );
}