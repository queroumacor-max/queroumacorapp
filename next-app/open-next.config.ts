// open-next.config.ts — avaliação de migração @cloudflare/next-on-pages →
// @opennextjs/cloudflare (branch isolada claude/next16-opennext-eval,
// build local, sem deploy). Config default do adapter, sem cache R2 (a
// tabela/rota do projeto não usa ISR/on-demand revalidation hoje — se
// migrar de verdade, revisitar caching: https://opennext.js.org/cloudflare/caching).
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({});
