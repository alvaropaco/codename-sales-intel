import React from 'react';
import {
  Search,
  Users,
  Kanban,
  ShieldCheck,
  Send,
  Workflow,
  ArrowRight,
  BarChart3,
  Building2,
  Lock,
} from 'lucide-react';

interface LandingViewProps {
  onLogin: () => void;
}

/**
 * Public marketing landing page shown at the app root when there is no active
 * session. It explains the purpose of the platform without requiring login, so
 * Google's OAuth verification (and generic visitors) can see what the app is
 * about before authenticating.
 */
export const LandingView: React.FC<LandingViewProps> = ({ onLogin }) => {
  const features = [
    {
      icon: Search,
      title: 'Inteligência de CNPJ',
      desc: 'Consulte e enriqueça dados empresariais a partir de fontes oficiais e públicas, com razão social, endereço, sócios e situação cadastral.',
    },
    {
      icon: Users,
      title: 'Prospecção e CRM',
      desc: 'Organize leads, contatos e oportunidades em um só lugar para priorizar quem vale a pena abordar.',
    },
    {
      icon: Kanban,
      title: 'Pipeline comercial',
      desc: 'Visualize e mova oportunidades pelo funil com regras claras de qualificação e priorização.',
    },
    {
      icon: ShieldCheck,
      title: 'Análise de risco',
      desc: 'Avalie o risco de crédito de empresas prospectadas antes de investir tempo e capital.',
    },
    {
      icon: Send,
      title: 'Outreach automatizado',
      desc: 'Envie campanhas de e-mail personalizadas por Gmail, com controle de cadência, rate limits e supressão.',
    },
    {
      icon: Workflow,
      title: 'Automação de workflows',
      desc: 'Dispare ações automáticas com base em regras comerciais, sinais de lead e mudanças de estágio.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 font-extrabold tracking-tight">
            <img src="/logo.svg" alt="B2Base" className="h-9 w-9 rounded-xl object-cover" />
            <span className="text-lg">B2Base</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
            <a href="#recursos" className="transition hover:text-white">Recursos</a>
            <a href="/privacy-policy" className="transition hover:text-white">Privacidade</a>
            <a href="/terms-of-usage" className="transition hover:text-white">Termos</a>
          </nav>
          <button
            onClick={onLogin}
            className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-200"
          >
            Entrar
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-32 top-40 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-20 text-center sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-indigo-300">
            <BarChart3 className="h-3.5 w-3.5" />
            Inteligência comercial B2B
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            Descubra e qualifique novas empresas para o seu time comercial
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-300">
            A B2Base consolida dados de CNPJ, prospectos, pipeline, risco e outreach em uma única
            plataforma — para que sua equipe atue nos leads certos, no momento certo.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={onLogin}
              className="group inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-7 py-3.5 text-base font-bold text-white transition hover:bg-indigo-400"
            >
              Acessar a plataforma
              <ArrowRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
            </button>
            <a
              href="#recursos"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Conhecer recursos
            </a>
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            Seguro, em conformidade com a LGPD e boas práticas do SOC 2.
          </p>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 text-center sm:grid-cols-4 sm:px-6">
          {[
            { k: 'CNPJ', v: 'Dados oficiais e públicos' },
            { k: 'Pipeline', v: 'Do lead à oportunidade' },
            { k: 'Risco', v: 'Análise de crédito' },
            { k: 'Outreach', v: 'E-mails automatizados' },
          ].map((s) => (
            <div key={s.k}>
              <div className="flex items-center justify-center gap-2 text-sm font-bold text-indigo-300">
                <Building2 className="h-4 w-4" />
                {s.k}
              </div>
              <p className="mt-1 text-xs text-slate-400">{s.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="recursos" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight">Tudo que sua operação comercial precisa</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Da descoberta de empresas até o envio de campanhas, a B2Base organiza o caminho completo.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-indigo-400/40 hover:bg-white/[0.05]"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 text-center">
          <button
            onClick={onLogin}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-7 py-3 text-base font-bold text-white transition hover:bg-indigo-400"
          >
            Começar agora
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-slate-950 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2 font-extrabold">
            <img src="/logo.svg" alt="B2Base" className="h-8 w-8 rounded-lg object-cover" />
            <span>B2Base</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-5 text-sm text-slate-400">
            <a className="transition hover:text-white" onClick={(e) => { e.preventDefault(); onLogin(); }} href="#">
              Acessar
            </a>
            <a className="transition hover:text-white" href="/privacy-policy">Política de Privacidade</a>
            <a className="transition hover:text-white" href="/terms-of-usage">Termos de Uso</a>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-slate-600">
          © {new Date().getFullYear()} B2Base Platform
        </p>
      </footer>
    </div>
  );
};
