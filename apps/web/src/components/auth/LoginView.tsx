import React, { useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Lock,
  Mail,
  Phone,
} from 'lucide-react';
import {
  signInWithProvider,
  signInWithEmail,
  signUpWithEmail,
  sendPhoneVerificationCode,
  confirmPhoneVerificationCode,
} from '@/services/firebase';
import type { ConfirmationResult } from 'firebase/auth';
import { createSession, type SessionUser } from '@/services/auth';
import { getAuthErrorMessage } from '@/services/authErrors';

interface LoginViewProps {
  onAuthenticated: (user: SessionUser) => void;
  initialError?: string | null;
}

type Mode = 'default' | 'email' | 'phone';

const GOOGLE_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.86Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.62H1.26a12 12 0 0 0 0 10.76l4.01-3.1Z" />
    <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.62l4.01 3.1C6.22 6.87 8.87 4.76 12 4.76Z" />
  </svg>
);

const inputClass =
  'h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium text-white placeholder:text-slate-500 outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20';

export const LoginView: React.FC<LoginViewProps> = ({ onAuthenticated, initialError }) => {
  const [mode, setMode] = useState<Mode>('default');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [info, setInfo] = useState<string | null>(null);

  // email/password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // phone
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  const resetMessages = () => {
    setError(null);
    setInfo(null);
  };

  const handleGoogle = async () => {
    setLoading('google');
    resetMessages();
    try {
      const idToken = await signInWithProvider();
      // A redirect sign-in navigates the whole page away and returns null here;
      // the session is exchanged on the next page load. A popup fallback returns
      // a token directly, which we exchange immediately.
      if (idToken) {
        const user = await createSession(idToken);
        onAuthenticated(user);
      }
    } catch (err) {
      console.error('[login] Google sign-in falhou:', err);
      setError(getAuthErrorMessage(err, 'Falha inesperada durante o login.'));
      setLoading(null);
    }
  };

  const handleEmailSignIn = async () => {
    if (!email || !password) {
      setError('Informe e-mail e senha.');
      return;
    }
    setLoading('email');
    resetMessages();
    try {
      const idToken = await signInWithEmail(email, password);
      const user = await createSession(idToken);
      onAuthenticated(user);
    } catch (err) {
      setError(getAuthErrorMessage(err, 'Falha ao entrar com e-mail.'));
    } finally {
      setLoading(null);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email || !password) {
      setError('Informe e-mail e senha.');
      return;
    }
    setLoading('signup');
    resetMessages();
    try {
      await signUpWithEmail(email, password);
      setInfo(
        'Conta criada! Enviamos um link de verificação para seu e-mail. Verifique a caixa de entrada e depois entre.'
      );
    } catch (err) {
      setError(getAuthErrorMessage(err, 'Falha ao criar conta.'));
    } finally {
      setLoading(null);
    }
  };

  const handleSendCode = async () => {
    if (!phone) {
      setError('Informe o número de telefone (ex.: +5511999999999).');
      return;
    }
    setLoading('send-code');
    resetMessages();
    try {
      const result = await sendPhoneVerificationCode(phone, 'recaptcha-container');
      setConfirmation(result);
      setInfo('Código enviado por SMS. Digite o código para confirmar.');
    } catch (err) {
      setError(getAuthErrorMessage(err, 'Falha ao enviar o código SMS.'));
    } finally {
      setLoading(null);
    }
  };

  const handleConfirmCode = async () => {
    if (!confirmation || !code) {
      setError('Digite o código recebido por SMS.');
      return;
    }
    setLoading('confirm-code');
    resetMessages();
    try {
      const idToken = await confirmPhoneVerificationCode(confirmation, code);
      const user = await createSession(idToken);
      onAuthenticated(user);
    } catch (err) {
      setError(getAuthErrorMessage(err, 'Código inválido. Tente novamente.'));
    } finally {
      setLoading(null);
    }
  };

  const backToDefault = () => {
    setMode('default');
    setConfirmation(null);
    setCode('');
    resetMessages();
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 text-white">
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />

      {/* Invisible reCAPTCHA container used by Firebase phone auth */}
      <div id="recaptcha-container" />

      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <img
            src="/logo-symbol.png"
            alt="B2Base"
            className="mx-auto mb-5 h-24 w-24 object-contain"
          />
          <h1 className="text-2xl font-black tracking-tight">B2Base Platform</h1>
          <p className="mt-2 text-sm text-slate-400">
            Entre com a conta corporativa da sua empresa para acessar o dashboard.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            Acesso restrito à sua conta
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {error}
            </div>
          )}

          {info && (
            <div className="mb-5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-200">
              {info}
            </div>
          )}

          {mode === 'default' && (
            <div className="space-y-3">
              <button
                type="button"
                disabled={loading !== null}
                onClick={handleGoogle}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white px-4 text-sm font-bold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading === 'google' ? <Loader2 className="h-5 w-5 animate-spin text-slate-500" /> : GOOGLE_ICON}
                Continuar com Google
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] font-semibold text-slate-500">ou</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <button
                type="button"
                disabled={loading !== null}
                onClick={() => { setMode('email'); resetMessages(); }}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mail className="h-5 w-5 text-slate-300" />
                Entrar com e-mail
              </button>

              <button
                type="button"
                disabled={loading !== null}
                onClick={() => { setMode('phone'); resetMessages(); }}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Phone className="h-5 w-5 text-slate-300" />
                Entrar com telefone
              </button>
            </div>
          )}

          {mode === 'email' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={backToDefault}
                className="flex items-center gap-2 text-xs font-semibold text-slate-400 transition hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar
              </button>

              <input
                type="email"
                autoComplete="email"
                placeholder="E-mail corporativo"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />

              <button
                type="button"
                disabled={loading !== null}
                onClick={handleEmailSignIn}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading === 'email' && <Loader2 className="h-4 w-4 animate-spin" />}
                Entrar
              </button>

              <button
                type="button"
                disabled={loading !== null}
                onClick={handleEmailSignUp}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-bold text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading === 'signup' && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar conta
              </button>

              <p className="text-center text-[11px] leading-relaxed text-slate-500">
                Após criar a conta, verifique seu e-mail antes de entrar.
              </p>
            </div>
          )}

          {mode === 'phone' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={backToDefault}
                className="flex items-center gap-2 text-xs font-semibold text-slate-400 transition hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar
              </button>

              <input
                type="tel"
                placeholder="Telefone (ex.: +5511999999999)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                disabled={confirmation !== null}
              />

              {confirmation ? (
                <>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Código SMS"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={loading !== null}
                    onClick={handleConfirmCode}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading === 'confirm-code' && <Loader2 className="h-4 w-4 animate-spin" />}
                    Confirmar código
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={loading !== null}
                  onClick={handleSendCode}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading === 'send-code' && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enviar código
                </button>
              )}

              <p className="text-center text-[11px] leading-relaxed text-slate-500">
                Enviaremos um código SMS para confirmar seu número.
              </p>
            </div>
          )}

          <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-500">
            Sua sessão fica salva neste navegador por 14 dias.
          </p>
        </div>
      </div>
    </div>
  );
};
