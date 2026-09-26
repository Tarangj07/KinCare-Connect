import type { ReactElement } from 'react';

import Link from 'next/link';

import styles from './page.module.css';

export default function HomePage(): ReactElement {
  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Phase 1 · Foundation</p>
        <h1 className={styles.title}>Elderly Care Coordination</h1>
        <p className={styles.subtitle}>
          A secure family and caregiver coordination platform. Phase 15 web dashboards are now available.
        </p>
        <ul className={styles.list}>
          <li>
            Read the architecture in <code>docs/ARCHITECTURE.md</code>.
          </li>
          <li>
            Follow the plan in <code>docs/PROJECT_PLAN.md</code>.
          </li>
          <li>
            Review the threat model in <code>docs/THREAT_MODEL.md</code>.
          </li>
        </ul>
        <Link className={styles.cta} href="/dashboard">
          Open Dashboard
        </Link>
        <Link className={styles.cta} href="/health" style={{ marginTop: '1rem', background: '#e08a3c' }}>
          Check API health
        </Link>
      </div>
    </main>
  );
}
