// VoiceRecorder — botão UI pra gravar voz. Wrap fino em volta do
// useVoiceRecorder via props injetadas pelo SeuZeChat (que orquestra o
// fluxo completo: gravar → transcribe → mandar como msg).
//
// Comportamento visual:
//   - Idle: ícone 🎤 com fundo gradiente roxo (mesma cor da marca PRO)
//   - Recording: ícone ⏹ com fundo vermelho + animação de pulso
//   - Transcribing: spinner + "Transcrevendo..."
//
// Acessibilidade: aria-label muda conforme estado, role=button explícito.

'use client';

export interface VoiceRecorderProps {
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  error: string | null;
  onToggle: () => void;
}

export function VoiceRecorder({
  isRecording,
  isTranscribing,
  isSupported,
  error,
  onToggle,
}: VoiceRecorderProps) {
  if (!isSupported) {
    // Esconde silenciosamente. O usuário em desktop sem mic não precisa ver
    // botão "não suportado" — mantém UI limpa.
    return null;
  }

  const busy = isTranscribing;
  // Label persona-agnóstico e explícito que é gravação de voz (BUG42). Antes
  // o idle era "Falar com o Seu Zé" — errado na tela da Alice e confundível
  // com um botão de navegação. O estado gravando já avisa que vai enviar ao
  // parar ("Parar e enviar" = pausa intencional do usuário).
  const label = isTranscribing
    ? 'Transcrevendo…'
    : isRecording
      ? 'Parar gravação e enviar mensagem'
      : 'Gravar mensagem de voz';

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={label}
        title={label}
        className={
          'w-11 h-11 rounded-full flex items-center justify-center text-white text-lg transition-all disabled:opacity-60 ' +
          (isRecording
            ? 'bg-red-600 animate-pulse'
            : 'bg-gradient-to-br from-purple-600 to-[color:var(--color-p1)]')
        }
      >
        {isTranscribing ? '…' : isRecording ? '⏹' : '🎤'}
      </button>
      {error ? (
        <p className="text-xs text-red-700 mt-1" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
