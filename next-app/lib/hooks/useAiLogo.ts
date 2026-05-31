// useAiLogo — hook React que orquestra a feature "Gerador de Logo IA".
// Substitui o trio vanilla (modules/ai-logo.js: gerarLogoIA + selectAiLogo +
// usarLogoIA) por um state management declarativo:
//   - useQuery faz fetch do logo salvo no perfil (display inicial);
//   - useMutation cobre generate, save, upload com invalidação automática;
//   - state local pra `variants` (lista de URLs geradas) e `selectedIndex`
//     porque essas não persistem no banco — vivem só durante a sessão do form.
//
// Lógica de "1ª grátis vs 2ª paga" (R$ 1,99):
//   - Vanilla: contador atômico via RPC bump_ai_logo_count + UPDATE em
//     profiles.ai_logo_gen_count. Aqui o PoC só conta no state local
//     (`genCount`) e expõe `isFirstFree` derivado pro caller decidir UX.
//   - Cobrança real fica pro futuro (gateway de pagamento). Aqui log + toast.
//   - Gate de PRO + rate limit já é server-side (gateProAI em /api/generate-logo),
//     então mesmo que o cliente burlasse `isFirstFree`, o backend responde 403/429.

'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  fetchLogo,
  generateLogos,
  saveLogo,
  uploadLogo,
  type GenerateLogoInput,
} from '@/lib/services/aiLogo';

// Preço da 2ª+ geração em BRL. Bate com AI_LOGO_REGEN_PRICE_BRL do vanilla
// (modules/ai-logo.js linha 66). Mantemos exportado pra UI mostrar no botão.
export const AI_LOGO_REGEN_PRICE_BRL = 1.99;

// Tipo INLINE — shape de retorno do hook. Mantemos paralelo a useState/
// useMutation pra que o caller faça destructuring direto sem rename.
export interface UseAiLogoResult {
  // URL do logo atualmente salvo no perfil (display inicial / preview pós-save).
  savedLogo: string | null;
  // Lista de variants geradas pela última chamada de generate. Vazia até
  // o usuário gerar pela primeira vez na sessão.
  variants: string[];
  // Índice do variant atualmente selecionado (0..variants.length-1) ou null.
  selectedIndex: number | null;
  // True na 1ª geração da sessão (grátis). False da 2ª em diante (paga).
  isFirstFree: boolean;
  // Quantidade de gerações executadas nesta sessão. Só state local;
  // banco persiste o real via ai_logo_gen_count (não tocamos aqui).
  genCount: number;
  // Loading da query do logo salvo.
  loadingSaved: boolean;
  // Gera variants via /api/generate-logo. Atualiza `variants` + `selectedIndex=0`.
  generate: (input: GenerateLogoInput) => Promise<string[]>;
  isGenerating: boolean;
  generateError: Error | null;
  // Seleciona um variant da lista atual.
  select: (index: number) => void;
  // Persiste a URL do variant selecionado em profiles.business_logo_url.
  save: (logoUrl?: string) => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  // Upload manual de logo customizado (não-IA).
  upload: (file: File) => Promise<string>;
  isUploading: boolean;
  uploadError: Error | null;
}

export function useAiLogo(): UseAiLogoResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // State local: variants + seleção. Não vão pro cache do TanStack porque
  // são puramente UI state (sem fetching, sem persistência).
  const [variants, setVariants] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [genCount, setGenCount] = useState(0);

  // Logo salvo no perfil — query separada pra reusar o cache global do TanStack
  // (se outra parte do app (Header, perfil) também precisa do logo, hits o
  // mesmo cache). staleTime 5min porque logo muda pouco.
  const savedQuery = useQuery<string | null, Error>({
    queryKey: ['business-logo', user?.id],
    queryFn: () => fetchLogo(user!.id),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const generateMutation = useMutation<string[], Error, GenerateLogoInput>({
    mutationFn: (input) => generateLogos(input),
    onSuccess: (urls) => {
      setVariants(urls);
      setSelectedIndex(urls.length > 0 ? 0 : null);
      // Conta IMEDIATAMENTE no client pra UI atualizar o botão "Gerar
      // novamente · R$ 1,99". Backend tem seu próprio contador (gateProAI
      // rate limit), então o state local só é hint visual.
      setGenCount((c) => c + 1);
    },
  });

  const saveMutation = useMutation<void, Error, string>({
    mutationFn: async (logoUrl: string) => {
      if (!user) throw new Error('Usuário não autenticado');
      await saveLogo(user.id, logoUrl);
    },
    onSuccess: () => {
      // Invalida o cache do savedLogo pra refetchar o valor canônico do banco.
      qc.invalidateQueries({ queryKey: ['business-logo', user?.id] });
    },
  });

  const uploadMutation = useMutation<string, Error, File>({
    mutationFn: async (file: File) => {
      if (!user) throw new Error('Usuário não autenticado');
      return uploadLogo(user.id, file);
    },
    onSuccess: () => {
      // uploadLogo já salva em profiles.business_logo_url internamente.
      qc.invalidateQueries({ queryKey: ['business-logo', user?.id] });
    },
  });

  const select = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  // save aceita logoUrl explícito ou usa o variant selecionado. Útil quando
  // o caller já tem a URL em mãos (ex.: drag-and-drop futuro). Throw se
  // nenhum dos dois caminhos resolve uma URL.
  const save = useCallback(
    async (logoUrl?: string): Promise<void> => {
      const url =
        logoUrl ??
        (selectedIndex !== null ? variants[selectedIndex] : undefined);
      if (!url) {
        throw new Error('Selecione um logo antes de salvar');
      }
      await saveMutation.mutateAsync(url);
    },
    [selectedIndex, variants, saveMutation],
  );

  return {
    savedLogo: savedQuery.data ?? null,
    variants,
    selectedIndex,
    isFirstFree: genCount === 0,
    genCount,
    loadingSaved: savedQuery.isLoading,
    generate: generateMutation.mutateAsync,
    isGenerating: generateMutation.isPending,
    generateError: generateMutation.error ?? null,
    select,
    save,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error ?? null,
    upload: uploadMutation.mutateAsync,
    isUploading: uploadMutation.isPending,
    uploadError: uploadMutation.error ?? null,
  };
}
