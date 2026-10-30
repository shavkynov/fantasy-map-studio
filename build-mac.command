#!/bin/bash
cd "$(dirname "$0")"
echo "=== Fantasy Map Studio: сборка установщика для Mac ==="
command -v node >/dev/null || { echo "Нужен Node.js 18+ (https://nodejs.org)"; read -n1 -p "Нажмите любую клавишу"; exit 1; }
npm install || exit 1
case "$(uname -m)" in arm64) T=dist:dmg;; *) T=dist:dmg-intel;; esac
echo "Собираю для этого Mac ($T). Установщик появится в папке dist"
npm run $T && open dist
read -n1 -p "Готово. Нажмите любую клавишу"
