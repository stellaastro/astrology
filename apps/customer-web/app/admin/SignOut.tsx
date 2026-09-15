'use client';

import { useState } from 'react';
import s from './admin.module.css';

/** Signs out. The API revokes the session row, so the cookie being cleared is
 *  a courtesy, not the security boundary — a copied cookie stops working too. */
export default function SignOut() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      className={s.signout}
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } finally {
          window.location.href = '/admin/login';
        }
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
