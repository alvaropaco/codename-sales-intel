import React, { useRef, useState } from 'react';
import { X, FileUp, Sparkles, CheckCircle2, AlertTriangle, CopyX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { importLeadsCsv, CsvImportResult } from '@/services/api';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024; // espelha o limite do backend

// Rótulos pt-BR dos campos do modelo Prospect (espelha csv-import.js).
const FIELD_LABELS: Record<string, string> = {
  cnpj: 'CNPJ',
  companyName: 'Razão social',
  tradeName: 'Nome fantasia',
  industry: 'Setor',
  domain: 'Site',
  city: 'Cidade',
  state: 'UF',
  email: 'E-mail',
  phone: 'Telefone',
  employees: 'Funcionários',
  revenueEstimate: 'Faturamento',
  contactName: 'Contato',
};

export const CsvImportModal: React.FC<CsvImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [fileName, setFileName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const reset = () => {
    setFileName('');
    setError('');
    setResult(null);
    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File) => {
    setError('');
    setResult(null);

    if (file.size > MAX_FILE_BYTES) {
      setError('Arquivo muito grande (limite de 2MB). Divida a planilha e importe em partes.');
      return;
    }

    setFileName(file.name);
    setIsImporting(true);
    try {
      const csv = await file.text();
      const data = await importLeadsCsv(csv);
      setResult(data);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível importar o CSV.');
    } finally {
      setIsImporting(false);
    }
  };

  const mappedFields = result ? Object.entries(result.mapping).filter(([, column]) => !!column) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-5 relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400">
              <FileUp className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Importar leads de planilha CSV</h3>
              <p className="text-xs text-muted-foreground">
                A IA entende a estrutura do arquivo e cadastra os leads para enriquecimento.
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Seleção de arquivo */}
        {!result && (
          <div className="space-y-3">
            <label
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-8 text-center cursor-pointer hover:bg-secondary/50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file && !isImporting) handleFile(file);
              }}
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                  <span className="text-xs font-semibold text-foreground">
                    Analisando a estrutura de {fileName || 'arquivo'} com IA…
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Mapeamos as colunas e cadastramos os leads para enriquecimento.
                  </span>
                </>
              ) : (
                <>
                  <FileUp className="h-6 w-6 text-muted-foreground" />
                  <span className="text-xs font-semibold text-foreground">
                    Arraste um arquivo .csv ou clique para selecionar
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Recomendamos uma coluna com CNPJ — leads sem CNPJ são cadastrados e ficam
                    pendentes de enriquecimento. Máximo 300 linhas por importação.
                  </span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                disabled={isImporting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>

            {error && (
              <div className="p-3 rounded-lg border bg-destructive/20 border-destructive/30 text-destructive text-xs font-semibold">
                <p>{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Relatório da importação */}
        {result && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg border bg-emerald-500/10 border-emerald-500/30 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-foreground space-y-1">
                <p className="font-bold">
                  {result.importedCount} {result.importedCount === 1 ? 'lead cadastrado' : 'leads cadastrados'}
                  {result.importedWithoutCnpj === 0 ? ' — enriquecimento em andamento.' : '.'}
                </p>
                <p className="text-muted-foreground">
                  {result.importedWithoutCnpj > 0 && (
                    <>· {result.importedWithoutCnpj} sem CNPJ (ficam pendentes até informar o identificador). </>
                  )}
                  {result.alreadyExists > 0 && <>· {result.alreadyExists} já existiam na sua lista. </>}
                  {result.failures.length > 0 && <>· {result.failures.length} com problema. </>}
                  {result.warnings.length > 0 && <>· {result.warnings.length} com avisos.</>}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-border bg-secondary/30 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                Estrutura entendida pela IA
                {result.mappingSource !== 'ai' && (
                  <span className="ml-1 font-medium text-muted-foreground">(mapeamento automático)</span>
                )}
              </div>
              <div className="grid grid-cols-1 gap-1 text-[11px]">
                {mappedFields.map(([field, column]) => (
                  <div key={field} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{FIELD_LABELS[field] || field}</span>
                    <span className="font-mono font-semibold text-foreground truncate">{column}</span>
                  </div>
                ))}
              </div>
              {result.memoryUsed && (
                <p className="text-[11px] text-muted-foreground">
                  Reusamos como referência o mapeamento aceito de um import anterior da sua organização.
                </p>
              )}
              {result.mappingNotes && (
                <p className="text-[11px] italic text-muted-foreground pt-1 border-t border-border/60">
                  {result.mappingNotes}
                </p>
              )}
            </div>

            {result.limitReached && (
              <div className="p-3 rounded-lg border bg-amber-500/15 border-amber-500/40 text-amber-300 text-xs font-semibold">
                {result.limitMessage || 'Limite de leads do plano atingido durante a importação.'}
                <a href="/settings?plan=upgrade" className="ml-2 underline underline-offset-2 font-bold">
                  Fazer upgrade
                </a>
              </div>
            )}

            {result.truncated && (
              <div className="p-3 rounded-lg border bg-amber-500/15 border-amber-500/40 text-amber-300 text-xs font-semibold">
                O arquivo tinha mais de {result.maxRows} linhas — apenas as primeiras {result.requested} foram
                importadas. Divida a planilha para importar o restante.
              </div>
            )}

            {result.failures.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                  <CopyX className="h-3.5 w-3.5 text-destructive" /> Linhas com problema
                </p>
                <div className="max-h-32 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                  {result.failures.slice(0, 20).map((failure, idx) => (
                    <div key={idx} className="px-2.5 py-1.5 text-[11px] flex items-start gap-2">
                      <span className="text-muted-foreground shrink-0">
                        {failure.row ? `Linha ${failure.row}` : failure.cnpj}
                      </span>
                      <span className="text-muted-foreground">{failure.reason}</span>
                    </div>
                  ))}
                  {result.failures.length > 20 && (
                    <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
                      + {result.failures.length - 20} outras linhas…
                    </div>
                  )}
                </div>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Avisos (leads cadastrados mesmo assim)
                </p>
                <div className="max-h-24 overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
                  {result.warnings.slice(0, 10).map((warning, idx) => (
                    <div key={idx} className="px-2.5 py-1.5 text-[11px] flex items-start gap-2">
                      <span className="text-muted-foreground shrink-0">Linha {warning.row}</span>
                      <span className="text-muted-foreground">{warning.messages.join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={reset} disabled={isImporting}>
                Importar outro arquivo
              </Button>
              <Button variant="gradient" size="sm" onClick={handleClose}>
                Concluir
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
