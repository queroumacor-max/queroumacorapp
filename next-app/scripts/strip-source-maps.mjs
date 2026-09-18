#!/usr/bin/env node
// Auditoria de segurança Cloudflare (2026-09-13): o @sentry/nextjs pode
// gerar `.map` do bundle CLIENTE e só apagar depois de um upload
// bem-sucedido pra Sentry — e o upload só roda com `SENTRY_AUTH_TOKEN`
// presente no ambiente de build. Sem o token (confirmado:
// `.github/workflows/deploy.yml` não o passa; o deploy real é pelo Git
// integration nativo do Cloudflare Pages, cuja env não é visível deste
// repo), o upload não acontece e os `.map` podem ficar FISICAMENTE no
// artefato publicado — mesmo com `hideSourceMaps: true` só tirando o
// comentário `//# sourceMappingURL=` do .js. Qualquer um poderia baixar
// `https://queroumacor.com.br/_next/static/chunks/<hash>.js.map` direto e
// reconstruir o código-fonte legível do app inteiro. Este script roda
// DEPOIS do build do adapter e apaga todo `.map` do artefato publicável,
// como última linha de defesa — independente de o upload do Sentry ter
// acontecido, sido pulado, ou de a versão/config do SDK mudar de novo o
// que ele gera.
//
// Migração @cloudflare/next-on-pages → @opennextjs/cloudflare (2026-09-18,
// branch de avaliação): o artefato publicável mudou de path —
// `next-on-pages` copiava tudo de `.next` pra `.vercel/output/static`;
// `opennextjs-cloudflare build` gera em `.open-next/assets`. Achado nesta
// migração: rodar este script sem atualizar o path fazia ele reportar
// "0 arquivo(s) .map removido(s)" **em silêncio, sem erro** — olhando pra
// um diretório (`.vercel/output/static`) que nem existe mais sob o adapter
// novo. `readdirSync` num path ausente cai no `catch` de `walkAndStrip`,
// que devolve 0 sem distinguir "diretório vazio de verdade" de "diretório
// errado". Dois fixes: (1) o path abaixo segue o adapter atual; (2) o
// script agora CONFERE que `OUTPUT_DIR` existe ANTES de varrer — se não
// existir, sai com erro em vez de reportar sucesso silencioso, porque essa
// é exatamente a classe de falha que já aconteceu aqui uma vez.
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = join(process.cwd(), '.open-next', 'assets');

if (!existsSync(OUTPUT_DIR)) {
  console.error(
    `[strip-source-maps] ERRO: diretório de saída não existe: ${OUTPUT_DIR}. ` +
      `O build do adapter (opennextjs-cloudflare build) rodou antes deste ` +
      `script? Ou o path de saída mudou de novo? Não seguir em frente ` +
      `reportando "0 removidos" como se estivesse tudo bem — essa foi ` +
      `exatamente a falha silenciosa que este arquivo já teve uma vez.`
  );
  process.exitCode = 1;
} else {
  const removed = walkAndStrip(OUTPUT_DIR);
  console.log(
    `[strip-source-maps] ${removed} arquivo(s) .map removido(s) de ${OUTPUT_DIR} antes do deploy.`
  );
}

function walkAndStrip(dir) {
  let removed = 0;
  const entries = readdirSync(dir);
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
