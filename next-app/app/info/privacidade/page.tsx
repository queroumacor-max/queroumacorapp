// Página /info/privacidade — Política de Privacidade LGPD. Conteúdo
// idêntico ao vanilla index.html linha 1177-1213.
import type { Metadata } from 'next';
import { InfoSubPage, LegalH, LegalP, LegalUpd } from '../InfoSubPage';

export const metadata: Metadata = {
  title: 'Política de Privacidade | QueroUmaCor',
  description:
    'Como coletamos, usamos e protegemos seus dados pessoais conforme a LGPD.',
};

export default function PrivacidadePage() {
  return (
    <InfoSubPage title="Política de Privacidade">
      <LegalUpd>Última atualização: 22 de maio de 2026</LegalUpd>
      <LegalP>
        Esta Política de Privacidade explica como o QueroUmaCor coleta, usa,
        compartilha e protege os seus dados pessoais, em conformidade com a Lei
        Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </LegalP>

      <LegalH>1. Quem é o controlador</LegalH>
      <LegalP>
        O controlador dos dados é a <b>CALICOLORS TINTAS LTDA</b>
        (operadora do QueroUmaCor), inscrita no CNPJ{' '}
        <b>47.677.346/0001-92</b>, com sede na{' '}
        <b>
          Est. Presidente Juscelino Kubitschek de Oliveira, 1071 – Jardim
          dos Pimentas, Guarulhos/SP – CEP 07.272-345
        </b>
        . Para questões sobre privacidade ou exercer seus direitos LGPD,
        contate nosso Encarregado de Proteção de Dados (DPO) pelo e-mail{' '}
        <b>loja@calicolors.com.br</b> ou pelos canais em &quot;Fale Conosco&quot;.
      </LegalP>

      <LegalH>2. Dados que coletamos</LegalH>
      <LegalP>
        <b>Dados de cadastro:</b> nome, e-mail, telefone, tipo de usuário (cliente
        ou profissional) e foto de perfil.
        <br />
        <b>Dados do perfil profissional:</b> especialidades, raio de atendimento,
        formação, cursos e fotos do portfólio.
        <br />
        <b>Dados de uso:</b> orçamentos solicitados, mensagens trocadas no chat e
        avaliações.
        <br />
        <b>Localização aproximada:</b> usada para mostrar profissionais e serviços
        perto de você.
        <br />
        <b>Dados técnicos:</b> informações do dispositivo e de acesso, para
        segurança e funcionamento do app.
      </LegalP>

      <LegalH>3. Como usamos os seus dados</LegalH>
      <LegalP>
        Utilizamos os dados para criar e manter a sua conta; conectar clientes e
        profissionais; exibir perfis, portfólios e resultados de busca;
        viabilizar orçamentos e o chat; melhorar o aplicativo; garantir a
        segurança e prevenir fraudes; e cumprir obrigações legais.
      </LegalP>

      <LegalH>4. Base legal do tratamento</LegalH>
      <LegalP>
        Tratamos seus dados com base na execução do contrato (uso do app), no
        seu consentimento, no legítimo interesse de oferecer e aprimorar o
        serviço e no cumprimento de obrigações legais.
      </LegalP>

      <LegalH>5. Compartilhamento de dados</LegalH>
      <LegalP>
        Seu perfil público (nome, foto, especialidades e portfólio) é visível
        para outros usuários do app. Compartilhamos dados com os seguintes
        operadores que viabilizam o serviço:
      </LegalP>
      <ul
        style={{
          fontSize: 13.5,
          lineHeight: 1.7,
          color: 'var(--color-ink)',
          margin: '6px 0 10px',
          paddingLeft: 20,
        }}
      >
        <li>
          <b>Supabase Inc.</b> (EUA) — hospedagem do banco de dados, autenticação
          e storage
        </li>
        <li>
          <b>Cloudflare, Inc.</b> (EUA) — CDN, infraestrutura de borda e
          proteção contra abuso
        </li>
        <li>
          <b>OpenAI, Inc.</b> (EUA) — geração de texto e sugestões via IA
          (recurso &apos;Seu Zé&apos;)
        </li>
        <li>
          <b>Google LLC</b> (EUA) — geração de texto e sugestões via IA (Gemini,
          fallback do &apos;Seu Zé&apos;)
        </li>
        <li>
          <b>Functional Software Inc. (Sentry)</b> (EUA) — coleta de erros e
          relatórios de falhas do aplicativo, sem dados pessoais identificáveis
        </li>
        <li>
          <b>Mercado Pago</b> (Brasil) — processamento de pagamentos do plano
          PRO e da loja. O QueroUmaCor não armazena dados de cartão; o
          checkout é feito direto no ambiente seguro do Mercado Pago
        </li>
      </ul>
      <LegalP>
        A transferência internacional desses dados ocorre com base no Art. 33 da
        LGPD (cumprimento de obrigação legal e proteção do crédito) e nas
        garantias contratuais com cada operador. Também compartilhamos dados com
        autoridades quando exigido por lei. <b>Não vendemos os seus dados pessoais.</b>
      </LegalP>

      <LegalH>6. Inteligência artificial</LegalH>
      <LegalP>
        Alguns recursos usam o Seu Zé (nossa IA), como a sugestão de cores e o
        assistente do chat. Sobre o tratamento dos dados nesses recursos:
      </LegalP>
      <ul
        style={{
          fontSize: 13.5,
          lineHeight: 1.7,
          color: 'var(--color-ink)',
          margin: '6px 0 10px',
          paddingLeft: 20,
        }}
      >
        <li>
          Os comandos e textos que você envia (prompts) são transmitidos à{' '}
          <b>OpenAI</b> e à <b>Google</b> apenas para gerar a resposta
          solicitada em tempo real.
        </li>
        <li>
          Esses dados <b>não são usados para treinar modelos proprietários do
          QueroUmaCor</b>.
        </li>
        <li>
          <b>Não envie dados sensíveis ao assistente</b>, como CPF, senhas ou
          dados bancários.
        </li>
        <li>
          Os prompts podem ser armazenados por até <b>30 dias</b> para fins de
          segurança e moderação, sendo deletados após esse prazo.
        </li>
        <li>
          O conteúdo gerado por IA é de <b>responsabilidade do usuário</b> que o
          solicitou e utiliza.
        </li>
        <li>
          A propriedade do conteúdo gerado pertence ao usuário, nos termos das
          políticas dos provedores (OpenAI e Google).
        </li>
      </ul>

      <LegalH>7. Armazenamento e segurança</LegalH>
      <LegalP>
        Seus dados são armazenados em servidores seguros e adotamos medidas
        técnicas e organizacionais para protegê-los. Nenhum sistema, porém, é
        totalmente imune a riscos.
      </LegalP>

      <LegalH>8. Retenção dos dados</LegalH>
      <LegalP>
        Mantemos os seus dados pelo tempo necessário para as finalidades
        descritas nesta política e para o cumprimento de obrigações legais. Os
        prazos de retenção variam conforme o tipo de dado:
      </LegalP>
      <div style={{ overflowX: 'auto', margin: '6px 0 10px' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            color: 'var(--color-ink)',
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderBottom: '2px solid var(--color-border)',
                  fontWeight: 700,
                }}
              >
                Tipo de dado
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderBottom: '2px solid var(--color-border)',
                  fontWeight: 700,
                }}
              >
                Prazo de retenção
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Conta ativa', 'Indefinido (enquanto a conta existir)'],
              [
                'Após exclusão de conta',
                'Anonimização imediata; arquivos deletados em até 30 dias',
              ],
              ['Logs de acesso e segurança', '180 dias'],
              ['Dados financeiros', '5 anos (CDC, art. 12)'],
              ['Dados fiscais', 'Mínimo de 5 anos'],
              ['Mensagens e orçamentos', '2 anos após o encerramento'],
              ['Backups', '90 dias após a exclusão'],
            ].map(([tipo, prazo]) => (
              <tr key={tipo}>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--color-border)',
                    fontWeight: 600,
                    verticalAlign: 'top',
                  }}
                >
                  {tipo}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--color-border)',
                    verticalAlign: 'top',
                  }}
                >
                  {prazo}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LegalP>
        Após esses prazos, os dados são permanentemente deletados ou
        anonimizados, salvo quando a guarda for exigida por lei.
      </LegalP>

      <LegalH>9. Seus direitos</LegalH>
      <LegalP>
        Você pode, a qualquer momento, solicitar a confirmação e o acesso aos
        seus dados, a correção de informações, a anonimização ou eliminação, a
        portabilidade, informações sobre compartilhamento e a revogação do
        consentimento. Para exercer esses direitos, fale conosco.
      </LegalP>

      <LegalH>10. Localização</LegalH>
      <LegalP>
        A localização aproximada é usada somente para mostrar profissionais e
        serviços por perto. Você pode desativá-la nas configurações do seu
        dispositivo.
      </LegalP>

      <LegalH>11. Menores de idade</LegalH>
      <LegalP>
        O QueroUmaCor é destinado preferencialmente a maiores de 18 anos.
        Coletamos a data de nascimento no cadastro para personalização do
        perfil. O uso por menores deve contar com a autorização e o
        acompanhamento dos responsáveis, nos termos do Art. 14 da LGPD.
      </LegalP>

      <LegalH>12. Cookies e armazenamento local</LegalH>
      <LegalP>
        O aplicativo usa <b>localStorage</b> e <b>IndexedDB</b> do seu navegador
        apenas para fins técnicos: manter você logado, salvar rascunhos de
        formulários, cachear dados pra navegação mais rápida e lembrar
        preferências (ex.: modo claro/escuro). Não usamos cookies de
        rastreamento publicitário nem compartilhamos seu comportamento com
        anunciantes.
      </LegalP>

      <LegalH>13. Alterações desta política</LegalH>
      <LegalP>
        Podemos atualizar esta política periodicamente. Mudanças relevantes
        serão informadas no aplicativo.
      </LegalP>
    </InfoSubPage>
  );
}
