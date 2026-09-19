// open-next.config.ts — config default do adapter, sem cache R2 (o
// projeto não usa ISR/on-demand revalidation hoje — a maioria das rotas
// dinâmicas é server-rendered on demand, sem `revalidate`. Se migrar de
// verdade, revisitar caching: https://opennext.js.org/cloudflare/caching).
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({});
