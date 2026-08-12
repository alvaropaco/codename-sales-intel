import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { ExecutiveDashboardView } from '@/components/views/ExecutiveDashboardView';
import { ProspectsDirectoryView } from '@/components/views/ProspectsDirectoryView';
import { PipelineKanbanView } from '@/components/views/PipelineKanbanView';
import { CreditRiskView } from '@/components/views/CreditRiskView';
import { WorkflowsView } from '@/components/views/WorkflowsView';
import { CnpjEnrichmentView } from '@/components/views/CnpjEnrichmentView';
import { ProspectModal } from '@/components/modals/ProspectModal';
import { ProspectDetailDrawer } from '@/components/modals/ProspectDetailDrawer';
import { ActiveTab, Prospect, PipelineAnalytics, ForecastAnalytics } from '@/types';
import { fetchProspects, fetchPipelineAnalytics, fetchForecastAnalytics, deleteProspect } from '@/services/api';

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [isDark, setIsDark] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [analytics, setAnalytics] = useState<PipelineAnalytics>({
    total_prospects: 0,
    qualified: 0,
    prospects: 0,
    leads: 0,
    qualification_rate: 0,
    closure_rate: 0.83,
  });
  const [forecast, setForecast] = useState<ForecastAnalytics>({
    this_month: 125000,
    next_month: 185000,
    q3_projection: 450000,
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);

  const loadData = async () => {
    try {
      const [prospectsData, analyticsData, forecastData] = await Promise.all([
        fetchProspects(),
        fetchPipelineAnalytics(),
        fetchForecastAnalytics(),
      ]);
      setProspects(prospectsData);
      setAnalytics(analyticsData);
      setForecast(forecastData);
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDeleteProspect = async (id: string) => {
    if (!confirm('Deseja realmente excluir este prospecto?')) return;
    await deleteProspect(id);
    await loadData();
  };

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

      {activeTab === 'settings' && (
        <div className="p-8 max-w-xl mx-auto space-y-4 text-center">
          <h2 className="text-xl font-bold text-foreground">Preferências SalesIntel</h2>
          <p className="text-xs text-muted-foreground">
            Ajuste segmentos de interesse, regiões prioritárias e critérios comerciais da organização SalesIntel Demo.
          </p>
        </div>
      )}

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
    </Layout>
  );
}

export default App;
