#!/bin/bash
cd "$(dirname "$0")" || exit 1
echo "=== Fantasy Map Studio TEST: 0.89.0-test.4blocks.2 / 4blocks-ui2 ==="
command -v node >/dev/null || { echo "Нужен Node.js 18+ (https://nodejs.org)"; read -n1 -p "Нажмите любую клавишу"; exit 1; }
node -e "const p=require('./package.json');if(p.build.productName!=='Fantasy Map Studio TEST'||p.build.extraMetadata?.buildId!=='4blocks-ui2')process.exit(1)" || { echo "Не совпала маркировка тестового пакета. Сборка остановлена."; exit 1; }
npm install || exit 1
case "$(uname -m)" in arm64) T=dist:dmg;; *) T=dist:dmg-intel;; esac
echo "Собираю TEST для этого Mac ($T). Результат: dist-test, имя содержит TEST-4blocks-ui2."
if npm run "$T"; then
  echo "Установите и запустите Fantasy Map Studio TEST, не прежнее приложение."
  echo "В главном окне должна быть плашка TEST и кнопка-ссылка Открыть четыре блока."
  open dist-test
else
  echo "Сборка TEST не выполнена. Старый установщик не является результатом этой попытки."
  exit 1
fi
read -n1 -p "Готово. Нажмите любую клавишу"
