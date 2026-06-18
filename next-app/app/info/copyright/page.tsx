// Página /info/copyright — Política de Direitos Autorais.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Política de Direitos Autorais | QueroUmaCor',
  description:
    'Política de direitos autorais, canal DMCA e uso da marca QueroUmaCor.',
};

const listStyle = {
  fontSize: 13.5,
  lineHeight: 1.7,
  color: 'var(--color-ink)',
  margin: '6px 0 10px',
  paddingLeft: 20,
} as const;

export default function CopyrightPage() {
  return (
    <InfoSubPage title="Política de Direitos Autorais">
      <LegalUpd>Última atualização: 17 de junho de 2026</LegalUpd>
      <LegalP>
        Esta política trata da titularidade do conteúdo publicado no
        QueroUmaCor e do procedimento para notificações de violação de direitos
        autorais.
      </LegalP>

      <LegalH>1. Titularidade do conteúdo publicado</LegalH>
      <LegalP>
        Ao publicar qualquer conteúdo (fotos, textos, vídeos, artes), o usuário
        declara ser o titular dos direitos autorais ou possuir autorização
        expressa do titular para utilizá-lo na plataforma.
      </LegalP>

      <LegalH>2. Conteúdo gerado com inteligência artificial</LegalH>
      <LegalP>
        O conteúdo criado com recursos de IA está sujeito às políticas dos
        provedores <b>OpenAI</b> e <b>Google</b>. Verifique essas políticas
        antes de usar o conteúdo gerado para fins comerciais.
      </LegalP>

      <LegalH>3. Canal DMCA / Lei 9.610/98</LegalH>
      <LegalP>
        Para notificar uma violação de direitos autorais, envie um e-mail para{' '}
        <b>loja@calicolors.com.br</b> contendo:
      </LegalP>
      <ul style={listStyle}>
        <li>A identificação da obra original;</li>
        <li>A URL ou localização do conteúdo no app;</li>
        <li>Uma declaração de titularidade dos direitos;</li>
        <li>Seus dados de contato.</li>
      </ul>

      <LegalH>4. Prazo de resposta e remoção</LegalH>
      <LegalP>
        Respondemos às notificações em até <b>5 dias úteis</b>. O conteúdo será
        removido caso a violação seja confirmada.
      </LegalP>

      <LegalH>5. Contestação</LegalH>
      <LegalP>
        O usuário cujo conteúdo foi removido pode apresentar contestação em até{' '}
        <b>10 dias úteis</b>, pelo mesmo canal (<b>loja@calicolors.com.br</b>),
        com a comprovação de titularidade dos direitos.
      </LegalP>

      <LegalH>6. Marca QueroUmaCor</LegalH>
      <LegalP>
        A marca <b>QueroUmaCor</b> é propriedade da{' '}
        <b>CALICOLORS TINTAS LTDA</b>. O uso não autorizado da marca será
        tratado juridicamente.
      </LegalP>
    </InfoSubPage>
  );
}
