import React, { useState } from 'react';
import { 
  Building2, 
  Search, 
  Plus, 
  Trash2, 
  Eye, 
  Download, 
  RefreshCw,
  Building,
  Users
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Prospect } from '@/types';
import { formatCNPJ } from '@/lib/utils';

interface ProspectsDirectoryViewProps {
  prospects: Prospect[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenCreateModal: () => void;
  onSelectProspect: (prospect: Prospect) => void;
  onDeleteProspect: (id: string) => void;
  onRefresh: () => void;
}

export const ProspectsDirectoryView: React.FC<ProspectsDirectoryViewProps> = ({
  prospects,
  searchQuery,
  setSearchQuery,
  onOpenCreateModal,
  onSelectProspect,
  onDeleteProspect,
  onRefresh,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');

  const filteredProspects = prospects.filter((p) => {
    const matchesSearch = 
      p.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.cnpj.includes(searchQuery);
    
    const matchesStatus = selectedStatus === 'all' || p.status === selectedStatus;
    const matchesIndustry = selectedIndustry === 'all' || p.industry === selectedIndustry;

    return matchesSearch && matchesStatus && matchesIndustry;
  });

  const industries = Array.from(new Set(prospects.map(p => p.industry).filter(Boolean)));

  const handleExportCSV = () => {
    const headers = ["ID", "CNPJ", "Empresa", "Setor", "Funcionarios", "Score", "Status"];
    const rows = filteredProspects.map(p => [
      p.id,
      p.cnpj,
      `"${p.companyName}"`,
      p.industry || 'N/A',
      p.employees || 0,
      p.opportunityScore,
      p.status
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `salesintel_prospects_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Bar & Control Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">
            Diretório de Prospectos
          </h1>
          <p className="text-xs text-slate-500 dark:text-muted-foreground">
            {filteredProspects.length} de {prospects.length} empresas exibidas no banco PostgreSQL.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={onRefresh}
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold border-slate-200 dark:border-border text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>

          <Button
            onClick={handleExportCSV}
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold border-slate-200 dark:border-border text-slate-700 dark:text-foreground hover:bg-slate-50 dark:hover:bg-accent"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </Button>

          <Button
            onClick={onOpenCreateModal}
            className="h-9 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-600/20"
          >
            <Plus className="h-4 w-4" />
            Adicionar Prospecto
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Search input */}
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-muted-foreground" />
              <Input
                type="text"
                placeholder="Filtrar por nome ou CNPJ..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 bg-slate-50 dark:bg-secondary/50 border-slate-200 dark:border-border text-xs text-slate-900 dark:text-foreground"
              />
            </div>

            {/* Status Filter Pills */}
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground mr-1">Status:</span>
              {['all', 'qualified', 'prospect', 'lead'].map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStatus(st)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                    selectedStatus === st
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-secondary/60 dark:text-muted-foreground dark:hover:bg-secondary'
                  }`}
                >
                  {st === 'all' ? 'Todos' : st.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Industry Filter Dropdown */}
            {industries.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground">Setor:</span>
                <select
                  value={selectedIndustry}
                  onChange={(e) => setSelectedIndustry(e.target.value)}
                  className="h-9 rounded-lg border border-slate-200 dark:border-border/80 bg-slate-50 dark:bg-secondary/50 px-3 text-xs font-semibold text-slate-900 dark:text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">Todos os setores</option>
                  {industries.map((ind) => (
                    <option key={ind} value={ind!}>{ind}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Data Table */}
      <Card className="glass-card overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-secondary/60 text-slate-500 dark:text-muted-foreground uppercase text-[10px] font-bold tracking-wider border-b border-slate-200 dark:border-border/80">
                <tr>
                  <th className="px-6 py-3.5">Empresa</th>
                  <th className="px-6 py-3.5">CNPJ</th>
                  <th className="px-6 py-3.5">Setor</th>
                  <th className="px-6 py-3.5">Funcionários</th>
                  <th className="px-6 py-3.5">Score CNPJ</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-border/60">
                {filteredProspects.length > 0 ? (
                  filteredProspects.map((p) => (
                    <tr 
                      key={p.id}
                      className="hover:bg-slate-50 dark:hover:bg-secondary/40 transition-colors group"
                    >
                      <td className="px-6 py-4 font-semibold text-slate-900 dark:text-foreground flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                          <Building className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 dark:text-foreground">{p.companyName}</p>
                          <p className="text-[10px] text-slate-400 dark:text-muted-foreground">ID: {p.id.slice(-8)}</p>
                        </div>
                      </td>

                      <td className="px-6 py-4 font-mono text-slate-600 dark:text-muted-foreground font-semibold">
                        {formatCNPJ(p.cnpj)}
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-foreground/90 font-medium">
                        {p.industry || 'Software'}
                      </td>

                      <td className="px-6 py-4 text-slate-600 dark:text-muted-foreground">
                        <div className="flex items-center gap-1.5 font-medium">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          <span>{p.employees || 'N/A'}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-indigo-600 dark:text-indigo-400 text-sm">{p.opportunityScore}</span>
                          <div className="w-16 bg-slate-100 dark:bg-secondary h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="bg-indigo-600 h-full rounded-full"
                              style={{ width: `${p.opportunityScore}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <Badge variant={p.status === 'qualified' ? 'qualified' : p.status === 'prospect' ? 'prospect' : 'lead'}>
                          {p.status.toUpperCase()}
                        </Badge>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            onClick={() => onSelectProspect(p)}
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-slate-900 dark:text-muted-foreground dark:hover:text-foreground"
                            title="Ver Detalhes"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          <Button
                            onClick={() => onDeleteProspect(p.id)}
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-rose-600 dark:text-muted-foreground dark:hover:text-destructive"
                            title="Excluir"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500 dark:text-muted-foreground">
                      <p className="text-sm font-semibold">Nenhum prospecto encontrado</p>
                      <p className="text-xs mt-1">Tente ajustar os filtros ou adicione uma nova empresa ao banco.</p>
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
