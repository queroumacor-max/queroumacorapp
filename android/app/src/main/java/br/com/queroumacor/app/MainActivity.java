package br.com.queroumacor.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin próprio tem que ser registrado ANTES do super.onCreate: é ali
        // que o Bridge carrega os plugins e registra os launchers de resultado.
        // Registrado depois, o resultado da galeria que chega numa activity
        // recriada (app morto pelo Android) não tem pra quem ser entregue.
        registerPlugin(GaleriaSeguraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
