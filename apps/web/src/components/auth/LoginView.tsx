import React, { useState } from 'react';
import { AlertTriangle, Loader2, Lock, Sparkles } from 'lucide-react';
import { signInWithGoogle, signInWithGithub, isFirebaseConfigured } from '@/services/firebase';
import { createSession, type SessionUser } from '@/services/auth';

interface LoginViewProps {
  onAuthenticated: (user: SessionUser) => void;
}

const GOOGLE_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.86Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.62H1.26a12 12 0 0 0 0 10.76l4.01-3.1Z" />
    <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.62l4.01 3.1C6.22 6.87 8.87 4.76 12 4.76Z" />
  </svg>
);

const GITHUB_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.67.41.36.77 1.05.77 2.13v3.16c0 .31.21.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
    />
  </svg>
);

export const LoginView: React.FC<LoginViewProps> = ({ onAuthenticated }) => {
  const [loadingProvider, setLoadingProvider] = useState<'google' | 'github' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (provider: 'google' | 'github') => {
    setLoadingProvider(provider);
    setError(null);
    try {
      const idToken =
        provider === 'google' ? await signInWithGoogle() : await signInWithGithub();
      const user = await createSession(idToken);
      onAuthenticated(user);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha inesperada durante o login.';
      setError(message);
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 text-white">
      {/* Ambient background accents */}
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Sparkles className="h-7 w-7 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight">SalesIntel Platform</h1>
          <p className="mt-2 text-sm text-slate-400">
            Entre com a conta corporativa da sua empresa para acessar o dashboard.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            Acesso restrito a e-mails corporativos
          </div>

          {!isFirebaseConfigured && (
            <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-xs text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-bold">Firebase não configurado</p>
                  <p className="mt-1 text-amber-100/80">
                    Defina <code className="font-mono">VITE_FIREBASE_API_KEY</code> e{' '}
                    <code className="font-mono">VITE_FIREBASE_APP_ID</code> em{' '}
                    <code className="font-mono">apps/web/.env.local</code> (Firebase Console →
                    Configurações do projeto → Seus apps).
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={!isFirebaseConfigured || loadingProvider !== null}
              onClick={() => handleLogin('google')}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white px-4 text-sm font-bold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingProvider === 'google' ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              ) : (
                GOOGLE_ICON
              )}
              Continuar com Google
            </button>

            <button
              type="button"
              disabled={!isFirebaseConfigured || loadingProvider !== null}
              onClick={() => handleLogin('github')}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingProvider === 'github' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                GITHUB_ICON
              )}
              Continuar com GitHub
            </button>
          </div>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-500">
            E-mails de provedores gratuitos (Gmail, Outlook, Yahoo, etc.) não são aceitos.
            Use o e-mail do domínio da sua organização.
          </p>
        </div>
      </div>
    </div>
  );
};
