//
//  AppDelegate.swift
//  App
//
//  Capacitor 6 boilerplate for com.calicolors.queroumacor with
//  Apple Push Notification service (APNs) registration wired in.
//
//  The Capacitor `@capacitor/push-notifications` plugin bridges the
//  device token to JavaScript via the `registration` event so that
//  next-app's PushSubscriber (sprint C8 — pending) can persist it to
//  Supabase `push_tokens` for server-side dispatch.
//

import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions:
            [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Request notification permission early so the user sees the
        // prompt once they reach the screen that actually needs it.
        // The JS side (via the PushNotifications plugin) controls
        // when `register()` is called; here we just install the
        // delegate so foreground presentation works.
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // MARK: UISceneSession Lifecycle

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
    }

    func application(
        _ application: UIApplication,
        didDiscardSceneSessions sceneSessions: Set<UISceneSession>
    ) {
        // Release scene-specific resources when sessions are discarded.
    }

    // MARK: Deep links / Universal Links

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey : Any] = [:]
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(
            app, open: url, options: options
        )
    }

    func application(
        _ application: UIApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(
            application,
            continue: userActivity,
            restorationHandler: restorationHandler
        )
    }

    // MARK: APNs registration callbacks
    //
    // These two callbacks are required by the
    // @capacitor/push-notifications plugin. When iOS finishes APNs
    // registration, the plugin emits the `registration` JS event with
    // the hex-encoded device token. The JS side persists the token to
    // Supabase so the server can target the device.

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }
}

// MARK: - Foreground notification presentation

extension AppDelegate: UNUserNotificationCenterDelegate {

    // Show banner + sound when a push arrives while the app is open.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .list, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    // Forward tap actions to Capacitor so the plugin can emit
    // `pushNotificationActionPerformed` to JS.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        NotificationCenter.default.post(
            name: Notification.Name("pushNotificationActionPerformed"),
            object: response
        )
        completionHandler()
    }
}
