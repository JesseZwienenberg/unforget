# Phone checklist (Samsung, Android)

Reminders are delivered by Chrome, even though Unforget has its own icon. Samsung's battery
features like to put apps to sleep, which delays or drops notifications. Do this once.

## 1. Turn notifications on in the app

1. Open Unforget. On Today, tap **Turn on notifications** in the banner (or: the dot in the
   top right → **Reminders** → **Turn on notifications**).
2. Tap **Allow** when Android asks.
3. Tap the dot in the top right → **Send a test notification**. It should arrive within a
   few seconds.

## 2. Allow notifications for Chrome and Unforget

1. Android **Settings** → **Apps** → **Chrome** → **Notifications** → **Allow notifications** on.
2. Long-press the **Unforget** icon → **App info** (ⓘ) → **Notifications** → allowed. Also allow
   **Lock screen** notifications there if you want reminders on the lock screen.

## 3. Stop Samsung from putting Chrome to sleep

1. **Settings** → **Apps** → **Chrome** → **Battery** → choose **Unrestricted**.
2. **Settings** → **Battery** → **Background usage limits**:
   - make sure **Chrome** is not in **Sleeping apps** or **Deep sleeping apps**;
   - tap **Never auto sleeping apps** → **+** → add **Chrome** (and **Unforget** if it is listed).

## 4. Things that block notifications

- **Do not disturb** and **Sleep** / **Bedtime** modes silence notifications. To let Unforget
  through: **Settings** → **Notifications** → **Do not disturb** → **App notifications** → add
  **Unforget**.
- **Power saving** mode can delay notifications while the phone is idle.

## If a reminder does not arrive

1. Open Unforget and tap the dot in the top right. **Sync** should say everything is synced.
2. Tap **Send a test notification** and read the line that appears under it:
   - "Sent to 1 device" but nothing arrives: it is a phone setting (steps 2–4 above).
   - "No device has notifications turned on": do step 1 again.
   - Any other message: send it to Claude.
