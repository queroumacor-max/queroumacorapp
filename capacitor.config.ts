import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for QueroUmaCor iOS / Android wrappers.
 *
 * The app is a PWA hosted at https://queroumacor.com.br — the native
 * wrapper does NOT bundle local web assets. It opens the production URL
 * in a WKWebView (iOS) / WebView (Android) with App-Bound Domains so the
 * webview is restricted to the queroumacor.com.br domain family.
 *
 * Pre-publish checklist:
 *   - Bundle ID `br.com.queroumacor.app` must be registered in
 *     Apple Developer (Identifiers) and Google Play Console.
 *   - `npx cap add ios` / `npx cap add android` must be run on a host
 *     with Xcode (iOS) or Android Studio (Android) — the resulting
 *     `ios/` and `android/` boilerplate is committed to the repo.
 *   - After `cap add ios`, copy the curated `ios/App/App/Info.plist`
 *     and `ios/App/App/PrivacyInfo.xcprivacy` from THIS repo on top of
 *     the Capacitor-generated stubs.
 *
 * See docs/IOS_BUILD.md for the full step-by-step build flow.
 */
const config: CapacitorConfig = {
  appId: 'br.com.queroumacor.app',
  appName: 'QueroUmaCor',
  // PWA hosted — no local web assets are bundled. The webDir below is a
  // placeholder required by the CLI; the `server.url` setting below makes
  // the wrapper load the live URL instead of `webDir`.
  webDir: 'next-app/.next/static',
  server: {
    url: 'https://queroumacor.com.br',
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'queroumacor.com.br',
      '*.queroumacor.com.br',
    ],
  },
  ios: {
    contentInset: 'always',
    backgroundColor: '#1a1a2e',
    // Apple App-Bound Domains — restricts WKWebView to listed domains.
    // The actual domain list lives in Info.plist (WKAppBoundDomains).
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    backgroundColor: '#1a1a2e',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
