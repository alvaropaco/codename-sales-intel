import React, { useEffect, useMemo, useState } from 'react';
import {
  Building,
  Building2,
  Download,
  Eye,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  UserPlus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CommercialProfile, DiscoveredCompany, Prospect } from '@/types';
import { formatCNPJ } from '@/lib/utils';
import {
  fetchDiscoveryCandidates,
  importDiscoveredCompany,
} from '@/services/api';

interface ProspectsDirectoryViewProps {
  prospects: Prospect[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSelectProspect: (prospect: Prospect) => void;
  onDeleteProspect: (id: string) => void;
  onRefresh: () => void;
  commercialProfile: CommercialProfile | null;
  onOpenSettings: () => void;
}

const statusLabels: Record<string, string> = {
  all: 'Todas',
  qualified: 'Prontas para contato',
  prospect: 'Em avaliação',
  lead: 'Novas oportunidades',
  contacted: 'Contato iniciado',
  proposal: 'Proposta enviada',
  closed: 'Cliente ganho',
};

const sizeRanges = [
  { value: 'all', label: 'Todos os portes' },
  { value: 'small', label: 'Até 50 colaboradores' },
  { value: 'medium', label: '51 a 250 colaboradores' },
  { value: 'large', label: 'Acima de 250 colaboradores' },
];

const ageRanges = [
  { value: 'all', label: 'Qualquer tempo de atividade' },
  { value: 'new', label: 'Até 2 anos' },
  { value: 'growing', label: '2 a 10 anos' },
  { value: 'established', label: 'Mais de 10 anos' },
];

export const ProspectsDirectoryView: React.FC<ProspectsDirectoryViewProps> = ({
  prospects,
  searchQuery,
  setSearchQuery,
  onSelectProspect,
  onDeleteProspect,
  onRefresh,
  commercialProfile,
  onOpenSettings,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedSituation, setSelectedSituation] = useState('active');
  const [selectedSize, setSelectedSize] = useState('all');
  const [selectedAge, setSelectedAge] = useState('all');

  const [discovered, setDiscovered] = useState<DiscoveredCompany[]>([]);
  const [discoveryCriteria, setDiscoveryCriteria] = useState<{ segments: string[]; locations: string[]; activeOnly: boolean; usedProfile: boolean }>({ segments: [], locations: [], activeOnly: false, usedProfile: false });
  const [isLoadingDiscovery, setIsLoadingDiscovery] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const [isImporting, setIsImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState('');

  const loadDiscovery = async () => {
    setIsLoadingDiscovery(true);
    setImportError('');
    const segment = searchQuery.trim() || undefined;
    const location = selectedLocation.trim() || undefined;
    const result = await fetchDiscoveryCandidates({ segment, location, limit: 12 });
    setDiscovered(result.companies);
    setDiscoveryCriteria(result.criteria);
    setDiscoveryMessage(result.message || '');
    setIsLoadingDiscovery(false);
  };

  useEffect(() => {
    // Load discovered companies on mount, and when the seller changes the
    // searched niche or location so results follow the active criteria.
    const timer = setTimeout(() => loadDiscovery(), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, selectedLocation]);

  const handleImport = async (company: DiscoveredCompany) => {
    setIsImporting(company.cnpj);
    setImportError('');
    try {
      await importDiscoveredCompany({
        cnpj: company.cnpj,
        legalName: company.legalName,
        tradeName: company.tradeName || null,
        industry: company.industry || null,
        status: company.status || 'active',
        email: company.email || null,
        city: company.city || null,
        state: company.state || null,
        openingDate: company.openingDate || null,
        legalNature: company.legalNature || null,
      });
      // Refresh the registered list and drop the just-imported company.
      await onRefresh();
      setDiscovered((current) => current.filter((c) => c.cnpj !== company.cnpj));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Não foi possível adicionar a empresa.');
    } finally {
      setIsImporting(null);
    }
  };

  const industries = Array.from(new Set(prospects.map((p) => p.industry).filter(Boolean)));
  const profileSegments = [
    ...(commercialProfile?.targetSegments || []),
    ...(commercialProfile?.targetCnaes || []),
  ];
  const profileLocations = commercialProfile?.targetLocations || [];

  const filteredProspects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const location = selectedLocation.toLowerCase().trim();

    return prospects.filter((p) => {
      const commercialText = [
        p.companyName,
        p.industry,
        (p as any).tradeName,
        (p as any).mainActivity,
        (p as any).segment,
        (p as any).cnaeDescription,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const locationText = [
        (p as any).city,
        (p as any).state,
        (p as any).region,
        (p as any).neighborhood,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const employees = p.employees || 0;
      const createdYear = p.createdAt ? new Date(p.createdAt).getFullYear() : new Date().getFullYear();
      const ageYears = Math.max(0, new Date().getFullYear() - createdYear);

      const matchesSearch = !q || commercialText.includes(q);
      const matchesStatus = selectedStatus === 'all' || p.status === selectedStatus;
      const matchesIndustry = selectedIndustry === 'all' || p.industry === selectedIndustry;
      const matchesLocation = !location || locationText.includes(location);
      const matchesSituation = selectedSituation === 'all' || selectedSituation === 'active';
      const matchesSize =
        selectedSize === 'all' ||
        (selectedSize === 'small' && employees <= 50) ||
        (selectedSize === 'medium' && employees > 50 && employees <= 250) ||
        (selectedSize === 'large' && employees > 250);
      const matchesAge =
        selectedAge === 'all' ||
        (selectedAge === 'new' && ageYears <= 2) ||
        (selectedAge === 'growing' && ageYears > 2 && ageYears <= 10) ||
        (selectedAge === 'established' && ageYears > 10);

      return matchesSearch && matchesStatus && matchesIndustry && matchesLocation && matchesSituation && matchesSize && matchesAge;
    });
  }, [prospects, searchQuery, selectedAge, selectedIndustry, selectedLocation, selectedSituation, selectedSize, selectedStatus]);

  const handleExportList = () => {
    const headers = ['Empresa', 'Segmento', 'Colaboradores', 'Potencial', 'Momento comercial'];
    const rows = filteredProspects.map((p) => [
      `"${p.companyName}"`,
      p.industry || 'Não classificado',
      p.employees || 0,
      p.opportunityScore,
      statusLabels[p.status] || p.status,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `salesintel_oportunidades_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-300">
            <Building2 className="h-5 w-5" />
            <span className="text-[11px] font-black uppercase tracking-[0.18em]">Descoberta de oportunidades</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">
            Empresas sugeridas para o seu perfil comercial
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500 dark:text-muted-foreground">
            Lista inicial criada a partir dos segmentos selecionados no onboarding. Use filtros de vendedor para encontrar empresas por nicho, localização, porte, momento e potencial de compra.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onRefresh} variant="outline" size="sm" className="h-9 gap-1.5 text-xs font-semibold border-slate-200 dark:border-border text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-accent">
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar sugestões
          </Button>

          <Button onClick={handleExportList} variant="outline" size="sm" className="h-9 gap-1.5 text-xs font-semibold border-slate-200 dark:border-border text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-accent">
            <Download className="h-3.5 w-3.5" />
            Baixar lista
          </Button>
        </div>
      </div>

      <Card className="border-indigo-100 bg-indigo-50/70 shadow-sm dark:border-indigo-500/20 dark:bg-indigo-500/10">
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-200">
              <SlidersHorizontal className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-[0.16em]">Perfil usado na descoberta</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {profileSegments.length ? profileSegments.slice(0, 6).map((item) => (
                <Badge key={item} variant="outline" className="rounded-full bg-white/80 text-indigo-800 dark:bg-white/10 dark:text-indigo-100">{item}</Badge>
              )) : <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-100">Defina segmentos ou CNAEs para orientar as recomendações.</span>}
              {profileLocations.length ? profileLocations.slice(0, 4).map((item) => (
                <Badge key={item} variant="outline" className="rounded-full bg-white/80 text-indigo-800 dark:bg-white/10 dark:text-indigo-100">{item}</Badge>
              )) : null}
            </div>
          </div>
          <Button onClick={onOpenSettings} variant="outline" className="h-10 shrink-0 gap-2 rounded-xl bg-white/80 text-xs font-bold dark:bg-white/10">
            Ajustar preferências
          </Button>
        </CardContent>
      </Card>

      {/* Empresas descobertas agora via inteligência comercial */}
      <Card className="overflow-hidden border-emerald-100 bg-gradient-to-br from-white to-emerald-50/40 dark:border-emerald-500/20 dark:from-slate-900 dark:to-emerald-500/5">
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-[0.16em]">Empresas descobertas agora</span>
            </div>
            <Button
              onClick={() => loadDiscovery()}
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingDiscovery ? 'animate-spin' : ''}`} />
              Buscar novamente
            </Button>
          </div>

          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {discoveryCriteria.usedProfile
              ? `Sugestões reais a partir do perfil do onboarding (${discoveryCriteria.segments.join(', ') || 'segmentos'}).`
              : discoveryCriteria.segments.length
              ? `Buscando por "${discoveryCriteria.segments.join(', ')}"${discoveryCriteria.locations[0] ? ` em ${discoveryCriteria.locations[0]}` : ''}.`
              : 'Digite um nicho acima ou finalize o onboarding para ver empresas reais com potencial.'}
          </p>

          {importError && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-bold text-red-700">{importError}</p>}
          {discoveryMessage && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">{discoveryMessage}</p>}

          {isLoadingDiscovery ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-xl border border-slate-100 bg-slate-50 dark:border-white/5 dark:bg-white/5" />
              ))}
            </div>
          ) : discovered.length ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {discovered.map((company) => (
                <div key={company.cnpj} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex items-start gap-2.5">
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/20 flex items-center justify-center">
                      <Building className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900 dark:text-white">{company.legalName}</p>
                      <p className="text-[10px] text-slate-400">{formatCNPJ(company.cnpj)}</p>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{company.industry || 'Segmento a confirmar'}</p>
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      <MapPin className="h-3 w-3" /> {company.city ? `${company.city}${company.state ? ` (${company.state})` : ''}` : company.state || 'Local a confirmar'}
                    </span>
                    <Button onClick={() => handleImport(company)} disabled={isImporting === company.cnpj} size="sm" className="h-8 gap-1.5 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700">
                      <UserPlus className="h-3.5 w-3.5" />
                      {isImporting === company.cnpj ? 'Adicionando...' : 'Adicionar à lista'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            !discoveryMessage && (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-6 text-center dark:border-white/10">
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Nenhuma empresa encontrada</p>
                <p className="mt-1 text-xs text-slate-400">Ajuste o nicho ou finalize o onboarding para ver sugestões reais.</p>
              </div>
            )
          )}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-muted-foreground" />
              <Input
                type="text"
                placeholder="Nicho ou atividade: padaria, clínica, software..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-10 bg-slate-50 dark:bg-secondary/50 border-slate-200 dark:border-border text-xs text-slate-900 dark:text-foreground"
              />
            </div>

            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                type="text"
                placeholder="Estado, cidade, região ou bairro"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="pl-9 h-10 bg-slate-50 dark:bg-secondary/50 border-slate-200 dark:border-border text-xs text-slate-900 dark:text-foreground"
              />
            </div>

            <select value={selectedIndustry} onChange={(e) => setSelectedIndustry(e.target.value)} className="h-10 rounded-lg border border-slate-200 dark:border-border/80 bg-slate-50 dark:bg-secondary/50 px-3 text-xs font-semibold text-slate-900 dark:text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="all">Todos os segmentos</option>
              {industries.map((ind) => (
                <option key={ind} value={ind!}>{ind}</option>
              ))}
            </select>

            <select value={selectedSituation} onChange={(e) => setSelectedSituation(e.target.value)} className="h-10 rounded-lg border border-slate-200 dark:border-border/80 bg-slate-50 dark:bg-secondary/50 px-3 text-xs font-semibold text-slate-900 dark:text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="active">Empresas ativas</option>
              <option value="all">Todas as situações</option>
              <option value="inactive">Baixadas ou inativas</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground mr-1">Momento comercial:</span>
            {['all', 'qualified', 'prospect', 'lead', 'contacted'].map((st) => (
              <button
                key={st}
                onClick={() => setSelectedStatus(st)}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  selectedStatus === st
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-secondary/60 dark:text-muted-foreground dark:hover:bg-secondary'
                }`}
              >
                {statusLabels[st] || st}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)} className="h-10 rounded-lg border border-slate-200 dark:border-border/80 bg-slate-50 dark:bg-secondary/50 px-3 text-xs font-semibold text-slate-900 dark:text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {sizeRanges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </select>
            <select value={selectedAge} onChange={(e) => setSelectedAge(e.target.value)} className="h-10 rounded-lg border border-slate-200 dark:border-border/80 bg-slate-50 dark:bg-secondary/50 px-3 text-xs font-semibold text-slate-900 dark:text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {ageRanges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-secondary/60 text-slate-500 dark:text-muted-foreground uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-border/80">
                <tr>
                  <th className="px-6 py-3.5">Empresa</th>
                  <th className="px-6 py-3.5">Segmento</th>
                  <th className="px-6 py-3.5">Porte</th>
                  <th className="px-6 py-3.5">Potencial</th>
                  <th className="px-6 py-3.5">Momento comercial</th>
                  <th className="px-6 py-3.5 text-right">Próxima ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-border/60">
                {filteredProspects.length > 0 ? (
                  filteredProspects.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-secondary/40 transition-colors group">
                      <td className="px-6 py-4 font-semibold text-slate-900 dark:text-foreground">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                            <Building className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 dark:text-foreground">{p.companyName}</p>
                            <p className="text-[10px] text-slate-400 dark:text-muted-foreground">Identificação: {formatCNPJ(p.cnpj)}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-foreground/90 font-medium">{p.industry || 'Segmento a confirmar'}</td>

                      <td className="px-6 py-4 text-slate-600 dark:text-muted-foreground">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          <span>{p.employees ? `${p.employees} colaboradores` : 'Porte a confirmar'}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-indigo-600 dark:text-indigo-400 text-sm">{p.opportunityScore}</span>
                          <div className="w-16 bg-slate-100 dark:bg-secondary h-1.5 rounded-full overflow-hidden">
                            <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${p.opportunityScore}%` }} />
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <Badge variant={p.status === 'qualified' ? 'qualified' : p.status === 'prospect' ? 'prospect' : 'lead'}>
                          {statusLabels[p.status] || 'Em análise'}
                        </Badge>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button onClick={() => onSelectProspect(p)} variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-900 dark:text-muted-foreground dark:hover:text-foreground" title="Ver perfil da empresa">
                            <Eye className="h-4 w-4" />
                          </Button>

                          <Button onClick={() => onDeleteProspect(p.id)} variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-600 dark:text-muted-foreground dark:hover:text-destructive" title="Remover da lista">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500 dark:text-muted-foreground">
                      <p className="text-sm font-semibold">Nenhuma empresa encontrada</p>
                      <p className="text-xs mt-1">Ajuste nicho, localização, porte ou momento comercial para revelar novas oportunidades.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
