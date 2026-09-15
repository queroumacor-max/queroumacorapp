// lib/native — A ÚNICA fronteira do app web com a casca nativa (Capacitor).
//
// Contrato: componentes e hooks importam SÓ este módulo (objeto `native`),
// nunca plugin/global direto. Toda função aqui é feature-detected e tem
// fallback definido — a mesma página funciona em browser puro, PWA, casca
// Capacitor velha (sem o plugin) e casca nova. Se a casca um dia virar
// React Native/Expo, reimplementa-se este diretório e nada mais.
//
// Decisão de arquitetura registrada em docs/NATIVE_BRIDGE.md e na auditoria
// 2026-08-26 (achado A-P1 + análise Capacitor vs RN).

export {
  isNativePlatform,
  getNativePlatform,
  listNativePlugins,
} from './platform';
export {
  isNativeOAuthAvailable,
  nativeSignInWithOAuth,
  parseAuthCallbackUrl,
  NATIVE_OAUTH_REDIRECT,
} from './auth';
export {
  isNativeCameraAvailable,
  takePhotoNative,
  isNativePickerAvailable,
  pickImagesNative,
} from './camera';
export type { NativePhotoResult, NativePickResult } from './camera';
export { shareNative } from './share';
export type { SharePayload } from './share';
export {
  isNativePushAvailable,
  registerNativePush,
  nativePushPermission,
  initNativePushTapRouting,
  onNativePushTokenRefresh,
  currentNativePushToken,
  routeFromNotificationData,
} from './push';
export {
  isNativeFilesystemAvailable,
  saveFileNative,
  blobToBase64,
} from './filesystem';
export type { SaveFileResult } from './filesystem';
export { hapticImpact, hapticNotify, hapticSelection } from './haptics';
export { applyStatusBar } from './statusBar';
export { hideSplash } from './splash';
export { initKeyboard } from './keyboard';
export { onAppResume } from './appState';
export { isOnlineNow, onNetworkChange } from './network';
export { copyToClipboard } from './clipboard';
export { openExternal, abrirLinkExterno } from './browser';
export { getDeviceInfo } from './device';
export type { NativeDeviceInfo } from './device';
export { setAppBadge } from './badge';

import { getNativePlatform, isNativePlatform, listNativePlugins } from './platform';
import { isNativeOAuthAvailable, nativeSignInWithOAuth } from './auth';
import {
  isNativeCameraAvailable,
  takePhotoNative,
  isNativePickerAvailable,
  pickImagesNative,
} from './camera';
import { shareNative } from './share';
import {
  isNativePushAvailable,
  registerNativePush,
  nativePushPermission,
  initNativePushTapRouting,
  onNativePushTokenRefresh,
  currentNativePushToken,
} from './push';
import { isNativeFilesystemAvailable, saveFileNative } from './filesystem';
import { hapticImpact, hapticNotify, hapticSelection } from './haptics';
import { applyStatusBar } from './statusBar';
import { hideSplash } from './splash';
import { initKeyboard } from './keyboard';
import { onAppResume } from './appState';
import { isOnlineNow, onNetworkChange } from './network';
import { copyToClipboard } from './clipboard';
import { openExternal, abrirLinkExterno } from './browser';
import { getDeviceInfo } from './device';
import { setAppBadge } from './badge';

/** Fachada única — preferir `native.x()` nos call sites. */
export const native = {
  isNative: isNativePlatform,
  platform: getNativePlatform,
  plugins: listNativePlugins,
  oauth: { isAvailable: isNativeOAuthAvailable, signIn: nativeSignInWithOAuth },
  camera: {
    isAvailable: isNativeCameraAvailable,
    takePhoto: takePhotoNative,
    isPickerAvailable: isNativePickerAvailable,
    pickImages: pickImagesNative,
  },
  share: shareNative,
  push: {
    isAvailable: isNativePushAvailable,
    register: registerNativePush,
    permission: nativePushPermission,
    initTapRouting: initNativePushTapRouting,
    onTokenRefresh: onNativePushTokenRefresh,
    currentToken: currentNativePushToken,
  },
  haptics: {
    impact: hapticImpact,
    notify: hapticNotify,
    selection: hapticSelection,
  },
  fs: { isAvailable: isNativeFilesystemAvailable, saveFile: saveFileNative },
  statusBar: { apply: applyStatusBar },
  splash: { hide: hideSplash },
  keyboard: { init: initKeyboard },
  onResume: onAppResume,
  network: { isOnline: isOnlineNow, onChange: onNetworkChange },
  clipboard: { copy: copyToClipboard },
  openExternal,
  abrirLinkExterno,
  device: { getInfo: getDeviceInfo },
  badge: { set: setAppBadge },
};
