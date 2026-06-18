// Página /info/termos-profissional — Termos de Uso específicos do Profissional.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Termos de Uso - Profissional | QueroUmaCor',
  description:
    'Termos de uso específicos para profissionais do QueroUmaCor.',
};

export default function TermosProfissionalPage() {
  return (
    <InfoSubPage title="Termos de Uso - Profissional">
      <LegalUpd>Última atualização: 17 de junho de 2026</LegalUpd>
      <LegalP>
        Estes Termos complementam os{' '}
        <a
          href="/info/termos"
          style={{ color: 'var(--color-p1)', fontWeight: 600 }}
        >
          Termos de Uso gerais
        </a>{' '}
        e aplicam-se especificamente aos profissionais que oferecem serviços na
        plataforma QueroUmaCor.
      </LegalP>

      <LegalH>1. Responsabilidade pela prestação do serviço</LegalH>
      <LegalP>
        O profissional é o único responsável pela execução, qualidade e prazo
        dos serviços contratados. O QueroUmaCor é apenas intermediador e não é
        parte no contrato firmado entre profissional e cliente.
      </LegalP>

      <LegalH>2. Obrigações fiscais</LegalH>
      <LegalP>
        A emissão de nota fiscal é responsabilidade exclusiva do profissional. O
        QueroUmaCor não emite documentos fiscais em nome do profissional. O
        profissional é o único responsável pelos tributos incidentes sobre os
        serviços prestados.
      </LegalP>

      <LegalH>3. Garantia</LegalH>
      <LegalP>
        O profissional oferece garantia mínima de <b>90 dias</b> para defeitos
        de execução, conforme o Código de Defesa do Consumidor.
      </LegalP>

      <LegalH>4. Danos a terceiros</LegalH>
      <LegalP>
        O profissional é inteiramente responsável por danos causados ao cliente,
        ao imóvel ou a terceiros durante a prestação dos serviços.
      </LegalP>

      <LegalH>5. Orçamentos e cancelamentos</LegalH>
      <LegalP>
        Orçamentos aceitos e posteriormente cancelados sem justificativa podem
        resultar em avaliação negativa e em penalidades na plataforma.
      </LegalP>

      <LegalH>6. Conduta</LegalH>
      <LegalP>
        Comunicações abusivas, discriminatórias ou fraudulentas resultam em
        suspensão imediata da conta.
      </LegalP>

      <LegalH>7. Uso dos dados de contato</LegalH>
      <LegalP>
        É proibido usar dados de contato obtidos por meio da plataforma para
        oferecer serviços fora dela.
      </LegalP>
    </InfoSubPage>
  );
}
