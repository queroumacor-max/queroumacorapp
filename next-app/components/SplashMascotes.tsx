'use client';
// SplashMascotes — a espera de boot com a turma da Cali Colors no lugar do
// "Carregando…" seco (pedido do usuário, 2026-09-02). Aparece na raiz (/)
// enquanto o auth decide o destino e no AppShell enquanto a sessão resolve —
// as duas telas que o app instalado mostra logo depois do splash do wrapper.
//
// Decisões:
//   - A arte é UMA imagem (/mascotes-calicolors-v2.webp, 968w ≈ 57KB) — os 4
//     mascotes (Alice, Seu Zé, Senna, Fê) com o logo. Animar a imagem
//     inteira (flutuação suave) custa só CSS; nada de rede além do arquivo,
//     que o browser cacheia depois do primeiro boot.
//   - Os nomes ("Alice • Seu Zé • Senna • Fê") são texto HTML aqui embaixo,
//     não parte do arquivo — a imagem original (gerada por IA) trazia essa
//     legenda JÁ desenhada, junto com um selo "AI-generated content" do
//     próprio gerador colado por cima. Recortamos o rodapé da arte (selo +
//     legenda) e recriamos só a legenda como texto de verdade: fica nítida
//     em qualquer densidade de tela e não carrega o selo pra produção.
//   - O NOME do arquivo é versionado (-v2) de propósito: o sw.js serve
//     imagem CACHE-FIRST, então trocar a arte mantendo a mesma URL deixa o
//     aparelho com a imagem velha pra sempre. Foi o que aconteceu no #383:
//     a arte antiga (com a legenda desenhada) seguia no cache e a legenda
//     em texto aparecia por cima dela. Trocou a arte → troque o nome.
//   - Primeira abertura da vida: a imagem pode chegar DEPOIS da tela. Por
//     isso os pontinhos de tinta + texto animam sozinhos desde o primeiro
//     frame — a tela nunca fica morta esperando a própria máscara.
//   - `prefers-reduced-motion`: tudo congela (só some a animação; a arte e
//     o texto ficam).
//   - Keyframes inline no componente (mesmo padrão do BottomSheet) — o
//     componente é autossuficiente, sem depender de bump no globals.css.

const CORES_TINTA = ['#2f6fd8', '#3fae4e', '#f07c22'];

export function SplashMascotes({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    // Full-bleed: a arte ocupa a largura inteira e o fundo da tela é um
    // gradiente na MESMA cor do fundo da arte (amostrado dos cantos:
    // #bbb09e em cima → #cbc2b1 embaixo) — a tela inteira vira o splash,
    // sem "foto pequena flutuando num fundo de outra cor". `dvh` porque é
    // altura de tela cheia (regra do projeto).
    <div
      className="splash-mascotes min-h-screen flex flex-col items-center justify-center gap-5 text-center"
      style={{
        minHeight: '100dvh',
        background: 'linear-gradient(180deg, #bbb09e 0%, #c3b9a8 55%, #cbc2b1 100%)',
      }}
    >
      <img
        src="/mascotes-calicolors-v2.webp"
        alt="Alice, Seu Zé, Senna e Fê"
        width={968}
        height={1066}
        decoding="async"
        className="w-full max-w-[560px] h-auto"
        style={{ animation: 'splashFloat 3.2s ease-in-out infinite' }}
      />
      <div
        className="font-bold"
        style={{ marginTop: -12, fontSize: 15, letterSpacing: '.01em', color: '#3f3729' }}
      >
        Alice • Seu Zé • Senna • Fê
      </div>
      <div className="flex items-center gap-2" aria-hidden="true">
        {CORES_TINTA.map((cor, i) => (
          <span
            key={cor}
            className="w-2.5 h-2.5 rounded-full inline-block"
            style={{
              background: cor,
              animation: `splashPingo 1.2s ease-in-out ${i * 0.18}s infinite`,
            }}
          />
        ))}
      </div>
      <div className="text-sm font-medium" style={{ color: '#57503f' }}>{texto}</div>
      <style>{`
        @keyframes splashFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes splashPingo {
          0%, 100% { transform: translateY(0); opacity: .55; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .splash-mascotes img, .splash-mascotes span { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
