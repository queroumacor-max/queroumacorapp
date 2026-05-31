// utils.ts — port APENAS dos helpers puros de /utils.js.
// As funções DOM-bound (toast, showModal, closeModals, hideModal, fmtBRL com
// HTMLInputElement, _compressImageFile, _extractVideoFrame, setButtonLoading,
// emptyState, errorState, skeletonRows) NÃO foram portadas — viram React
// components/hooks numa camada superior. fmtBRL aqui tem signature diferente
// do vanilla: aceita number, devolve string formatada (a versão DOM-bound
// pode ser construída por cima dela em hooks).

// Helpers de formatação de R$ (pt-BR): aceita "500", "500,00", "1.500,00",
// "1500.50" no input e devolve Number normalizado.
export function parseBRL(val: unknown): number {
  const raw = String(val == null ? '' : val).trim();
  if (!raw) return 0;
  // Normaliza: tira pontos de milhar e usa ponto como decimal.
  const n = Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Refactor do vanilla: a versão antiga era `fmtBRL(el: HTMLInputElement)` que
// mutava `el.value`. Aqui é função pura `(number) => string` — a versão
// DOM-bound (que opera num <input>) vira hook/component separado.
export function fmtBRL(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str: unknown): string {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] || ch);
}

// Escapa um valor para uso DENTRO de uma string JS em atributo onclick="..."
// Mantido pra paridade — a maioria dos call sites do Next.js usa
// addEventListener / handlers JSX, mas alguns templates server-side ainda
// emitem HTML cru (ex.: e-mails, dashboards admin).
export function escapeJsArg(str: unknown): string {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/[<>]/g, '');
}

// Helper interno usado por getTimeAgo no fallback (>= 7 dias).
function dateBR(dateStr: string | Date): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function getTimeAgo(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'AGORA';
  if (mins < 60) return 'HA ' + mins + ' MIN';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return 'HA ' + hrs + ' HORA' + (hrs > 1 ? 'S' : '');
  const days = Math.floor(hrs / 24);
  if (days < 7) return 'HA ' + days + ' DIA' + (days > 1 ? 'S' : '');
  return dateBR(dateStr);
}

// Anonimiza email: substitui o domínio por @ (ex.: "a@b.co" → "@a").
export function stripEmail(s: string | null | undefined): string {
  if (!s) return s ?? '';
  return String(s).replace(/([A-Za-z0-9._%+\-]+)@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '@$1');
}

export function cleanHandle(
  p: { tag?: string | null; name?: string | null } | null | undefined,
  fb?: string
): string {
  if (p && p.tag) return '@' + p.tag;
  return stripEmail((p && p.name) || fb || 'Usuário');
}

export function isVideoUrl(u: string | null | undefined): boolean {
  return /\.(mp4|webm|mov|m4v|ogg|ogv)(\?|#|$)/i.test(u || '');
}

// Normaliza nome de cliente para dedup (lowercase + trim + colapsa espaços).
// Usado no CRM pra agrupar leads/clientes com mesmo nome em formatações
// diferentes ("João Silva", " joão silva ", "JOÃO SILVA").
export function crmNormName(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// Meses inteiros entre uma data e hoje (negativo nunca: clamp em 0).
export function crmMonthsSince(dateStr: string | Date | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) m -= 1;
  return Math.max(0, m);
}

// Hash string → uint determinístico (djb2-ish). Usado pra pintar avatares
// fallback (mapear nome → cor estável) e pra estabilizar ordenação em listas
// que precisam ser determinísticas sem ID (ex.: lista de comments sem id).
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Normaliza texto pra busca: remove acentos, lowercase, e adiciona espaços
// nas bordas pra suportar `indexOf(' joao ')` (match palavra inteira).
export function normTxt(s: unknown): string {
  return (
    ' ' +
    String(s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') +
    ' '
  );
}

// Renderiza rating como string de estrelas cheias + vazias (5 total).
// `r` pode vir como number ou string — clamp em 0..5 implícito via Math.round.
export function starStr(r: number | string | null | undefined): string {
  const n = Math.round(Number(r) || 0);
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
}

// Data em "YYYY-MM-DD" no fuso local. Usado em queries de agendamento e
// agenda do pintor pra evitar shift de fuso (ISO toISOString puro vira UTC).
export function agYmd(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Detecta tipo de arquivo (image vs video). Útil pra preview/feedback
// antes do upload. NOTA: opera sobre `File` (browser API) — em SSR
// nunca é chamado, mas o tipo está disponível via lib.dom.
export function getMediaType(file: File | null | undefined): 'video' | 'image' {
  if (!file) return 'image';
  if (file.type && file.type.startsWith('video/')) return 'video';
  const ext = file.name?.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
  return 'image';
}

// Throttle: chama fn no PRIMEIRO call + máximo 1x a cada `ms` enquanto receber
// calls. Diferente de debounce (espera pausa) — throttle garante rate fixo.
// Uso: scroll, resize, mousemove, autosave em input change.
export function throttle<F extends (...args: never[]) => unknown>(
  fn: F,
  ms: number
): (...args: Parameters<F>) => void {
  let last = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  return function throttled(this: unknown, ...args: Parameters<F>): void {
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed >= ms) {
      last = now;
      (fn as unknown as (...a: Parameters<F>) => unknown).apply(this, args);
    } else {
      // Garante trailing call pra capturar o último estado.
      if (trailing) clearTimeout(trailing);
      trailing = setTimeout(() => {
        last = Date.now();
        (fn as unknown as (...a: Parameters<F>) => unknown).apply(this, args);
      }, ms - elapsed);
    }
  };
}
