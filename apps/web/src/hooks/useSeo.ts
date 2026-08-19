import { useEffect } from 'react';

interface SeoOptions {
  title: string;
  description: string;
  /** Absolute canonical URL for this view, or a path that resolves against the site root. */
  canonical?: string;
}

const SITE_URL = 'https://b2base.net';

/**
 * Lightweight per-route SEO for the SPA: keeps <title>, meta description,
 * canonical and Open Graph tags in sync with the active view. Because the
 * app is a client-side SPA, this complements the static head in index.html
 * (which covers the public landing page and no-JS/crawler fallback).
 */
export function useSeo({ title, description, canonical }: SeoOptions): void {
  useEffect(() => {
    const BRAND = 'B2Base';
    // Avoid "... | B2Base | B2Base" when the title already carries the brand.
    const pageTitle = title.includes(BRAND) ? title : `${title} | ${BRAND}`;
    document.title = pageTitle;

    const setMeta = (attr: 'name' | 'property', key: string, value: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', value);
    };

    setMeta('name', 'description', description);

    // Canonical: allow cross-page canonicalization to a dedicated landing URL.
    const canonicalUrl = canonical
      ? canonical.startsWith('http')
        ? canonical
        : `${SITE_URL}${canonical}`
      : window.location.href.split('?')[0];

    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', canonicalUrl);

    // Keep Open Graph in sync too.
    setMeta('property', 'og:title', pageTitle);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', canonicalUrl);

    return () => {
      // On unmount, restore the base title/meta from the static head.
      document.title = 'B2Base | Inteligência de CNPJ, Prospecção, CRM e Pipeline B2B';
    };
  }, [title, description, canonical]);
}
