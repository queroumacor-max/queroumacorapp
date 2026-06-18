// Página /info/disputas — Como Resolver Disputas.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Como Resolver Disputas | QueroUmaCor',
  description:
    'Passo a passo para resolver disputas entre clientes e profissionais no QueroUmaCor.',
};

const listStyle = {
  fontSize: 13.5,
  lineHeight: 1.7,
  color: 'var(--color-ink)',
  margin: '6px 0 10px',
  paddingLeft: 20,
} as const;

export default function DisputasPage() {
  return (
    <InfoSubPage title="Como Resolver Disputas">
      <LegalUpd>Última atualização: 17 de junho de 2026</LegalUpd>
      <LegalP>
        Quando surgir um problema entre cliente e profissional, siga as etapas
        abaixo para buscar a melhor solução.
      </LegalP>

      <LegalH>1. Resolução direta</LegalH>
      <LegalP>
        Recomendamos sempre tentar resolver diretamente com a outra parte, pelo
        chat da plataforma. A maioria dos problemas se resolve no diálogo.
      </LegalP>

      <LegalH>2. Mediação QueroUmaCor</LegalH>
      <LegalP>
        Se não houver acordo em <b>48 horas</b>, entre em contato pelo WhatsApp{' '}
        <b>(11) 95976-5031</b> ou pelo e-mail <b>loja@calicolors.com.br</b>,
        incluindo o número do orçamento, a descrição do problema e as
        evidências. Nossa equipe responde em até <b>3 dias úteis</b>.
      </LegalP>

      <LegalH>3. O que a mediação PODE fazer</LegalH>
      <ul style={listStyle}>
        <li>Contatar o profissional;</li>
        <li>Buscar um acordo entre as partes;</li>
        <li>Suspender o perfil quando houver evidências de fraude.</li>
      </ul>

      <LegalH>4. O que a mediação NÃO pode fazer</LegalH>
      <ul style={listStyle}>
        <li>
          Garantir reembolsos de pagamentos feitos diretamente entre as partes;
        </li>
        <li>Obrigar o profissional a refazer o serviço;</li>
        <li>Substituir um processo judicial.</li>
      </ul>

      <LegalH>5. Instâncias externas</LegalH>
      <LegalP>
        Caso a disputa não seja resolvida, você pode recorrer a:
      </LegalP>
      <ul style={listStyle}>
        <li>O Procon do seu estado;</li>
        <li>
          O portal <b>consumidor.gov.br</b>;
        </li>
        <li>
          Os Juizados Especiais Cíveis, para causas de até{' '}
          <b>20 salários mínimos</b> sem necessidade de advogado.
        </li>
      </ul>
    </InfoSubPage>
  );
}
