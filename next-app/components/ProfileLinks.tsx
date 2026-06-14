// ProfileLinks — links externos (Instagram + site) do perfil. Compartilhado
// entre o ProfileHeader (perfil próprio) e a PublicProfileView (perfil de
// outra pessoa). Normaliza @user do IG pra URL completa e valida href
// (bloqueia javascript:/data: mesmo que venha de import legado/admin SQL).

interface ProfileLinksProps {
  instagramUrl: string | null;
  websiteUrl: string | null;
}

export function ProfileLinks({ instagramUrl, websiteUrl }: ProfileLinksProps) {
  if (!instagramUrl && !websiteUrl) return null;

  const safeHref = (raw: string | null): string | null => {
    if (!raw) return null;
    const v = raw.trim();
    return /^https?:\/\//i.test(v) ? v : null;
  };
  const igHref = (() => {
    if (!instagramUrl) return null;
    const v = instagramUrl.trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (/^@?[a-zA-Z0-9._]+$/.test(v)) {
      return `https://instagram.com/${v.replace(/^@/, '')}`;
    }
    return null;
  })();
  const safeSite = safeHref(websiteUrl);
  if (!igHref && !safeSite) return null;

  return (
    <div className="mt-2 flex items-center gap-3 text-white/85 text-xs">
      {igHref ? (
        <a
          href={igHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:underline"
          aria-label="Instagram"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          Instagram
        </a>
      ) : null}
      {safeSite ? (
        <a
          href={safeSite}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:underline"
          aria-label="Site"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
          Site
        </a>
      ) : null}
    </div>
  );
}
