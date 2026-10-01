'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Phase 50 — persist the active-senior preference.
 *
 * A Server Component cannot write cookies in Next 14, so persistence goes
 * through the same-origin BFF route. This component holds no senior id of its
 * own: it is given the current selection and the server-validated list, and it
 * posts the chosen id back to the server, which re-validates it against
 * `GET /api/v1/me/seniors` before it has any effect.
 */
export default function SeniorPreference({
  currentSeniorId,
  seniors,
}: {
  currentSeniorId: string;
  seniors: Array<{ id: string; label: string }>;
}): JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(currentSeniorId);
  const [saving, setSaving] = useState(false);

  async function persist(): Promise<void> {
    if (value === currentSeniorId) return;
    setSaving(true);
    try {
      await fetch('/api/me/senior', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seniorId: value }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label htmlFor="senior-preference">Active senior</label>
      <select
        id="senior-preference"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
      >
        {seniors.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => void persist()} disabled={saving || value === currentSeniorId}>
        {saving ? 'Saving…' : 'Set active'}
      </button>
    </div>
  );
}
