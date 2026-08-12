import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format CNPJ string (e.g. 12345678000199 -> 12.345.678/0001-99)
 */
export function formatCNPJ(cnpj: string | null | undefined): string {
  if (!cnpj) return "N/A";
  const cleaned = cnpj.replace(/\D/g, "");
  if (cleaned.length !== 14) return cnpj;
  return cleaned.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Format BRL Currency
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === undefined || value === null) return "R$ 0";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format Number with PT-BR separators
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === undefined || value === null) return "0";
  return new Intl.NumberFormat("pt-BR").format(value);
}
