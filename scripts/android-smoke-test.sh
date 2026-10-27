#!/usr/bin/env bash
# CI smoke test, run on an Android emulator: install the APK, launch it, check the library page
# loaded inside the app, press Back, and save a screenshot. Usage: scripts/android-smoke-test.sh app.apk
set -u
APK="$1"; PKG=com.techtool4u.gameparlor; fail=0

adb install -r "$APK" || exit 1
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
sleep 25

adb exec-out screencap -p > smoke-index.png
adb logcat -d > logcat.txt
echo "--- app log (Capacitor / WebView console / crashes) ---"
grep -E "Capacitor|chromium|AndroidRuntime|FATAL" logcat.txt | tail -80

if grep -q "app-shell ready index.html" logcat.txt; then echo "PASS: library page loaded and app-shell is active"; else echo "FAIL: app-shell never reported the library page"; fail=1; fi
if grep -qE "FATAL EXCEPTION|AndroidRuntime: Process: $PKG" logcat.txt; then echo "FAIL: the app crashed"; fail=1; else echo "PASS: no crash"; fi
if grep -E "Capacitor/Console.*(Error|Uncaught)" logcat.txt; then echo "FAIL: JavaScript errors on the page"; fail=1; else echo "PASS: no JavaScript errors"; fi
if adb shell pidof "$PKG" >/dev/null; then echo "PASS: app is running"; else echo "FAIL: app is not running"; fail=1; fi

# Back on the library screen should leave the app.
adb shell input keyevent KEYCODE_BACK
sleep 4
if adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | grep -q "$PKG"; then
  echo "FAIL: Back on the library did not leave the app"; fail=1
else
  echo "PASS: Back on the library leaves the app"
fi
exit $fail
