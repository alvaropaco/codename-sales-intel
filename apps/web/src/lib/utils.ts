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

/**
 * Normalize a Brazilian phone number to the international format used by
 * WhatsApp's wa.me links. Assumes Brazilian numbers (country code +55).
 *
 * Examples:
 *   "(12) 3456-7890"  -> "551234567890"
 *   "551234567890"     -> "551234567890"
 *   "1234567890"       -> "551234567890"
 *   "12 34567890"      -> "551234567890"
 *
 * Returns null when the number doesn't contain enough digits to be usable.
 */
export function toWhatsAppNumber(
  phone: string | null | undefined
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");

  // Already includes Brazil country code (+55)
  if (digits.length === 12 && digits.startsWith("55")) return digits;
  // Includes country code + DDD (13 digits, e.g. 55 + 11 digits)
  if (digits.length === 13 && digits.startsWith("55")) return digits;

  // Local 10 or 11 digits (with DDD) — prepend +55
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;

  // Anything else is not a usable Brazilian number
  return null;
}

/**
 * Build a wa.me link that opens a WhatsApp conversation with the given number.
 * Returns null when the number is not valid/usable.
 */
export function whatsappLink(
  phone: string | null | undefined
): string | null {
  const number = toWhatsAppNumber(phone);
  return number ? `https://wa.me/${number}` : null;
}
