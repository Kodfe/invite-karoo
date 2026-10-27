#!/usr/bin/env python3
"""
Runs in CI right after `flutter create`, and patches the generated android/ and ios/
folders for Invite Karoo. Safe to run more than once.

  python3 tool/prepare_platforms.py [--push]

--push adds the iOS push-notification entitlement (only when Firebase is set up and
Push Notifications is enabled on the App ID in the Apple Developer portal).
"""
import os
import re
import sys
from pathlib import Path

APP_ID = "com.invitekaroo.app"
NAME = "Invite Karoo"
ROOT = Path(__file__).resolve().parent.parent
PUSH = "--push" in sys.argv


def edit(path: Path, fn):
    if not path.exists():
        print(f"  skip (missing) {path.relative_to(ROOT)}")
        return
    before = path.read_text()
    after = fn(before)
    if after != before:
        path.write_text(after)
        print(f"  patched {path.relative_to(ROOT)}")


# ───────────────────────── Android ─────────────────────────

def gradle(s: str) -> str:
    kts = "applicationId =" in s or "minSdk =" in s
    if kts:
        s = re.sub(r'applicationId\s*=\s*"[^"]+"', f'applicationId = "{APP_ID}"', s)
        s = re.sub(r"minSdk\s*=\s*[^\n]+", "minSdk = 23", s)
        if "keystoreProperties" not in s:
            s = (
                "import java.util.Properties\nimport java.io.FileInputStream\n\n"
                + s
            )
            s = s.replace(
                "android {",
                'val keystoreProperties = Properties()\n'
                'val keystorePropertiesFile = rootProject.file("key.properties")\n'
                "if (keystorePropertiesFile.exists()) {\n"
                "    keystoreProperties.load(FileInputStream(keystorePropertiesFile))\n"
                "}\n\nandroid {",
                1,
            )
            s = s.replace(
                "    buildTypes {",
                "    signingConfigs {\n"
                '        create("release") {\n'
                "            if (keystorePropertiesFile.exists()) {\n"
                '                keyAlias = keystoreProperties["keyAlias"] as String\n'
                '                keyPassword = keystoreProperties["keyPassword"] as String\n'
                '                storeFile = file(keystoreProperties["storeFile"] as String)\n'
                '                storePassword = keystoreProperties["storePassword"] as String\n'
                "            }\n"
                "        }\n"
                "    }\n\n"
                "    buildTypes {",
                1,
            )
            s = re.sub(
                r'signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)',
                'signingConfig = if (keystorePropertiesFile.exists()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")',
                s,
            )
    else:  # Groovy build.gradle (older Flutter templates)
        s = re.sub(r'applicationId\s+"[^"]+"', f'applicationId "{APP_ID}"', s)
        s = re.sub(r"minSdkVersion\s+[^\n]+", "minSdkVersion 23", s)
        s = re.sub(r"minSdk\s*=\s*[^\n]+", "minSdk = 23", s)
        if "keystoreProperties" not in s:
            s = s.replace(
                "android {",
                "def keystoreProperties = new Properties()\n"
                "def keystorePropertiesFile = rootProject.file('key.properties')\n"
                "if (keystorePropertiesFile.exists()) {\n"
                "    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n"
                "}\n\nandroid {",
                1,
            )
            s = s.replace(
                "    buildTypes {",
                "    signingConfigs {\n"
                "        release {\n"
                "            if (keystorePropertiesFile.exists()) {\n"
                "                keyAlias keystoreProperties['keyAlias']\n"
                "                keyPassword keystoreProperties['keyPassword']\n"
                "                storeFile file(keystoreProperties['storeFile'])\n"
                "                storePassword keystoreProperties['storePassword']\n"
                "            }\n"
                "        }\n"
                "    }\n\n"
                "    buildTypes {",
                1,
            )
            s = s.replace(
                "signingConfig signingConfigs.debug",
                "signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug",
            )
    return s


