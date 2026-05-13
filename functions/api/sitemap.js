// GET /api/sitemap.xml
// Dynamic XML sitemap for SEO. Lists static pages + public painter profiles.
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const SITE_ORIGIN = 'https://queroumacor.com';

const STATIC_PAGES = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/pintores', changefreq: 'daily', priority: '0.9' },
  { loc: '/tintas', changefreq: 'weekly', priority: '0.8' }
];

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  try {
    const urls = [...STATIC_PAGES.map(p => ({
      loc: `${SITE_ORIGIN}${p.loc}`,
      changefreq: p.changefreq,
      priority: p.priority,
      lastmod: new Date().toISOString().slice(0, 10)
    }))];

    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      // Join profile_slugs with profiles where user_type='pintor' AND active=true.
      const select = 'slug,updated_at,profiles!inner(user_type,active)';
      const url = `${env.SUPABASE_URL}/rest/v1/profile_slugs?select=${encodeURIComponent(select)}&profiles.user_type=eq.pintor&profiles.active=is.true&limit=10000`;
      const r = await fetch(url, {
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`
        }
      });
      if (r.ok) {
        const rows = await r.json();
        for (const row of rows) {
          if (!row?.slug) continue;
          urls.push({
            loc: `${SITE_ORIGIN}/p/${encodeURIComponent(row.slug)}`,
            changefreq: 'weekly',
            priority: '0.7',
            lastmod: row.updated_at ? String(row.updated_at).slice(0, 10) : undefined
          });
        }
      }
    }

    const xml = renderSitemap(urls);

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        ...CORS
      }
    });
  } catch (e) {
    return new Response(`<?xml version="1.0"?><error>${escapeXml(String(e?.message || e))}</error>`, {
      status: 500,
      headers: { 'Content-Type': 'application/xml; charset=utf-8', ...CORS }
    });
  }
}

function renderSitemap(urls) {
  const items = urls.map(u => {
    const parts = [`    <loc>${escapeXml(u.loc)}</loc>`];
    if (u.lastmod) parts.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`);
    if (u.changefreq) parts.push(`    <changefreq>${escapeXml(u.changefreq)}</changefreq>`);
    if (u.priority) parts.push(`    <priority>${escapeXml(u.priority)}</priority>`);
    return `  <url>\n${parts.join('\n')}\n  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
