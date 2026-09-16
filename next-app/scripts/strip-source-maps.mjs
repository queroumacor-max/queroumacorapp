#!/usr/bin/env node
// Auditoria de segurança Cloudflare (2026-09-13): o @sentry/nextjs só apaga
// os `.map` do bundle publicado DEPOIS de fazer upload pra Sentry — e o
// upload só roda com `SENTRY_AUTH_TOKEN` presente no ambiente de build.
// Sem o token (confirmado: `.github/workflows/deploy.yml` não o passa; o
// deploy real é pelo Git integration nativo do Cloudflare Pages, cuja env
// não é visível deste repo), o webpack plugin pula o upload e os `.map`
// ficam FISICAMENTE no artefato — mesmo com `hideSourceMaps: true` só
// tirando o comentário `//# sourceMappingURL=` do .js. Qualquer um pode
// baixar `https://queroumacor.com.br/_next/static/chunks/<hash>.js.map`
// direto e reconstruir o código-fonte legível do app inteiro.
//
// Este script roda DEPOIS do `next-on-pages` (que já copiou tudo de
// `.next` pra `.vercel/output/static`) e apaga todo `.map` do artefato que
// vai pro Cloudflare Pages — independente de o upload do Sentry ter
// acontecido ou não. Não afeta a symbolication no Sentry: o upload (quando
// o token existe) já rodou durante o `next build`, antes deste script.
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = join(process.cwd(), '.vercel', 'output', 'static');

function walkAndStrip(dir) {
  let removed = 0;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return removed;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      removed += walkAndStrip(full);
    } else if (entry.endsWith('.map')) {
      unlinkSync(full);
      removed += 1;
    }
  }
  return removed;
}

const removed = walkAndStrip(OUTPUT_DIR);
console.log(
  `[strip-source-maps] ${removed} arquivo(s) .map removido(s) de ${OUTPUT_DIR} antes do deploy.`
);
