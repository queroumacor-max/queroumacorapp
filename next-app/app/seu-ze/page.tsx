// Página /seu-ze — Server Component shell.
// Equivalente ao modal `#ai-chat-modal` do vanilla (openAiChat em
// modules/ai-chat.js). Aqui é tela dedicada em vez de modal — mesmo padrão
// de /agenda, /pedidos, /leads (RSC monta layout estático; client component
// hidrata o conteúdo dinâmico).
//
// Gating PRO: a checagem visual fica no SeuZeChat (client component) usando
// `useAuth()` + `canSeeProFeature`. A camada server-side dos endpoints
// (chat-ai, transcribe, tts) já valida PRO via gateProAI — então mesmo se a
// UI vazasse, o backend rejeita.

import type { Metadata } from 'next';
import { SeuZeChat } from './SeuZeChat';

export const metadata: Metadata = {
  title: 'Seu Zé | QueroUmaCor',
  description:
    'Assistente IA para pintores — tire dúvidas, pergunte sobre preço, técnicas, materiais e ferramentas. Chat por texto ou voz.',
};

export default function SeuZePage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto pb-24">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Seu Zé
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Seu mestre de obras de bolso. Pergunte sobre tinta, preço, técnica,
        material — texto ou voz.
      </p>
      <SeuZeChat />
    </main>
  );
}
