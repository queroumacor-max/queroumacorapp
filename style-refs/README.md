# Style References (Arte pra Instagram)

Cada arquivo nesta pasta é um **template visual** que a IA recebe como segunda
imagem no `/v1/images/edits` do gpt-image-1 (e nas `parts` do Gemini fallback).
A foto do usuário entra como primeira imagem; a IA combina layout/composição
do template com o sujeito da foto.

## Arquivos esperados

| Estilo (key)   | Arquivo                       | O que o template deve mostrar                                                  |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `portrait`     | `portrait.jpg`                | Retrato cinematográfico de pintor, luz lateral, bokeh terroso                  |
| `antesdepois`  | `antesdepois.jpg`             | Split-screen vertical antes/depois de uma pintura                              |
| `profissional` | `profissional.jpg`            | Post de marketing IG com o pintor segurando ferramentas no ambiente            |
| `trabalho`     | `trabalho.jpg`                | Post de marketing IG do ambiente recém-entregue, **sem pessoas**               |
| `grafite`      | `grafite.jpg`                 | Mural de grafite urbano vibrante                                               |

## Regras

- **Formato:** JPG ou PNG, **quadrado** (1024×1024 ideal) ou aspect-ratio
  comparável. Não precisa ser pixel-perfect — o gpt-image-1 usa como
  referência visual, não como mask.
- **Tamanho:** entre 100KB e 4MB. Acima de 4MB o OpenAI rejeita.
- **Conteúdo:** sem copyright de terceiros (use prints autorais, fotos
  licenciadas ou imagens geradas por IA).
- **Marca/handle no template:** ok deixar placeholders genéricos
  (`@PintorModernoBR`, `(XX) 9XXXX-XXXX`). O prompt instrui a IA a
  substituir pela marca do profissional logado.

## Fluxo no backend

Veja `functions/api/ig-art.js` → `loadStyleReference()`. Se o arquivo
existir e for `image/*`, vai pra IA; se não (404 ou content-type errado),
cai automaticamente no fluxo só-texto (sem template).

Cache: o CDN do Cloudflare cacheia esses arquivos via `_headers`.
Pra forçar invalidação, suba com novo nome ou purge manual.
