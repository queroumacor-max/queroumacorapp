// eslint.config.mjs — migração de .eslintrc.json (formato legado) pro flat
// config (padrão desde ESLint 9). Necessária porque o Next 16 REMOVEU o
// comando `next lint` do CLI (que embrulhava o bootstrap do eslint-config-
// next automaticamente) — sem isso, `eslint` puro recusa rodar sem um
// `eslint.config.*` na raiz.
//
// `eslint-config-next@16.x` já exporta flat config NATIVO (o `default`
// export de `eslint-config-next` já é o array `[next/core-web-vitals,
// next/typescript, ignores-base]`) — não precisa da ponte `FlatCompat`
// (`@eslint/eslintrc`), que tentei primeiro e bateu num bug conhecido de
// interop com `eslint-plugin-react` ("Converting circular structure to
// JSON" dentro do validador de schema legado, ao tentar formatar erro de
// UM config flat embrulhado por trás de uma API pensada pra config
// legado). Import direto evita a ponte inteira.
//
// Mesmos extends, mesmas regras, mesmos ignores do `.eslintrc.json`
// anterior — migração de FORMATO, não de conteúdo. `.eslintrc.json` FICA
// no repo por enquanto (ESLint 9 prioriza `eslint.config.*` quando ele
// existe e ignora `.eslintrc.json` sozinho; apagar é limpeza separada,
// não travada nesta migração).
import nextConfig from 'eslint-config-next';

const eslintConfig = [
  {
    // `public/**` NÃO estava sob `next lint` antes — o comando (removido no
    // Next 16) só varria `pages/`, `app/`, `components/`, `lib/`, `src/`
    // por padrão. `eslint .` puro varre o repo INTEIRO por padrão, e sem
    // este ignore ele pegaria `public/portal/app.jsx` (arquivo legado
    // mantido à mão, compilado manualmente com Babel próprio — ver
    // CLAUDE.md, não segue as convenções React/Next daqui) e libs
    // vendoradas (`public/portal/react*.min.js`, `xlsx.full.min.js`,
    // `public/supabase.js`) — nenhuma delas é código deste app.
    ignores: [
      'node_modules/**',
      '.next/**',
      '.vercel/**',
      '.open-next/**',
      'out/**',
      'dist/**',
      'public/**',
      'next-env.d.ts',
      'lib/database.types.ts',
      'openapi.yaml',
    ],
  },
  ...nextConfig,
  // Escopado igual ao `next/typescript` de dentro de `nextConfig` (só
  // `.ts`/`.tsx`) — é ONDE o plugin `@typescript-eslint` é registrado.
  // Sem essa mesma restrição de `files`, o ESLint tenta aplicar a regra
  // em arquivo `.js`/`.mjs` também (este próprio `eslint.config.mjs`
  // incluso) e explode com "could not find plugin @typescript-eslint".
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Estas duas regras vêm do plugin base `next` (react-hooks, @next/next),
  // registrado pro glob mais amplo em `**/*.{js,jsx,mjs,ts,tsx,mts,cts}`.
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'off',
    },
  },
];

export default eslintConfig;
