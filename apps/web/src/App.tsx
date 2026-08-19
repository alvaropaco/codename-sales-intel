import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { ExecutiveDashboardView } from '@/components/views/ExecutiveDashboardView';
import { ProspectsDirectoryView } from '@/components/views/ProspectsDirectoryView';
import { PipelineKanbanView } from '@/components/views/PipelineKanbanView';
import { CreditRiskView } from '@/components/views/CreditRiskView';
import { WorkflowsView } from '@/components/views/WorkflowsView';
import { CnpjEnrichmentView } from '@/components/views/CnpjEnrichmentView';
import { OutreachView } from '@/components/views/OutreachView';
import { SettingsView } from '@/components/views/SettingsView';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { ProspectModal } from '@/components/modals/ProspectModal';
import { ProspectDetailDrawer } from '@/components/modals/ProspectDetailDrawer';
import { ActiveTab, Prospect, PipelineAnalytics, ForecastAnalytics, CommercialProfile } from '@/types';
import { fetchProspects, fetchPipelineAnalytics, fetchForecastAnalytics, deleteProspect, fetchCommercialProfile, saveCommercialProfile } from '@/services/api';
import { createSession, getSession, logoutSession, type SessionUser } from '@/services/auth';
import { getFirebaseRedirectResult, signOutFirebase } from '@/services/firebase';
import { getAuthErrorMessage } from '@/services/authErrors';
import { LoginView } from '@/components/auth/LoginView';
import { LandingView } from '@/components/auth/LandingView';
import { useSeo } from '@/hooks/useSeo';

// Map a URL path to a tab id so direct navigation (e.g. the Gmail OAuth
// redirect back to /settings?gmail_connected=...) lands on the right view
// instead of always reopening on the dashboard.
const TAB_FROM_PATH: Record<string, ActiveTab> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/prospects': 'prospects',
  '/pipeline': 'pipeline',
  '/risk': 'risk',
  '/workflows': 'workflows',
  '/enrichment': 'enrichment',
  '/outreach': 'outreach',
  '/settings': 'settings',
};

