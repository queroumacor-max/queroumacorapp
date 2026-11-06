// Último avatar conhecido de cada conta, guardado no aparelho.
//
// O círculo "Seu story" esperava DUAS idas à rede em série antes de ter o que
// desenhar: a leitura do perfil e depois a imagem. Na abertura do app isso dá
// um círculo vazio por um ou dois segundos. Com a URL guardada, o <img> já
// nasce com o endereço certo (e o service worker serve a imagem do cache).
//
// Só guarda a URL — que é pública, a mesma que qualquer um vê no perfil — e
// só aceita https. A chave leva o id da conta: outra conta no mesmo aparelho
// nunca lê o avatar de quem saiu. Quem manda continua sendo o perfil: assim
// que ele chega, o valor guardado é trocado (ou apagado, se a foto saiu).

const PREFIXO = 'quc_avatar_';

function chave(userId: string): string {
  return PREFIXO + userId;
}

export function lerAvatarGuardado(userId: string | null | undefined): string | null {
  if (!userId) return null;
  try {
    const v = window.localStorage.getItem(chave(userId));
    return v && /^https:\/\//i.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function guardarAvatar(userId: string | null | undefined, url: string | null | undefined): void {
  if (!userId) return;
  try {
    if (url && /^https:\/\//i.test(url)) window.localStorage.setItem(chave(userId), url);
    else window.localStorage.removeItem(chave(userId));
  } catch {
    // storage cheio/bloqueado: só perde o atalho, o perfil segue chegando.
  }
}