def manifest(s: str) -> str:
    perms = [
        "android.permission.INTERNET",
        "android.permission.CAMERA",
        "android.permission.POST_NOTIFICATIONS",
    ]
    for p in perms:
        if p not in s:
            s = s.replace("<application", f'<uses-permission android:name="{p}"/>\n    <application', 1)
    s = re.sub(r'android:label="[^"]*"', f'android:label="{NAME}"', s, count=1)
    if "<queries>" not in s:
        s = s.replace("</manifest>", """    <queries>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="http"/></intent>
        <intent><action android:name="android.intent.action.DIAL"/><data android:scheme="tel"/></intent>
        <intent><action android:name="android.intent.action.SEND"/><data android:mimeType="*/*"/></intent>
        <intent><action android:name="android.intent.action.PROCESS_TEXT"/><data android:mimeType="text/plain"/></intent>
    </queries>
</manifest>""")
    # local development against http://10.0.2.2:3000 needs cleartext; production uses https
    if "usesCleartextTraffic" not in s and os.environ.get("ALLOW_CLEARTEXT") == "1":
        s = s.replace("<application", '<application android:usesCleartextTraffic="true"', 1)
    return s


# ───────────────────────── iOS ─────────────────────────

PLIST_KEYS = {
    "CFBundleDisplayName": f"<string>{NAME}</string>",
    "NSCameraUsageDescription": "<string>Invite Karoo uses the camera to scan invitation cards and guests’ codes at the gift desk.</string>",
    "NSPhotoLibraryUsageDescription": "<string>Invite Karoo lets you pick an invitation card or a profile photo from your photos.</string>",
    "NSPhotoLibraryAddUsageDescription": "<string>Invite Karoo can save the invitation card to your photos.</string>",
    "ITSAppUsesNonExemptEncryption": "<false/>",
    "LSApplicationQueriesSchemes": "<array><string>tel</string><string>https</string><string>whatsapp</string></array>",
}


def plist(s: str) -> str:
    for k, v in PLIST_KEYS.items():
        if f"<key>{k}</key>" in s:
            s = re.sub(rf"<key>{k}</key>\s*(<string>.*?</string>|<false/>|<true/>|<array>.*?</array>)", lambda m: f"<key>{k}</key>\n\t{v}", s, count=1, flags=re.S)
        else:
            s = s.replace("<dict>", f"<dict>\n\t<key>{k}</key>\n\t{v}", 1)
    if PUSH and "<key>UIBackgroundModes</key>" not in s:
        s = s.replace("<dict>", "<dict>\n\t<key>UIBackgroundModes</key>\n\t<array><string>remote-notification</string></array>", 1)
    return s


def pbxproj(s: str) -> str:
    s = re.sub(r"PRODUCT_BUNDLE_IDENTIFIER = [^;]*RunnerTests;", f"PRODUCT_BUNDLE_IDENTIFIER = {APP_ID}.RunnerTests;", s)
    s = re.sub(r"PRODUCT_BUNDLE_IDENTIFIER = (?![^;]*RunnerTests)[^;]+;", f"PRODUCT_BUNDLE_IDENTIFIER = {APP_ID};", s)
    s = re.sub(r"IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;", "IPHONEOS_DEPLOYMENT_TARGET = 15.0;", s)
    if PUSH and "CODE_SIGN_ENTITLEMENTS" not in s:
        s = s.replace(
            "INFOPLIST_FILE = Runner/Info.plist;",
            "INFOPLIST_FILE = Runner/Info.plist;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;",
        )
    return s


def podfile(s: str) -> str:
    s = re.sub(r"^#?[ \t]*platform :ios, '[0-9.]+'[ \t]*$", "platform :ios, '15.0'", s, count=1, flags=re.M)
    return s


def main():
    print("Preparing platform folders")
    a = ROOT / "android" / "app"
    edit(a / "build.gradle.kts", gradle)
    edit(a / "build.gradle", gradle)
    edit(a / "src" / "main" / "AndroidManifest.xml", manifest)

    i = ROOT / "ios"
    edit(i / "Runner" / "Info.plist", plist)
    edit(i / "Runner.xcodeproj" / "project.pbxproj", pbxproj)
    edit(i / "Podfile", podfile)
    if PUSH:
        ent = i / "Runner" / "Runner.entitlements"
        ent.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0">\n<dict>\n\t<key>aps-environment</key>\n\t<string>production</string>\n</dict>\n</plist>\n'
        )
        print("  wrote ios/Runner/Runner.entitlements")


if __name__ == "__main__":
    main()