function tabFromPath(path: string): ActiveTab {
  const first = path.split('/')[1] || '';
  const key = first ? `/${first}` : '/';
  return TAB_FROM_PATH[key] || 'dashboard';
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => tabFromPath(window.location.pathname));
  const [isDark, setIsDark] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [analytics, setAnalytics] = useState<PipelineAnalytics>({
    total_prospects: 0,
    qualified: 0,
    prospects: 0,
    leads: 0,
    qualification_rate: 0,
    closure_rate: 0,
  });
  const [forecast, setForecast] = useState<ForecastAnalytics>({
    this_month: 0,
    next_month: 0,
    q3_projection: 0,
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const [commercialProfile, setCommercialProfile] = useState<CommercialProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [session, setSession] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  const VIEW_SEO: Record<ActiveTab, { title: string; description: string }> = {
    dashboard: {
      title: 'Dashboard',
      description: 'Visão geral comercial: prospects, leads, qualificados, taxa de qualificação e projeção de fechamento.',
    },
    prospects: {
      title: 'Prospecção e CRM',
      description: 'Diretório de prospectos B2B com dados de CNPJ, enriquecimento e qualificação de leads.',
    },
    pipeline: {
      title: 'Pipeline de vendas',
      description: 'Gestão visual do funil comercial com estágios, qualificação e priorização de oportunidades.',
    },
    risk: {
      title: 'Análise de risco',
      description: 'Regras comerciais e análise de risco de crédito para priorizar contatos e oportunidades.',
    },
    workflows: {
      title: 'Workflows automáticos',
      description: 'Automação de ações comerciais baseadas em regras, sinais de lead e mudanças de estágio.',
    },
    enrichment: {
      title: 'Enriquecimento de CNPJ',
      description: 'Consulte e enriqueça dados empresariais a partir de fontes oficiais e públicas.',
    },
    outreach: {
      title: 'Outreach automatizado',
      description: 'Crie e lance campanhas de e-mail por Gmail com controle de cadência, rate limits e supressão.',
    },
    settings: {
      title: 'Configurações',
      description: 'Configure seu perfil comercial, conecte contas do Gmail e gerencie integrações.',
    },
  };

  // Keep the public landing page's strong marketing SEO when unauthenticated;
  // only switch to per-route titles once the user enters the authenticated app.
  const LANDING_SEO = {
    title: 'B2Base | Inteligência de CNPJ, Prospecção, CRM e Pipeline B2B',
    description:
      'Plataforma B2B para descobrir e qualificar empresas via dados de CNPJ, organizar prospecção e CRM, gerir pipeline de vendas, avaliar risco e automatizar outreach por e-mail.',
    canonical: '/',
  };

  useSeo(session ? VIEW_SEO[activeTab] : LANDING_SEO);

  const loadData = async () => {
    try {
      const [prospectsData, analyticsData, forecastData, profileData] = await Promise.all([
        fetchProspects(),
        fetchPipelineAnalytics(),
        fetchForecastAnalytics(),
        fetchCommercialProfile(),
      ]);
      setProspects(prospectsData);
      setAnalytics(analyticsData);
      setForecast(forecastData);
      setCommercialProfile(profileData);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) Complete a Firebase OAuth redirect (Google). After the
      // provider sends the browser back to the app, the SDK exposes the result
      // here; we exchange the ID token for a persistent backend session.
      try {
        const idToken = await getFirebaseRedirectResult();
        if (idToken) {
          const user = await createSession(idToken);
          if (!cancelled) {
            setSession(user);
            setAuthLoading(false);
          }
          return;
        }
      } catch (err) {
        console.error('Error completing Firebase redirect sign-in:', err);
        if (!cancelled) {
          setLoginError(getAuthErrorMessage(err));
        }
      }

      // 2) Persistent session: on subsequent visits the httpOnly cookie is sent
      // automatically and resolves the user without any re-login.
      try {
        const user = await getSession();
        if (!cancelled) {
          setSession(user);
          setAuthLoading(false);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
          setAuthLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    const handleUnauthorized = () => setSession(null);
    window.addEventListener('b2base:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('b2base:unauthorized', handleUnauthorized);
  }, []);

  const handleLogout = async () => {
    await signOutFirebase();
    await logoutSession();
    setSession(null);
  };

  const handleDeleteProspect = async (id: string) => {
    if (!confirm('Deseja realmente excluir este prospecto?')) return;
    await deleteProspect(id);
    await loadData();
  };

  const handleSaveCommercialProfile = async (profile: CommercialProfile) => {
    setIsSavingProfile(true);
    try {
      const saved = await saveCommercialProfile(profile);
      setCommercialProfile(saved);
      await loadData();
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleOnboardingStepChange = async (profile: CommercialProfile) => {
    try {
      const saved = await saveCommercialProfile(profile);
      setCommercialProfile(saved);
    } catch (err) {
      console.error('Error saving onboarding progress:', err);
    }
  };

  // Onboarding must be shown whenever settings are missing, not only when the
  // backend `onboardingCompleted` flag is false. This covers brand-new accounts
  // (no CommercialSettings row) and any profile that was partially filled.
  const profileIncomplete = !!session && !isLoadingProfile && (
    !commercialProfile ||
    !commercialProfile.onboardingCompleted ||
    !(commercialProfile.companyName || '').trim() ||
    (!commercialProfile.targetSegments.length && !commercialProfile.targetCnaes.length) ||
    !commercialProfile.targetLocations.length
  );

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-slate-400">
        <span className="animate-pulse">Carregando sessão…</span>
      </div>
    );
  }

  if (!session) {
    return showLogin ? (
      <LoginView
        onAuthenticated={(user) => {
          setLoginError(null);
          setSession(user);
        }}
        initialError={loginError}
      />
    ) : (
      <LandingView onLogin={() => setShowLogin(true)} />
    );
  }

  return (
    <Layout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      isDark={isDark}
      setIsDark={setIsDark}
      totalProspectsCount={prospects.length}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      onOpenCreateModal={() => setActiveTab('prospects')}
      onOpenQualifyModal={() => setActiveTab('risk')}
      userName={session.name || session.phone || session.email}
      userEmail={session.phone || session.email}
      onLogout={handleLogout}
    >
      {activeTab === 'dashboard' && (
        <ExecutiveDashboardView
          prospects={prospects}
          analytics={analytics}
          forecast={forecast}
          onSelectProspect={(p) => setSelectedProspect(p)}
          onNavigateToTab={(tab) => setActiveTab(tab)}
        />
      )}

      {activeTab === 'prospects' && (
        <ProspectsDirectoryView
          prospects={prospects}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSelectProspect={(p) => setSelectedProspect(p)}
          onDeleteProspect={handleDeleteProspect}
          onRefresh={loadData}
          commercialProfile={commercialProfile}
          onOpenSettings={() => setActiveTab('settings')}
        />
      )}

      {activeTab === 'pipeline' && (
        <PipelineKanbanView
          prospects={prospects}
          onSelectProspect={(p) => setSelectedProspect(p)}
          onRefresh={loadData}
        />
      )}

      {activeTab === 'risk' && <CreditRiskView />}

      {activeTab === 'workflows' && <WorkflowsView />}

      {activeTab === 'enrichment' && <CnpjEnrichmentView />}

      {activeTab === 'outreach' && <OutreachView prospects={prospects} />}

      {activeTab === 'settings' && <SettingsView profile={commercialProfile} onSave={handleSaveCommercialProfile} isSaving={isSavingProfile} />}

      {/* Modals & Drawers */}
      <ProspectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={loadData}
      />

      <ProspectDetailDrawer
        prospect={selectedProspect}
        onClose={() => setSelectedProspect(null)}
        onDelete={handleDeleteProspect}
      />

      {profileIncomplete && (
        <OnboardingModal
          profile={commercialProfile}
          onSave={handleSaveCommercialProfile}
          onStepChange={handleOnboardingStepChange}
          isSaving={isSavingProfile}
        />
      )}
    </Layout>
  );
}

export default App;
