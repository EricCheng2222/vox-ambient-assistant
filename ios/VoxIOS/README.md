# Vox for iOS

This project is an iOS shell for the production Vox experience. It intentionally loads the same deployed application used on the web so accounts, preferences, conversation history, memories, reminders, camera behavior, and backend updates stay synchronized.

## Run it

1. Open `VoxIOS.xcodeproj` in Xcode.
2. Select the **VoxIOS** target, open **Signing & Capabilities**, and choose your Apple development team.
3. Run on an iPhone or an iOS Simulator.

A physical iPhone is required to test microphone input and front/rear camera switching properly.

## Configuration

The shared backend URL is defined once in `VoxIOS/AppConfiguration.swift`. Authentication cookies use the persistent default WebKit data store, so a user remains signed in between launches. Camera and microphone permission is granted only to the configured Vox backend origin.

## Reminder alerts

Tap **Enable iPhone alerts** in Reminders and allow notifications. The app then schedules each upcoming reminder as a local iPhone notification, so it alerts you even when Vox is closed. Reminders created elsewhere, such as on the Mac, are scheduled the next time you open the app.

## Place reminders

Reminders such as “when I get home” are armed here as iOS location notifications. Save places from **Reminders → Places on this iPhone**. They are stored only in this iPhone's Keychain. Vox asks for “While Using the App” location access, and iOS watches the places itself. Notifications include **Mark as done**.

## Pairing with Vox Desktop

Inside the app, tap the QR button in the header and scan the pairing code shown in Vox Desktop. (The Camera app would open the link in Safari instead, and Safari's storage is separate from the app's.) The app keeps the pairing in the iPhone Keychain, so it survives restarts. Vox Desktop supports one paired phone at a time, so pairing the app replaces any earlier pairing, such as one made in Safari.

The web project is not imported or duplicated in this folder. All iOS-specific code stays here.

