package br.com.queroumacor.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.FileUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * GaleriaSegura — escolher fotos/vídeo SEM perder o resultado quando o
 * Android mata o app com a galeria aberta (2026-11-04).
 *
 * O seletor do WebView (onShowFileChooser) e o pickImages do plugin Camera
 * entregam o resultado num callback que morre junto com o processo. Aqui o
 * seletor é aberto pelo startActivityForResult do Capacitor, cujo launcher é
 * registrado na criação da activity: numa activity recriada o Android ainda
 * entrega o resultado. Cada resultado é COPIADO pro cache do app e a lista é
 * gravada em SharedPreferences ANTES de responder — se a página que pediu
 * morreu, a página nova busca a lista com `recuperar()`.
 */
@CapacitorPlugin(name = "GaleriaSegura")
public class GaleriaSeguraPlugin extends Plugin {

    private static final String PREFS = "galeria_segura";
    private static final String CHAVE = "pendente";
    private static final String PASTA = "galeria-segura";
    /** Resultado mais velho que isso é sessão nova, não recuperação. */
    private static final long JANELA_MS = 10 * 60 * 1000;

    @PluginMethod
    public void escolher(PluginCall call) {
        int limite = call.getInt("limite", 5);
        boolean video = call.getBoolean("video", true);
        PickVisualMediaRequest pedido = video
            ? new PickVisualMediaRequest.Builder().setMediaType(ActivityResultContracts.PickVisualMedia.ImageAndVideo.INSTANCE).build()
            : new PickVisualMediaRequest.Builder().setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE).build();
        Intent intent;
        try {
            if (limite >= 2) {
                intent = new ActivityResultContracts.PickMultipleVisualMedia(limite).createIntent(getContext(), pedido);
            } else {
                intent = new ActivityResultContracts.PickVisualMedia().createIntent(getContext(), pedido);
            }
        } catch (Exception e) {
            call.reject("seletor indisponível: " + e.getMessage(), "UNAVAILABLE");
            return;
        }
        // Resultado de uma escolha anterior que ninguém leu não pode vazar
        // pra esta.
        limparPendente();
        startActivityForResult(call, intent, "aoEscolher");
    }

    @ActivityCallback
    private void aoEscolher(final PluginCall call, final ActivityResult resultado) {
        final List<Uri> uris = new ArrayList<>();
        if (resultado != null && resultado.getResultCode() == android.app.Activity.RESULT_OK && resultado.getData() != null) {
            Intent data = resultado.getData();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        if (uris.isEmpty()) {
            if (call != null) call.reject("cancelado", "CANCELLED");
            return;
        }
        // Copiar 5 fotos (ou um vídeo de 50 MB) não pode rodar na thread de UI.
        new Thread(() -> {
            JSArray itens = new JSArray();
            String erro = null;
            for (Uri u : uris) {
                try {
                    itens.put(copiar(u));
                } catch (Exception e) {
                    erro = e.getMessage();
                }
            }
            if (itens.length() == 0) {
                if (call != null) call.reject("não consegui ler os arquivos: " + erro, "READ_FAILED");
                return;
            }
            gravarPendente(itens);
            JSObject ret = new JSObject();
            ret.put("itens", itens);
            if (call != null) call.resolve(ret);
        }).start();
    }

    /** Devolve (e apaga) o que foi escolhido numa página que morreu. */
    @PluginMethod
    public void recuperar(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String bruto = p.getString(CHAVE, null);
        JSObject ret = new JSObject();
        if (bruto == null) {
            call.resolve(ret);
            return;
        }
        try {
            JSONObject obj = new JSONObject(bruto);
            if (System.currentTimeMillis() - obj.getLong("em") <= JANELA_MS) {
                // As URLs portáteis dependem do host atual da ponte: refaz.
                JSONArray guardados = obj.getJSONArray("itens");
                JSArray itens = new JSArray();
                for (int i = 0; i < guardados.length(); i++) {
                    JSONObject it = guardados.getJSONObject(i);
                    File f = new File(it.getString("path"));
                    if (!f.exists()) continue;
                    it.put("url", urlDe(f));
                    itens.put(it);
                }
                if (itens.length() > 0) ret.put("itens", itens);
            }
        } catch (Exception ignored) {
            /* registro corrompido: só descarta */
        }
        limparPendente();
        call.resolve(ret);
    }

    /** A página recebeu o resultado ao vivo: nada a recuperar no boot. */
    @PluginMethod
    public void confirmar(PluginCall call) {
        limparPendente();
        call.resolve();
    }

    private JSObject copiar(Uri u) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        String mime = cr.getType(u);
        if (mime == null) mime = "application/octet-stream";
        String nome = nomeDe(cr, u);
        String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        if (ext == null) ext = "bin";
        File pasta = new File(getContext().getCacheDir(), PASTA);
        if (!pasta.exists() && !pasta.mkdirs()) throw new Exception("sem pasta de cache");
        File destino = new File(pasta, UUID.randomUUID().toString() + "." + ext);
        try (InputStream in = cr.openInputStream(u); OutputStream out = new FileOutputStream(destino)) {
            if (in == null) throw new Exception("arquivo ilegível");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        JSObject it = new JSObject();
        it.put("path", destino.getAbsolutePath());
        it.put("url", urlDe(destino));
        it.put("mimeType", mime);
        it.put("name", nome != null ? nome : destino.getName());
        it.put("size", destino.length());
        return it;
    }

    private String urlDe(File f) {
        return FileUtils.getPortablePath(getContext(), getBridge().getLocalUrl(), Uri.fromFile(f));
    }

    private static String nomeDe(ContentResolver cr, Uri u) {
        try (Cursor c = cr.query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
            /* nome é cosmético */
        }
        return null;
    }

    private void gravarPendente(JSArray itens) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("em", System.currentTimeMillis());
            obj.put("itens", itens);
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(CHAVE, obj.toString()).commit();
        } catch (Exception ignored) {
            /* sem registro, só perde a recuperação — a resposta ao vivo segue */
        }
    }

    private void limparPendente() {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(CHAVE).apply();
    }
}
