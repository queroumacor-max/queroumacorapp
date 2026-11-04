// galeria.ts — escolher fotos/vídeo pelo plugin NATIVO próprio `GaleriaSegura`
// (android/app/src/main/java/br/com/queroumacor/app/GaleriaSeguraPlugin.java).
//
// Motivo (2026-11-04): no Android, abrir a galeria pelo <input type=file> manda
// o app pro fundo e o sistema pode MATAR o processo. O resultado volta pra um
// callback que morreu junto, e a pessoa recebia "o app fechou e a foto se
// perdeu". O plugin entrega o resultado mesmo numa activity recriada, copia os
// arquivos pro cache do app e guarda a lista; a página nova pega com
// `recuperarGaleria()`.
//
// Plugin ausente (navegador, iPhone, AAB antigo) = 'unavailable' e o chamador
// segue com o <input> de sempre.

import { getNativePlatform, getPlugin } from './platform';

interface ItemNativo {
  url?: string;
  path?: string;
  mimeType?: string;
  name?: string;
  size?: number;
}

interface GaleriaSeguraPlugin {
  escolher: (o: { limite: number; video: boolean }) => Promise<{ itens?: ItemNativo[] }>;
  recuperar: () => Promise<{ itens?: ItemNativo[] }>;
  confirmar: () => Promise<void>;
}

export type GaleriaResult =
  | { status: 'ok'; files: File[] }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

function plugin(): GaleriaSeguraPlugin | undefined {
  if (getNativePlatform() !== 'android') return undefined;
  const p = getPlugin<GaleriaSeguraPlugin>('GaleriaSegura');
  return p && typeof p.escolher === 'function' ? p : undefined;
}

export function isGaleriaNativaDisponivel(): boolean {
  return !!plugin();
}

/** Converte o que o plugin devolveu em File (lendo pela ponte local). */
export async function itensParaFiles(itens: ItemNativo[] | undefined): Promise<File[]> {
  const files: File[] = [];
  for (const it of itens ?? []) {
    if (!it.url) continue;
    const blob = await fetch(it.url).then((r) => {
      if (!r.ok) throw new Error(`não consegui ler o arquivo escolhido (${r.status})`);
      return r.blob();
    });
    const tipo = it.mimeType && it.mimeType !== 'application/octet-stream' ? it.mimeType : blob.type;
    files.push(new File([blob], it.name || 'arquivo', { type: tipo || '' }));
  }
  return files;
}

export async function escolherDaGaleria(limite = 5, video = true): Promise<GaleriaResult> {
  const p = plugin();
  if (!p) return { status: 'unavailable' };
  try {
    const res = await p.escolher({ limite, video });
    const files = await itensParaFiles(res.itens);
    // Chegou ao vivo: o boot seguinte não deve "recuperar" de novo.
    p.confirmar().catch(() => {});
    return files.length ? { status: 'ok', files } : { status: 'cancelled' };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === 'CANCELLED') return { status: 'cancelled' };
    if (err?.code === 'UNAVAILABLE') return { status: 'unavailable' };
    return { status: 'error', message: err?.message || String(e) };
  }
}

/** Fotos escolhidas numa página que o Android matou. Lê e apaga. */
export async function recuperarGaleria(): Promise<File[]> {
  const p = plugin();
  if (!p || typeof p.recuperar !== 'function') return [];
  try {
    const res = await p.recuperar();
    return await itensParaFiles(res.itens);
  } catch {
    return [];
  }
}
