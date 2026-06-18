// Página /info/termos — Termos de Uso. Conteúdo idêntico ao vanilla
// index.html linha 1216-1244.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Termos de Uso | QueroUmaCor',
  description:
    'Regras de uso da plataforma e responsabilidades das partes.',
};

export default function TermosPage() {
  return (
    <InfoSubPage title="Termos de Uso">
      <LegalUpd>Última atualização: 18 de junho de 2026</LegalUpd>

      <LegalH>1. Aceitação dos termos</LegalH>
      <LegalP>
        Ao criar uma conta e usar o QueroUmaCor, você concorda com estes Termos
        de Uso. Se não concordar, não utilize o aplicativo.
      </LegalP>

      <LegalH>2. O que é o QueroUmaCor</LegalH>
      <LegalP>
        O QueroUmaCor é uma plataforma de intermediação que conecta clientes a
        profissionais de pintura. O QueroUmaCor não presta serviços de pintura
        e não é parte nos contratos firmados entre os usuários.
      </LegalP>
      <LegalP>
        Operadora: <b>CALICOLORS TINTAS LTDA</b>, CNPJ <b>47.677.346/0001-92</b>,
        com sede na <b>
          Est. Presidente Juscelino Kubitschek de Oliveira, 1071 – Jardim
          dos Pimentas, Guarulhos/SP – CEP 07.272-345
        </b>. Contato: <b>loja@calicolors.com.br</b>.
      </LegalP>

      <LegalH>3. Cadastro e conta</LegalH>
      <LegalP>
        Você deve fornecer informações verdadeiras e mantê-las atualizadas. A
        conta é pessoal e intransferível, e o cadastro é feito por convite.
        Você é responsável por manter a sua senha em sigilo. O uso é destinado
        a maiores de 18 anos.
      </LegalP>

      <LegalH>4. Regras de uso</LegalH>
      <LegalP>
        Você concorda em não publicar conteúdo falso, ofensivo, discriminatório
        ou ilegal; não violar direitos de terceiros; não usar a plataforma para
        spam; e não tentar burlar a segurança do app.
      </LegalP>

      <LegalH>5. Conteúdo do usuário</LegalH>
      <LegalP>
        Você é responsável pelo conteúdo que publica, como fotos de portfólio e
        descrições. Você declara ter os direitos sobre esse conteúdo e concede
        ao QueroUmaCor uma licença para exibi-lo dentro do aplicativo.
      </LegalP>

      <LegalH>6. Orçamentos e contratações</LegalH>
      <LegalP>
        As negociações, valores, prazos e a execução dos serviços são de
        responsabilidade exclusiva entre o cliente e o profissional. O
        QueroUmaCor não garante a contratação, a qualidade do serviço nem o
        pagamento.
      </LegalP>

      <LegalH>7. Avaliações</LegalH>
      <LegalP>
        As avaliações devem ser honestas e baseadas em experiências reais.
        Avaliações falsas ou abusivas podem ser removidas.
      </LegalP>

      <LegalH>8. Propriedade intelectual</LegalH>
      <LegalP>
        A marca, o logotipo e o software do QueroUmaCor pertencem ao QueroUmaCor
        e não podem ser usados sem autorização.
      </LegalP>

      <LegalH>9. Limitação de responsabilidade</LegalH>
      <LegalP>
        O aplicativo é fornecido &quot;como está&quot;. Não nos responsabilizamos por
        danos decorrentes de negociações entre usuários ou por eventual
        indisponibilidade temporária do serviço.
      </LegalP>

      <LegalH>10. Suspensão e encerramento</LegalH>
      <LegalP>
        Podemos suspender ou encerrar contas que violem estes termos ou a
        legislação aplicável.
      </LegalP>

      <LegalH>11. Alterações dos termos</LegalH>
      <LegalP>
        Estes termos podem ser atualizados. Mudanças relevantes serão
        comunicadas no aplicativo.
      </LegalP>

      <LegalH>12. Lei aplicável e foro</LegalH>
      <LegalP>
        Estes termos são regidos pelas leis brasileiras. Fica eleito o foro do
        domicílio do consumidor para dirimir eventuais conflitos.
      </LegalP>

      <LegalH>13. Plano PRO e Cancelamento</LegalH>
      <LegalP>
        O Plano PRO é uma assinatura paga e recorrente, renovada
        automaticamente ao fim de cada ciclo de cobrança até que você cancele.
        O valor e a periodicidade vigentes são exibidos na tela de assinatura
        antes da contratação.
      </LegalP>
      <LegalP>
        Você pode cancelar a assinatura a qualquer momento. O cancelamento
        passa a ter efeito ao <b>fim do ciclo de cobrança já pago</b> — você
        mantém o acesso aos recursos PRO até essa data e não é cobrado nos
        ciclos seguintes. <b>Não há reembolso proporcional</b> dos dias não
        utilizados do período já pago, salvo nas hipóteses previstas no Código
        de Defesa do Consumidor (por exemplo, direito de arrependimento em até
        7 dias da contratação, nos termos do Art. 49 do CDC).
      </LegalP>
      <LegalP>
        Quando a assinatura for contratada pela App Store (Apple) ou pela
        Google Play, a gestão do cancelamento e de eventuais reembolsos é feita
        pela respectiva loja, conforme as políticas dela. Em caso de cobrança
        indevida, falha técnica ou qualquer dúvida sobre a assinatura, entre em
        contato com o suporte da Cali Colors pelo WhatsApp{' '}
        <b>(11) 95976-5031</b> ou pelo e-mail <b>loja@calicolors.com.br</b> que
        providenciaremos a solução.
      </LegalP>
    </InfoSubPage>
  );
}
