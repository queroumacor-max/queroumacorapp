// Página /info/antifraude — Política Anti-Fraude e Uso Aceitável.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Política Anti-Fraude e Uso Aceitável | QueroUmaCor',
  description:
    'Regras contra fraude e uso aceitável da plataforma QueroUmaCor.',
};

const listStyle = {
  fontSize: 13.5,
  lineHeight: 1.7,
  color: 'var(--color-ink)',
  margin: '6px 0 10px',
  paddingLeft: 20,
} as const;

export default function AntifraudePage() {
  return (
    <InfoSubPage title="Política Anti-Fraude e Uso Aceitável">
      <LegalUpd>Última atualização: 17 de junho de 2026</LegalUpd>
      <LegalP>
        Esta política define condutas proibidas e o uso aceitável do
        QueroUmaCor. O descumprimento pode resultar em medidas que vão do aviso
        formal ao banimento permanente, conforme detalhado abaixo.
      </LegalP>

      <LegalH>1. Perfis</LegalH>
      <LegalP>É proibido:</LegalP>
      <ul style={listStyle}>
        <li>Criar perfis falsos ou se passar por outra pessoa;</li>
        <li>Usar fotos de terceiros sem autorização;</li>
        <li>Falsificar qualificações, formação ou experiência;</li>
        <li>
          Manter múltiplas contas para burlar suspensões ou banimentos.
        </li>
      </ul>

      <LegalH>2. Avaliações</LegalH>
      <LegalP>É proibido:</LegalP>
      <ul style={listStyle}>
        <li>Publicar avaliações falsas, compradas ou combinadas;</li>
        <li>Realizar autoavaliação;</li>
        <li>Pressionar clientes a deixarem uma avaliação;</li>
        <li>Oferecer vantagens em troca de avaliações positivas.</li>
      </ul>

      <LegalH>3. Orçamentos</LegalH>
      <LegalP>É proibido:</LegalP>
      <ul style={listStyle}>
        <li>Apresentar orçamentos fraudulentos;</li>
        <li>Combinar pagamentos fora da plataforma para burlar regras;</li>
        <li>Formar cartel ou combinar preços com outros profissionais;</li>
        <li>Abandonar o serviço após o recebimento do pagamento.</li>
      </ul>

      <LegalH>4. Segurança</LegalH>
      <LegalP>É proibido:</LegalP>
      <ul style={listStyle}>
        <li>Acessar contas ou sistemas sem autorização;</li>
        <li>Realizar scraping ou coleta automatizada de dados;</li>
        <li>Distribuir malware ou praticar phishing;</li>
        <li>Praticar roubo de identidade.</li>
      </ul>

      <LegalH>5. Denúncias</LegalH>
      <LegalP>
        Suspeitas de fraude podem ser denunciadas pelo botão{' '}
        <b>Reportar</b> disponível no app ou pelo e-mail{' '}
        <b>loja@calicolors.com.br</b>. Investigamos cada denúncia em até{' '}
        <b>72 horas</b>.
      </LegalP>

      <LegalH>6. Consequências</LegalH>
      <LegalP>
        Conforme a gravidade e a reincidência, as medidas podem incluir:
      </LegalP>
      <ul style={listStyle}>
        <li>Aviso formal;</li>
        <li>Suspensão temporária da conta;</li>
        <li>Remoção de conteúdo;</li>
        <li>Banimento permanente;</li>
        <li>Comunicação às autoridades competentes.</li>
      </ul>
    </InfoSubPage>
  );
}
