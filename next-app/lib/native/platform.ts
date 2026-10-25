// platform.ts — detecção do runtime nativo (Capacitor) e acesso aos plugins.
//
// REGRA DA CASA: o app web NÃO importa pacotes @capacitor/* (fora o type do
// config). A casca Capacitor carrega o site de `server.url` e injeta o global
// `window.Capacitor` com os plugins registrados — acessamos por esse global,
// (mesmo padrão de todos os wrappers daqui). Isso mantém o bundle web livre de
// deps nativas e faz a MESMA página servir browser puro, PWA e qualquer
// versão da casca (plugin ausente = feature-detection falha = fallback web).
//
// Componentes NUNCA usam este arquivo direto — a fronteira pública é o
// `lib/native/index.ts` (objeto `native`). Se um dia a casca virar React
// Native/Expo, só este diretório muda; as 71 páginas ficam intactas.

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
}

function getCapacitor(): CapacitorRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorRuntime }).Capacitor;
}

/** true quando rodando dentro da casca nativa (Capacitor iOS/Android). */
export function isNativePlatform(): boolean {
  try {
    return getCapacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 'ios' | 'android' quando nativo; 'web' caso contrário. */
export function getNativePlatform(): 'ios' | 'android' | 'web' {
  if (!isNativePlatform()) return 'web';
  const p = getCapacitor()?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : 'web';
}

/**
 * Plugin nativo por nome (ex.: 'Browser', 'App', 'Camera', 'Share').
 * Retorna undefined fora da casca OU quando a casca instalada ainda não tem
 * esse plugin — o caller DEVE tratar undefined caindo pro comportamento web.
 * O generic é só conveniência de tipagem local; não há checagem em runtime.
 */
export function getPlugin<T>(name: string): T | undefined {
  try {
    const plugins = getCapacitor()?.Plugins;
    return plugins ? (plugins[name] as T | undefined) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Nomes dos plugins nativos VISÍVEIS pra esta página.
 *
 * Existe pra DIAGNÓSTICO, não pra lógica de feature (quem decide isso é o
 * `getPlugin` de cada wrapper). O runtime do iOS/Android injeta um script por
 * plugin registrado, então esta lista responde direto "o plugin X chegou
 * nesta casca?" — pergunta que já custou uma rejeição da Apple sendo
 * respondida por dedução em vez de por evidência.
 */
export function listNativePlugins(): string[] {
  try {
    const plugins = getCapacitor()?.Plugins;
    return plugins ? Object.keys(plugins).sort() : [];
  } catch {
    return [];
  }
}
