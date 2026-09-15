import React, { useEffect, useState } from 'react';
import { adminMe } from '@/services/admin';
import { AdminLoginView } from './AdminLoginView';
import { AdminDashboardView } from './AdminDashboardView';

/**
 * Área administrativa isolada (rota /admin). Usa autenticação BÁSICA
 * (login/senha do Infisical) — NÃO usa a sessão Firebase da plataforma.
 */
export function AdminApp() {
  const [state, setState] = useState<'loading' | 'logged' | 'guest'>('loading');
  const [username, setUsername] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await adminMe();
      if (!cancelled) {
        if (me) {
          setUsername(me.username);
          setState('logged');
        } else {
          setState('guest');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-slate-400">
        <span className="animate-pulse">Carregando…</span>
      </div>
    );
  }

  if (state === 'guest') {
    return (
      <AdminLoginView
        onLoggedIn={(u) => {
          setUsername(u);
          setState('logged');
        }}
      />
    );
  }

  return (
    <AdminDashboardView
      username={username}
      onLogout={() => {
        setUsername('');
        setState('guest');
      }}
    />
  );
}
