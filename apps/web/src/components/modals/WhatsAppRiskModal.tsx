import React from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WhatsAppRiskModalProps {
  open: boolean;
  /** Confirmação explícita: única forma de prosseguir com a conexão. */
  onConfirm: () => void;
  /** Cancela: nenhuma chamada de rede acontece, nenhum estado muda. */
  onCancel: () => void;
}

/**
 * Aviso de risco antes de conectar uma conta de WhatsApp (feature 007 — US6).
 * O uso automatizado de mensagens viola os termos do WhatsApp e pode resultar
 * no BLOQUEIO da conta conectada. A conexão só prossegue após confirmação
 * explícita do usuário.
 */
export function WhatsAppRiskModal({ open, onConfirm, onCancel }: WhatsAppRiskModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-risk-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-5 relative">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 id="wa-risk-title" className="text-base font-bold text-foreground">
                Antes de conectar seu WhatsApp
              </h3>
              <p className="text-xs text-muted-foreground">Leia este aviso com atenção.</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancelar"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-foreground/90">
          <p>
            O uso automatizado de mensagens pode <strong>violar os termos de uso do WhatsApp</strong>{' '}
            e resultar no <strong className="text-amber-500">bloqueio permanente da conta</strong>{' '}
            conectada — sem aviso prévio e sem chance de recurso.
          </p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              Prefira um <strong>número dedicado ao negócio</strong> (não use seu número pessoal).
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              Envie apenas para contatos com relação prévia e respeite pedidos de descadastro.
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              O ritmo de envio já é limitado pela plataforma, mas o risco de bloqueio é do número
              conectado.
            </li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="gradient" size="sm" onClick={onConfirm}>
            Entendi os riscos e quero conectar
          </Button>
        </div>
      </div>
    </div>
  );
}

export default WhatsAppRiskModal;
