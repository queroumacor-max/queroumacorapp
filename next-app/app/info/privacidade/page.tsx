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
      <LegalUpd>Última atualização: 26 de setembro de 2026</LegalUpd>
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
        <b>Dados de cadastro:</b> nome, e-mail, telefone, data de nascimento,
        cidade e estado, @usuário, tipo de usuário (cliente ou profissional) e
        foto de perfil (opcional). Se você entrar com Google ou Apple, recebemos
        desses serviços o seu nome e e-mail.
        <br />
        <b>Dados do perfil profissional:</b> especialidades, raio de atendimento,
        formação, cursos, logotipo, links de Instagram/site e fotos e vídeos do
        portfólio.
        <br />
        <b>Conteúdo que você publica:</b> posts, stories, legendas, comentários,
        curtidas, avaliações e mensagens do chat, incluindo fotos, áudios e
        arquivos enviados.
        <br />
        <b>Orçamentos:</b> dados do serviço, valores e os dados que o
        profissional informa no documento (nome do cliente, telefone, endereço,
        CEP e, do próprio profissional, CNPJ/CPF, endereço e contato).
        <br />
        <b>Ferramentas de trabalho:</b> agenda, financeiro (serviços, gastos e
        fotos de notas fiscais), anotações (inclusive áudio), obras, equipe e
        escala da Gestão de Obras, e a lista de pedidos da loja.
        <br />
        <b>Pontos e indicações:</b> saldo de pontos, indicações feitas e trocas
        pelo Plano PRO.
        <br />
        <b>Localização aproximada:</b> usada para mostrar profissionais e serviços
        perto de você, somente com a sua permissão.
        <br />
        <b>Dados técnicos:</b> informações do dispositivo e de acesso, registros
        de erro e o identificador de notificações (push) do aparelho, para
        segurança e funcionamento do app.
      </LegalP>

      <LegalH>3. Como usamos os seus dados</LegalH>
      <LegalP>
        Utilizamos os dados para criar e manter a sua conta; conectar clientes e
        profissionais; exibir perfis, portfólios e resultados de busca;
        viabilizar orçamentos, o chat e as ferramentas de trabalho; enviar
        notificações; moderar conteúdo; melhorar o aplicativo; garantir a
        segurança e prevenir fraudes; e cumprir obrigações legais. A data de
        nascimento é usada para confirmar que o uso é de maior de idade.
      </LegalP>

      <LegalH>3.1. Dados de outras pessoas que você cadastra</LegalH>
      <LegalP>
        Algumas ferramentas permitem que você registre dados de terceiros — por
        exemplo, o nome e o telefone de um cliente num orçamento, ou o nome, o
        telefone e a diária de um funcionário na Gestão de Obras. Ao fazer isso,
        você declara ter autorização da pessoa para informar esses dados e
        usá-los para a finalidade da ferramenta. Esses dados ficam visíveis só
        para você, salvo o que o próprio recurso mostra a quem participa (por
        exemplo, a agenda de uma obra para quem está escalado nela).
      </LegalP>

      <LegalH>4. Base legal do tratamento</LegalH>
      <LegalP>
        Tratamos seus dados com base na execução do contrato (uso do app), no
        seu consentimento, no legítimo interesse de oferecer e aprimorar o
        serviço e no cumprimento de obrigações legais.
      </LegalP>

      <LegalH>5. Compartilhamento de dados</LegalH>
      <LegalP>
        Seu perfil público (nome, @usuário, foto, cidade, especialidades e
        portfólio) é visível para outros usuários do app. Seu e-mail, telefone
        e data de nascimento não aparecem no perfil público. Compartilhamos
        dados com os seguintes operadores que viabilizam o serviço:
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
          <b>OpenAI, Inc.</b> (EUA) — assistentes de IA (Seu Zé, Alice, Fê e
          Senna), transcrição de áudio, voz sintetizada, geração de logotipos e
          artes e leitura de notas fiscais
        </li>
        <li>
          <b>Google LLC</b> (EUA) — IA Gemini (assistentes e moderação automática
          de fotos, vídeos e mensagens), login com Google e envio de
          notificações push (Firebase Cloud Messaging)
        </li>
        <li>
          <b>Apple Inc.</b> (EUA) — login com Apple e envio de notificações push
          em aparelhos iOS
        </li>
        <li>
          <b>Functional Software Inc. (Sentry)</b> (EUA) — coleta de erros e
          relatórios de falhas do aplicativo, sem dados pessoais identificáveis
        </li>
      </ul>
      <LegalP>
        <b>Não há pagamento dentro do aplicativo.</b> O Plano PRO é ativado
        pela troca de pontos acumulados no app e os pedidos da loja são
        fechados diretamente com a Cali Colors, fora do aplicativo — por isso
        nenhum dado seu é enviado a processadores de pagamento.
      </LegalP>
      <LegalP>
        Como esses operadores ficam fora do Brasil, há transferência
        internacional de dados, realizada com base no Art. 33 da LGPD, mediante
        as garantias contratuais de proteção de dados oferecidas por cada
        operador e, quando necessário, para a execução do contrato com você. Também compartilhamos dados com
        autoridades quando exigido por lei. <b>Não vendemos os seus dados pessoais.</b>
      </LegalP>

      <LegalH>6. Inteligência artificial</LegalH>
      <LegalP>
        Alguns recursos usam inteligência artificial, como os assistentes (Seu
        Zé, Alice, Fê e Senna), a sugestão de legenda, cores e preços, a
        transcrição de áudio, a geração de logotipos e a leitura de notas
        fiscais. Sobre o tratamento dos dados nesses recursos:
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
          Os textos, fotos e áudios que você envia a esses recursos são
          transmitidos à <b>OpenAI</b> e à <b>Google</b> apenas para gerar a
          resposta solicitada em tempo real.
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
          Não guardamos o conteúdo das conversas com os assistentes nos nossos
          servidores — o histórico, quando existe, fica só no seu aparelho.
          Registramos apenas que o recurso foi usado, para controle de limite
          de uso. Os provedores podem reter o conteúdo por até <b>30 dias</b>
          para fins de segurança e prevenção de abuso.
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

      <LegalH>7. Moderação de conteúdo</LegalH>
      <LegalP>
        Para proteger a comunidade, o conteúdo publicado passa por moderação:
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
          Posts, stories, fotos de perfil, imagens da biblioteca de artes e
          mensagens do chat são analisados automaticamente por inteligência
          artificial (Google Gemini). Um post só aparece no feed depois dessa
          análise.
        </li>
        <li>
          As imagens são comparadas, por uma assinatura digital (hash), com uma
          lista de conteúdo proibido. Conteúdo de abuso sexual infantil é
          removido e comunicado às autoridades competentes, como exige a lei.
        </li>
        <li>
          Conteúdo reprovado não é publicado ou é removido; casos duvidosos vão
          para revisão por uma pessoa da nossa equipe.
        </li>
        <li>
          Você pode pedir a revisão de uma decisão tomada de forma automatizada
          (Art. 20 da LGPD) pelos canais em &quot;Fale Conosco&quot;.
        </li>
      </ul>

      <LegalH>8. Armazenamento e segurança</LegalH>
      <LegalP>
        Seus dados são armazenados em servidores seguros e adotamos medidas
        técnicas e organizacionais para protegê-los. Nenhum sistema, porém, é
        totalmente imune a riscos.
      </LegalP>

      <LegalH>9. Retenção dos dados</LegalH>
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
              ['Conta ativa', 'Enquanto a conta existir'],
              [
                'Após exclusão de conta',
                'Conta e dados pessoais apagados; arquivos removidos em até 30 dias. Guardamos só o registro mínimo da exclusão e dos consentimentos dados, como prova legal',
              ],
              ['Conteúdo apagado por você (posts, mensagens, anotações)', 'Recuperável por 30 dias; depois, apagado definitivamente'],
              ['Registros de acesso', '6 meses (Marco Civil da Internet, art. 15)'],
              ['Registros de auditoria e segurança', 'Até 1 ano'],
              ['Registros de erro', '90 dias'],
              ['Mensagens e orçamentos', '2 anos após o encerramento'],
              ['Cópias de segurança (backups)', 'Até 7 dias'],
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

      <LegalH>10. Seus direitos</LegalH>
      <LegalP>
        Você pode, a qualquer momento, solicitar a confirmação e o acesso aos
        seus dados, a correção de informações, a anonimização ou eliminação, a
        portabilidade, informações sobre compartilhamento, a revisão de
        decisões automatizadas e a revogação do consentimento. Para exercer
        esses direitos, fale conosco. Você também pode excluir a sua conta a
        qualquer momento pela tela &quot;Mais informações e suporte&quot;.
      </LegalP>

      <LegalH>11. Localização</LegalH>
      <LegalP>
        A localização aproximada é usada somente para mostrar profissionais e
        serviços por perto. Você pode desativá-la nas configurações do seu
        dispositivo.
      </LegalP>

      <LegalH>12. Menores de idade</LegalH>
      <LegalP>
        O QueroUmaCor é destinado exclusivamente a maiores de 18 anos. A data de
        nascimento informada no cadastro é usada para confirmar essa idade, e o
        cadastro não é aceito para menores. Se soubermos que uma conta pertence
        a menor de idade, ela será encerrada e os dados apagados.
      </LegalP>

      <LegalH>13. Cookies e armazenamento local</LegalH>
      <LegalP>
        O aplicativo usa <b>cookies essenciais</b>, <b>localStorage</b> e{' '}
        <b>IndexedDB</b> apenas para fins técnicos: manter você logado (a
        sessão fica guardada por até 30 dias), salvar rascunhos de formulários,
        guardar o histórico das conversas com os assistentes no seu aparelho,
        cachear dados para navegação mais rápida e lembrar preferências (ex.:
        modo claro/escuro). Não usamos cookies de rastreamento publicitário nem
        compartilhamos seu comportamento com anunciantes.
      </LegalP>

      <LegalH>14. Alterações desta política</LegalH>
      <LegalP>
        Podemos atualizar esta política periodicamente. Mudanças relevantes
        serão informadas no aplicativo.
      </LegalP>
    </InfoSubPage>
  );
}
