// Sitemap dinâmico via Next.js Metadata API — serve /sitemap.xml.
// Produção retornava 404 (o sitemap submetido no Google Search Console
// apontava pra um arquivo que não existia). Conteúdo estático → Next
// pré-renderiza no build e o next-on-pages serve como asset (sem edge
// runtime necessário).
//
// Só entram URLs realmente alcançáveis sem login. /feed, /loja e /explore
// são indexáveis (robots index:true) e ficam aqui como landing pages, mas
// hoje o AppShell redireciona anônimos pro /login. Perfis individuais
// (/perfil/[id]) ficam DE FORA de propósito: são milhares de URLs atrás
// do guard de login — listar tudo só geraria soft-404 no Search Console.
// Se o modo visitante voltar, gerar as URLs de perfil aqui via Supabase
// (aí sim com `export const runtime = 'edge'`).

import type { MetadataRoute } from 'next';

const BASE_URL = 'https://www.queroumacor.com.br';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const entry = (
    path: string,
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
    priority: number,
  ) => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    // Núcleo
    entry('/', 'weekly', 1),
    entry('/feed', 'daily', 0.9),
    entry('/loja', 'daily', 0.9),
    entry('/explore', 'daily', 0.8),

    // Entrada / cadastro (públicas)
    entry('/login', 'monthly', 0.5),
    entry('/signup', 'monthly', 0.6),
    // Pedido de pintor sem login (2026-11-10) — a porta de entrada do cliente.
    entry('/pedir', 'weekly', 0.9),

    // Institucional / legal (públicas)
    entry('/info', 'monthly', 0.5),
    entry('/privacidade', 'yearly', 0.3),
    entry('/termos', 'yearly', 0.3),
    entry('/info/ajuda', 'monthly', 0.4),
    entry('/info/sobre', 'yearly', 0.3),
    entry('/info/privacidade', 'yearly', 0.3),
    entry('/info/termos', 'yearly', 0.3),
    entry('/info/termos-cliente', 'yearly', 0.3),
    entry('/info/termos-profissional', 'yearly', 0.3),
    entry('/info/antifraude', 'yearly', 0.3),
    entry('/info/copyright', 'yearly', 0.3),
    entry('/info/disputas', 'yearly', 0.3),
    entry('/delete-account', 'yearly', 0.2),
  ];
}
