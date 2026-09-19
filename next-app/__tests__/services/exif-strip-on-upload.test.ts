// Privacidade 2026-09-17: avatar e art-reference (JPEG) iam pro bucket
// PÚBLICO sem nenhuma recompressão — o EXIF original, incluindo GPS de onde
// a foto foi tirada (se o aparelho gravou), sobrevivia intacto e ficava
// baixável por qualquer um a partir da URL pública. `uploadAvatar` e
// `uploadArtReference` (só pra JPEG — PNG/WebP preservam transparência, ver
// comentário no service) agora tentam `compressImage` (reencode via canvas,
// que não carrega metadata) antes de subir.
//
// Mocka `compressImage` no limite do módulo (mesmo padrão de
// __tests__/publicar-comprime.test.tsx) em vez de canvas real — o que
// importa aqui é que o SERVICE chama compressImage e sobe o RESULTADO dela,
// não reimplementar/re-testar a API de canvas do browser.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetSupabaseForTests, __setSupabaseForTests } from '../../lib/supabase';
import { uploadAvatar } from '../../lib/services/profile';
import { uploadArtReference } from '../../lib/services/artReferences';

const compressImage = vi.fn();
vi.mock('@/lib/services/posts', () => ({
  compressImage: (...a: unknown[]) => compressImage(...a),
}));
// uploadArtReference chama assertMediaApproved (checagem CSAM autoritativa,
// 2026-09-17) depois do upload — sem relação com o que este arquivo testa.
vi.mock('@/lib/services/moderateMedia', () => ({
  assertMediaApproved: vi.fn(async () => {}),
}));

function jpeg(name: string, bytes = 100): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
}
function png(name: string, bytes = 100): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

function makeUploadingClient() {
  const uploadCalls: Array<{ bucket: string; path: string; file: File }> = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, file: File) => {
          uploadCalls.push({ bucket, path, file });
          return Promise.resolve({ error: null });
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.test/${path}` },
        }),
      }),
    },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'ar1' }, error: null }),
        }),
      }),
    }),
  };
  return { client, uploadCalls };
}

beforeEach(() => {
  compressImage.mockReset();
});
afterEach(() => __resetSupabaseForTests());

describe('uploadAvatar — recompressão remove EXIF antes de subir', () => {
  it('sobe o arquivo COMPRIMIDO (não o original) quando compressImage funciona', async () => {
    const original = jpeg('foto.jpg');
    const compressed = jpeg('foto.jpg', 40); // "menor" simula reencode
    compressImage.mockResolvedValue(compressed);

    const { client, uploadCalls } = makeUploadingClient();
    __setSupabaseForTests(client as never);

    await uploadAvatar('user-1', original);

    expect(compressImage).toHaveBeenCalledWith(original);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].file).toBe(compressed);
  });

  it('cai pro arquivo ORIGINAL se compressImage falhar (ex.: HEIC que o canvas não decodifica)', async () => {
    const original = jpeg('foto.jpg');
    compressImage.mockRejectedValue(new Error('canvas não decodificou'));

    const { client, uploadCalls } = makeUploadingClient();
    __setSupabaseForTests(client as never);

    await uploadAvatar('user-1', original);

    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].file).toBe(original);
  });
});

describe('uploadArtReference — recompressão só pra JPEG (preserva transparência de PNG/WebP)', () => {
  it('JPEG: chama compressImage e sobe o resultado dela', async () => {
    const original = jpeg('grafite.jpg');
    const compressed = jpeg('grafite.jpg', 40);
    compressImage.mockResolvedValue(compressed);

    const { client, uploadCalls } = makeUploadingClient();
    __setSupabaseForTests(client as never);

    await uploadArtReference({ userId: 'user-1', file: original });

    expect(compressImage).toHaveBeenCalledWith(original);
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].file).toBe(compressed);
  });

  it('PNG: NÃO chama compressImage (evita perder o canal alfa)', async () => {
    const original = png('arte-transparente.png');

    const { client, uploadCalls } = makeUploadingClient();
    __setSupabaseForTests(client as never);

    await uploadArtReference({ userId: 'user-1', file: original });

    expect(compressImage).not.toHaveBeenCalled();
    expect(uploadCalls).toHaveLength(1);
    expect(uploadCalls[0].file).toBe(original);
  });
});
