// app/api/whatsapp-evo/followup/route.ts — ALIAS da rota atual.
//
// A varredura de follow-up mudou de endereço pra `/api/whatsapp/followup`:
// o prefixo `whatsapp-evo` é do tempo da Evolution API, aposentada em
// 2026-09-05. Este arquivo fica no ar delegando pra lá porque
// `app_settings.whatsapp_followup_url` (lido pelo pg_cron) ainda pode estar
// apontando pra este caminho — apagar a rota antes de trocar a configuração
// deixaria o follow-up sem chamador nenhum.
//
// Pode ser removido depois que o SQL de `/migrations/
// 2026-09-05-followup-url.sql` tiver rodado e a varredura estiver saindo
// pelo endereço novo.

// `runtime` PRECISA ser declarado literalmente: o Next nao reconhece o
// campo quando ele e re-exportado de outro arquivo (o build avisa e usa o
// default) — e precisa bater com o da rota original
// (app/api/whatsapp/followup/route.ts): nodejs, não mais edge
// (@opennextjs/cloudflare só suporta nodejs; ver ADR 0006).
export const runtime = 'nodejs';
export { POST } from '@/app/api/whatsapp/followup/route';
