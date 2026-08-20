import React from 'react';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  ChevronRight,
  Database,
  Fingerprint,
  Kanban,
  Lock,
  Menu,
  Quote,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
  X,
} from 'lucide-react';

interface LandingViewProps {
  onLogin: () => void;
}

/**
 * Public marketing landing page shown at the app root when there is no active
 * session. It explains the purpose of the platform without requiring login, so
 * Google's OAuth verification (and generic visitors) can see what the app is
 * about before authenticating. Premium, enterprise-oriented branding.
 */
export const LandingView: React.FC<LandingViewProps> = ({ onLogin }) => {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const features = [
    {
      icon: Search,
      title: 'Inteligência de CNPJ',
      desc: 'Enriqueça dados empresariais em tempo real a partir de fontes oficiais: razão social, endereço, sócios, CNAE e situação cadastral.',
      tag: 'Dados',
    },
    {
      icon: Users,
      title: 'Prospecção & CRM',
      desc: 'Organize leads, contatos e oportunidades em um só lugar para priorizar quem vale a pena abordar primeiro.',
      tag: 'CRM',
    },
    {
      icon: Kanban,
      title: 'Pipeline comercial',
      desc: 'Visualize e mova oportunidades pelo funil com regras claras de qualificação, priorização e previsão.',
      tag: 'Sales',
    },
    {
      icon: ShieldCheck,
      title: 'Análise de risco',
      desc: 'Avalie o risco de crédito de empresas prospectadas antes de investir tempo e capital em cada conta.',
      tag: 'Risco',
    },
    {
      icon: Send,
      title: 'Outreach automatizado',
      desc: 'Lance campanhas personalizadas por Gmail com cadência, rate limits e supressão inteligente de contatos.',
      tag: 'Outreach',
    },
    {
      icon: Workflow,
      title: 'Automação de workflows',
      desc: 'Dispare ações automáticas com base em regras comerciais, sinais de compra e mudanças de estágio.',
      tag: 'Automação',
    },
  ];

  const steps = [
    {
      icon: Target,
      step: '01',
      title: 'Defina seu perfil comercial',
      desc: 'Informe segmentos, CNAEs e regiões. A B2Base monta a busca ideal para o seu time.',
    },
    {
      icon: Search,
      step: '02',
      title: 'Descubra e qualifique',
      desc: 'Receba empresas qualificadas com dados de CNPJ, contatos e sinais de compra relevantes.',
    },
    {
      icon: BarChart3,
      step: '03',
      title: 'Venda com previsibilidade',
      desc: 'Gerencie o pipeline, ative outreach automático e acompanhe o fechamento em um só painel.',
    },
  ];

  const stats = [
    { k: 'Qualificação', v: '3,2×', d: 'mais leads no funil certo' },
    { k: 'Taxa de contato', v: '+42%', d: 'com dados enriquecidos' },
    { k: 'Pipeline', v: 'Em tempo real', d: 'visão do lead ao fechamento' },
    { k: 'Compliance', v: 'LGPD & SOC 2', d: 'privacidade por padrão' },
  ];

  const testimonials = [
    {
      quote:
        'A B2Base substituiu nossas planilhas por um funil vivo. O time comercial passou a atuar nos leads certos e nossa taxa de qualificação subiu de forma consistente.',
      name: 'Diretora Comercial',
      role: 'Distribuidora B2B · 120 vendedores',
    },
    {
      quote:
        'O enriquecimento de CNPJ e o risco de crédito embutido nos pouparam de abordar contas frágeis. É inteligência comercial do jeito certo.',
      name: 'Head de Sales Ops',
      role: 'Indústria de insumos · R$ 40M ARR',
    },
    {
      quote:
        'Integração rápida, dados oficiais e automação de outreach com segurança. A plataforma escala com a nossa operação sem dores de cabeça.',
      name: 'CEO',
      role: 'Edtech · expansão nacional',
    },
  ];

  const compliance = [
    { icon: Lock, title: 'LGPD nativa', desc: 'Tratamento de dados pessoais com base legal, minimização e direito do titular em cada etapa.' },
    { icon: Fingerprint, title: 'Autenticação moderna', desc: 'Login por Google, e-mail corporativo e telefone com sessões seguras de 14 dias.' },
    { icon: Database, title: 'Fontes oficiais', desc: 'Dados públicos e oficiais de CNPJ, com curadoria e transparência de origem.' },
    { icon: ShieldCheck, title: 'Controles alinhados ao SOC 2', desc: 'Privacidade, segurança e boas práticas embutidas na arquitetura da plataforma.' },
  ];

  const navLinks = [
    { href: '#recursos', label: 'Recursos' },
    { href: '#como-funciona', label: 'Como funciona' },
    { href: '#seguranca', label: 'Segurança' },
    { href: '#depoimentos', label: 'Clientes' },
    { href: '/privacy-policy', label: 'Privacidade' },
    { href: '/terms-of-usage', label: 'Termos' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white antialiased">
      {/* ---------- NAV ---------- */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2.5">
            <img src="/logo-symbol.png" alt="B2Base" className="h-9 w-9 object-contain" />
            <span className="text-lg font-extrabold tracking-tight">
              B2Base<span className="text-sky-400">.net</span>
            </span>
          </a>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-300 lg:flex">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="transition hover:text-white">
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <button
              onClick={onLogin}
              className="hidden text-sm font-semibold text-slate-200 transition hover:text-white sm:block"
            >
              Entrar
            </button>
            <button
              onClick={onLogin}
              className="hidden items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-200 sm:inline-flex"
            >
              Começar agora
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              aria-label="Abrir menu"
              className="rounded-lg border border-white/10 p-2 text-slate-200 lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2.5">
                <img src="/logo-symbol.png" alt="B2Base" className="h-8 w-8 object-contain" />
                <span className="text-lg font-extrabold tracking-tight">B2Base</span>
              </div>
              <button
                aria-label="Fechar menu"
                className="rounded-lg border border-white/10 p-2 text-slate-200"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-1 px-5 pt-4">
              {navLinks.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-3 text-base font-semibold text-slate-200 transition hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                </a>
              ))}
              <button
                onClick={onLogin}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 text-base font-bold text-slate-900"
              >
                Começar agora
                <ArrowRight className="h-4 w-4" />
              </button>
            </nav>
          </div>
        )}
      </header>

      {/* ---------- HERO ---------- */}
      <section id="top" className="relative overflow-hidden">
        {/* Ambient glows */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
        <div className="pointer-events-none absolute -left-40 top-40 h-96 w-96 rounded-full bg-indigo-600/20 blur-[110px]" />
        <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-sky-400/10 blur-[110px]" />
        {/* Grid backdrop */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 40%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 40%, transparent 100%)',
          }}
        />

        <div className="relative mx-auto max-w-7xl px-5 pb-24 pt-20 text-center sm:px-6 sm:pt-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3.5 py-1.5 text-xs font-semibold text-sky-300">
            <Sparkles className="h-3.5 w-3.5" />
            Plataforma de inteligência comercial B2B
            <span className="ml-1 rounded-full bg-sky-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-200">
              Enterprise
            </span>
          </span>

          <h1 className="mx-auto mt-7 max-w-4xl text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl">
            Descubra e qualifique as{' '}
            <span className="bg-gradient-to-r from-sky-300 via-sky-400 to-indigo-400 bg-clip-text text-transparent">
              empresas certas
            </span>{' '}
            para vender com previsibilidade
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300 sm:text-xl">
            A B2Base consolida dados de CNPJ, prospecção, CRM, risco e outreach em uma única plataforma —
            para que sua equipe atue nos leads certos, no momento certo.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={onLogin}
              className="group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 px-8 py-4 text-base font-bold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-110 hover:shadow-sky-500/40"
            >
              Acessar a plataforma
              <ArrowRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
            </button>
            <a
              href="#recursos"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-8 py-4 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Explorar recursos
            </a>
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <Lock className="h-3.5 w-3.5" />
            Seguro, em conformidade com a LGPD e boas práticas do SOC 2.
          </p>

          {/* ---------- PRODUCT MOCKUP ---------- */}
          <div className="relative mx-auto mt-16 max-w-5xl">
            <div className="absolute -inset-x-8 -top-8 -bottom-8 rounded-[2rem] bg-gradient-to-tr from-sky-500/20 via-indigo-500/10 to-transparent blur-2xl" />
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl shadow-black/50 backdrop-blur">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 border-b border-white/10 bg-slate-950/60 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-rose-500/80" />
                  <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                  <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                </div>
                <div className="mx-auto flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-1 text-[11px] text-slate-400">
                  <Lock className="h-3 w-3" />
                  app.b2base.net/dashboard
                </div>
                <div className="w-12" />
              </div>

              <div className="flex text-left">
                {/* Mini sidebar */}
                <div className="hidden w-44 shrink-0 border-r border-white/10 bg-slate-950/50 p-4 sm:block">
                  <div className="mb-5 flex items-center gap-2">
                    <img src="/logo-symbol.png" alt="" className="h-6 w-6 object-contain" />
                    <span className="text-xs font-extrabold tracking-tight">B2Base</span>
                  </div>
                  {[
                    { i: BarChart3, l: 'Visão comercial', a: true },
                    { i: Building2, l: 'Descobrir leads', a: false },
                    { i: Kanban, l: 'Pipeline', a: false },
                    { i: ShieldCheck, l: 'Risco', a: false },
                    { i: Send, l: 'Outreach', a: false },
                  ].map((n) => (
                    <div
                      key={n.l}
                      className={
                        'mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold ' +
                        (n.a ? 'bg-white/10 text-white' : 'text-slate-400')
                      }
                    >
                      <n.i className="h-3.5 w-3.5" />
                      {n.l}
                    </div>
                  ))}
                </div>

                {/* Mini content */}
                <div className="flex-1 p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-400">Visão comercial</p>
                      <p className="text-sm font-black">16 Jul - 12 Ago · prioridades da semana</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
                      ● Atualizado
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { l: 'Prospectos', v: '1.284', c: 'text-sky-300' },
                      { l: 'Qualificados', v: '412', c: 'text-emerald-300' },
                      { l: 'Taxa de qualif.', v: '32%', c: 'text-indigo-300' },
                    ].map((s) => (
                      <div key={s.l} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <p className="text-[10px] text-slate-400">{s.l}</p>
                        <p className={'mt-1 text-lg font-black ' + s.c}>{s.v}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {[64, 78, 55, 90, 71].map((h, i) => (
                      <div key={i} className="flex flex-col items-center gap-1.5">
                        <div className="flex w-full items-end justify-center rounded-md bg-sky-500/10 p-1" style={{ height: 76 }}>
                          <div
                            className="w-full rounded-sm bg-gradient-to-t from-sky-500 to-indigo-400"
                            style={{ height: `${h}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-slate-500">d{i + 1}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500 text-[10px] font-black">
                        AC
                      </span>
                      <div>
                        <p className="text-[11px] font-bold">Alimentos Conecta LTDA</p>
                        <p className="text-[9px] text-slate-500">CNPJ enriquecido · risco aprovado</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[9px] font-bold text-sky-300">
                      Prioridade alta
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- STATS BAND ---------- */}
      <section className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-5 py-14 sm:px-6 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.k} className="text-center">
              <p className="bg-gradient-to-r from-sky-300 to-indigo-300 bg-clip-text text-3xl font-black text-transparent sm:text-4xl">
                {s.v}
              </p>
              <p className="mt-2 text-sm font-semibold text-white">{s.k}</p>
              <p className="mt-0.5 text-xs text-slate-400">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- FEATURES ---------- */}
      <section id="recursos" className="relative mx-auto max-w-7xl scroll-mt-24 px-5 py-24 sm:px-6">
        <div className="text-center">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">Recursos</span>
          <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
            Tudo que sua operação comercial precisa, em uma plataforma
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">
            Da descoberta de empresas até o envio de campanhas, a B2Base organiza o caminho completo.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition duration-300 hover:-translate-y-1 hover:border-sky-400/40 hover:bg-white/[0.05]"
            >
              <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-sky-500/0 blur-2xl transition duration-300 group-hover:bg-sky-500/20" />
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300 transition group-hover:bg-sky-500/25">
                  <f.icon className="h-6 w-6" />
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {f.tag}
                </span>
              </div>
              <h3 className="text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="como-funciona" className="scroll-mt-24 border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">Como funciona</span>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
              Do perfil comercial ao fechamento em três passos
            </h2>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.step} className="relative rounded-2xl border border-white/10 bg-slate-900/40 p-7">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-500 text-white shadow-lg shadow-sky-500/20">
                    <s.icon className="h-6 w-6" />
                  </div>
                  <span className="text-4xl font-black tracking-tight text-white/10">{s.step}</span>
                </div>
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
                {i < steps.length - 1 && (
                  <ChevronRight className="absolute -right-4 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-sky-400/50 md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- SECURITY / ENTERPRISE ---------- */}
      <section id="seguranca" className="scroll-mt-24 mx-auto max-w-7xl px-5 py-24 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">Enterprise & Segurança</span>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              Construída para empresas que levam dados a sério
            </h2>
            <p className="mt-4 max-w-lg text-slate-400">
              Privacidade, conformidade e segurança não são um add-on — são a fundação da B2Base. Tratamos dados
              pessoais com base legal, transparência de origem e controles modernos de acesso.
            </p>
            <a
              href="#recursos"
              className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-sky-300 transition hover:text-sky-200"
            >
              Conhecer a plataforma
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {compliance.map((c) => (
              <div key={c.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-300">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold">{c.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- TESTIMONIALS ---------- */}
      <section id="depoimentos" className="scroll-mt-24 border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-sky-400">Quem usa</span>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">
              Equipes comerciais confiam na B2Base
            </h2>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure
                key={t.name}
                className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/40 p-7"
              >
                <div>
                  <Quote className="h-7 w-7 text-sky-400/60" />
                  <blockquote className="mt-4 text-sm leading-relaxed text-slate-300">"{t.quote}"</blockquote>
                </div>
                <figcaption className="mt-6 border-t border-white/10 pt-4">
                  <p className="text-sm font-bold text-white">{t.name}</p>
                  <p className="text-xs text-slate-400">{t.role}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-sky-500/20 blur-[120px]" />
        <div className="relative mx-auto max-w-7xl px-5 py-24 text-center sm:px-6">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
              Pronto para vender com inteligência de dados?
            </h2>
            <p className="mt-4 text-lg text-slate-300">
              Entre na plataforma e monte seu perfil comercial em minutos. Comece a descobrir as empresas certas hoje.
            </p>
            <button
              onClick={onLogin}
              className="group mt-8 inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 px-8 py-4 text-base font-bold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-110"
            >
              Começar agora
              <ArrowRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
            </button>
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              Sem cartão de crédito · Acesso restrito à conta corporativa
            </p>
          </div>
        </div>
      </section>

      {/* ---------- FOOTER ---------- */}
      <footer className="border-t border-white/[0.06] bg-slate-950">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6">
          <div className="grid gap-10 md:grid-cols-4">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5">
                <img src="/logo-symbol.png" alt="B2Base" className="h-9 w-9 object-contain" />
                <span className="text-lg font-extrabold tracking-tight">
                  B2Base<span className="text-sky-400">.net</span>
                </span>
              </div>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
                Plataforma B2B de inteligência comercial: dados de CNPJ, prospecção, CRM, pipeline, risco e
                outreach automatizado — em conformidade com a LGPD e boas práticas do SOC 2.
              </p>
              <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                aderente à LGPD · controles alinhados ao SOC 2
              </div>
            </div>

            <div>
              <p className="text-sm font-bold text-white">Plataforma</p>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
                {['Inteligência de CNPJ', 'Prospecção e CRM', 'Pipeline de vendas', 'Análise de risco', 'Outreach'].map(
                  (l) => (
                    <li key={l}>
                      <a href="#recursos" className="transition hover:text-white">
                        {l}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div>
              <p className="text-sm font-bold text-white">Empresa</p>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
                <li>
                  <a href="/privacy-policy" className="transition hover:text-white">
                    Política de Privacidade
                  </a>
                </li>
                <li>
                  <a href="/terms-of-usage" className="transition hover:text-white">
                    Termos de Uso
                  </a>
                </li>
                <li>
                  <a href="mailto:contato@b2base.net" className="transition hover:text-white">
                    contato@b2base.net
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-8 sm:flex-row">
            <p className="text-xs text-slate-500">© {new Date().getFullYear()} B2Base Platform · b2base.net</p>
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Lock className="h-3.5 w-3.5" />
              Acesso seguro · sessão restrita à sua conta
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};
