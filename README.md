# Game Parlor

Self-contained HTML files. No install or build step.

- `index.html` — the game library (search, filters, infinite scroll, grid / table / scroll layouts). Start here.
- `hexhaven.html` — Hexhaven, a hex-island settling and trading game vs 3 computer players.
- `checkers.html` — Checkers, vs the computer (easy / medium / hard) or 2 players on one device.
- `mancala.html` — Mancala (Kalah rules), vs the computer (easy / medium / hard) or 2 players on one device.
- `sweet-swap.html` — Sweet Swap, a match-three candy puzzle with 12 levels (score, collect and jelly goals) and saved stars.
- `lineup-detective.html` — Lineup Detective, a face-guessing deduction game vs the computer.

Open `index.html` in a browser and press **Play now** on a game. Keep all the files in the same folder so the links work.

Everything runs offline except the web fonts (loaded from Google Fonts); without internet the pages fall back to system fonts.

Favorites, the chosen library layout, your Checkers and Mancala settings and your Sweet Swap progress are saved in your browser's local storage.

## Android app

The same pages are packaged as an Android app with [Capacitor](https://capacitorjs.com/) (`android/`).

- **Get the APK:** every push that touches the games or the app runs the *Android APK* workflow (Actions tab). Open the latest run and download the `GameParlor-apk-…` artifact, unzip it, and open the `.apk` on your phone (allow "Install unknown apps" for your browser or file manager when asked). You can also start the workflow by hand with **Run workflow**.
- **What changes in the app:** `scripts/build-web.mjs` copies the pages into `www/`, downloads the fonts so the app works fully offline, and links `app-shell/` in. That adds the Android back button (closes dialogs, then returns to the library, then exits) and turns off long-press text selection. The website itself is unchanged.
- **Signing:** without secrets each build is signed with a throwaway debug key, so installing a newer APK may require uninstalling the old one first. To sign every build with the same key, create one (`keytool -genkeypair -v -keystore app.keystore -alias gameparlor -keyalg RSA -keysize 2048 -validity 10000`) and add the repository secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 app.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Keep that key safe and never commit it.
- **Build locally:** install Node 22, JDK 21 and Android Studio (for the SDK), then run `npm ci && npm run apk`. The APK lands in `android/app/build/outputs/apk/debug/`.
- **Icon:** `app-shell/icon.svg`. After changing it, regenerate the PNGs with `node scripts/make-icons.cjs` (needs Playwright).
