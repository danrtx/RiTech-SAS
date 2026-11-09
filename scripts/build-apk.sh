#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MOBILE_DIR="$PROJECT_ROOT/frontend_mobile"

# ─── Validaciones ───────────────────────────────────────────────
if ! command -v flutter &>/dev/null; then
  echo "ERROR: Flutter no está instalado."
  echo "       Instálalo desde: https://docs.flutter.dev/get-started/install"
  exit 1
fi

if [ ! -f "$MOBILE_DIR/android/key.properties" ]; then
  echo "ERROR: No se encontró android/key.properties"
  echo "       Crea el archivo con las credenciales del keystore."
  exit 1
fi

if [ ! -f "$MOBILE_DIR/android/app/keystore/ritech-release.jks" ]; then
  echo "ERROR: No se encontró el keystore en android/app/keystore/ritech-release.jks"
  exit 1
fi

# ─── Build ──────────────────────────────────────────────────────
cd "$MOBILE_DIR"

echo "==> Obteniendo dependencias..."
flutter pub get

echo "==> Construyendo APK release firmado..."
flutter build apk --release --android-skip-build-dependency-validation

APK_PATH="$MOBILE_DIR/build/app/outputs/flutter-apk/app-release.apk"

if [ -f "$APK_PATH" ]; then
  SIZE=$(du -h "$APK_PATH" | cut -f1)
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  APK GENERADO EXITOSAMENTE                              ║"
  echo "╠══════════════════════════════════════════════════════════╣"
  echo "  Ruta:    $APK_PATH"
  echo "  Tamaño:  $SIZE"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
  echo "Para instalar en un dispositivo conectado:"
  echo "  flutter install"
  echo ""
  echo "O copiar el APK:"
  echo "  cp $APK_PATH ~/Desktop/RiTech.apk"
else
  echo "ERROR: No se encontró el APK generado."
  exit 1
fi
