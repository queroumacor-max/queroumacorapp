// eslint.config.mjs — flat config, exigido desde que o Next 16 removeu o
// comando `next lint` (que embutia o legado .eslintrc.json). Tradução
// 1:1 do .eslintrc.json anterior (mesmos extends/rules/ignores) — não é
// migração de regras, só de formato.
//
// NÃO usar `FlatCompat` (`@eslint/eslintrc`) pra carregar
// 'next/core-web-vitals'/'next/typescript' como no boilerplate antigo —
// com `eslint-config-next@16` isso estoura `TypeError: Converting
// circular structure to JSON` dentro do próprio validador de config do
// FlatCompat (o config do `eslint-plugin-react` em formato flat tem uma
// referência circular que o formatter de erro do FlatCompat, que ainda
// serializa em JSON pra legado, não consegue serializar). `eslint-config-
// next` a partir da v16 já exporta um array de flat config NATIVO e
// pronto — os blocos nomeados 'next' e 'next/typescript' cobrem os dois
// extends de antes, sem precisar de FlatCompat nenhum.
import nextConfig from 'eslint-config-next';
import tseslint from 'typescript-eslint';

const eslintConfig = [
  ...nextConfig,
  {
    // Escopado a .ts/.tsx + plugin declarado explicitamente: em flat
    // config, um plugin registrado num objeto do array (aqui, pelo bloco
    // 'next/typescript' de eslint-config-next) não fica disponível pra
    // OUTRO objeto do array — cada objeto precisa da sua própria entrada
    // em `plugins` pras regras que usa.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'off',
      // As regras de prontidão pro React Compiler
      // ('set-state-in-effect'/'purity'/'preserve-manual-memoization', novas
      // no eslint-plugin-react-hooks v6 bundled por eslint-config-next@16)
      // ficam no nível ERROR do preset — de propósito, não rebaixadas aqui.
      // O PR #337 já tratou os ~102 achados caso a caso: efeito genuíno
      // (sync com localStorage/navigator/API do browser) ganha comentário
      // do WHY + `eslint-disable-next-line` pontual; state puramente
      // derivado de prop virou o idiom "adjust state during render". Uma
      // supressão global aqui esconderia um achado NOVO e real numa tela
      // nova, em vez de forçar a mesma decisão ponto a ponto que os outros
      // 102 já passaram.
    },
  },
  {
    // `public/**` não estava no .eslintrc.json antigo, mas nunca precisou
    // — `next lint` só lintava diretórios de código-fonte por padrão
    // (nunca `public/`). `eslint .` cru (obrigatório desde que `next
    // lint` foi removido no Next 16) não tem esse escopo implícito e
    // varre a árvore inteira — sem isto, tentava lintar
    // public/portal/app.jsx (JS vanilla legado, não-TS, código
    // completamente diferente do app Next) com as regras de
    // react/typescript deste projeto, e falhava em erros que nunca
    // fizeram sentido pra esse arquivo (ex.: hoisting de função, padrão
    // comum em JS solto sem módulos).
    ignores: [
      'node_modules/**',
      '.next/**',
      '.open-next/**',
      '.vercel/**',
      'out/**',
      'dist/**',
      'public/**',
      'next-env.d.ts',
      'lib/database.types.ts',
      'openapi.yaml',
    ],
  },
];

export default eslintConfig;
