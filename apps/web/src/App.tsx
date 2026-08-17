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
      // 1) Complete a Firebase OAuth redirect (Google/GitHub). After the
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
    window.addEventListener('salesintel:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('salesintel:unauthorized', handleUnauthorized);
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

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-slate-400">
        <span className="animate-pulse">Carregando sessão…</span>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginView
        onAuthenticated={(user) => {
          setLoginError(null);
          setSession(user);
        }}
        initialError={loginError}
      />
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

      {!isLoadingProfile && !commercialProfile?.onboardingCompleted && (
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
