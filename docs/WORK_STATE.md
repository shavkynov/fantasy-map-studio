# WORK STATE

2026-11-02. Ветка feature/natural-world-v3. Метрика воды: 169ae9a92631cd2cb58a40c23ec828d9bc77fae5. Тест пары: 927e885a3a7f2cd60191299856bd1c6fc208ce45. Grouped K4: 82927b60d2c2fc81a0cd9d9e2781495d9749306b; исправление signed-zero: 58d02cce7ad13b87077b6c35b64efb8bcee11deb.

## Сохранённое
R0: 90e8a4c. R1: aff5b68. R2: 2500244. R3a: d0e768e. R3b: aa170a2; проверка: 9cc0e03. R3c K2: данные 14b6acf, подключение c3d7e3a, checkpoint de65281. R3d K3: данные 33ed259, подключение 3d07d32, checkpoint 308462e. R3e K6: данные 460f249, подключение 8f6c75e, checkpoint 2acd5b5. Подробные SHA масок и история экспортов сохранены в checkpoint 2acd5b5.
Сферическая математика: ded6cf7; дрейф: d3b87f8; тест дрейфа: 8f6c75e; причины отказа: 57eec84. Атлас показывает плоский v4; широкие океаны визуально не приняты.

## Защита исходных масок — завершена для текущего baseline
Пять уникальных масок: vondoran-227/K2,K3,K4,K6 и talsaor-287/K4. Папка tools/fixtures/world-source; загрузчик tools/world-source-fixture.cjs. Кодек zlib/base64, uint8=id+1, 0=океан. SDF, рельеф и климат не сохраняются; cells восстанавливаются построчно. W=480/1440 одной маски не отдельные источники.
Пользовательские экспорты K2/K3/K6 проверили совпадение меток/движения с core Git blob 6cd6ab743be0b3e93fc8e2f8013ac1fa320f291d и отказы при повреждении; кандидаты независимо распакованы в Python, SHA и количества клеток совпали. Источник всех трёх vondoran-227|try1, сетка 256x171, по 14884 клетки коры.

## Пользовательские прогоны дрейфа
Команда: node tools/world-drift-test.cjs --fixture-only.
R3b 10:05 MSK: 2 источника, 5 загрузок, 10 снимков, 1235 обратных проверок.
R3c 10:55 MSK: 3 источника, 7 загрузок, 15 снимков, 1545 обратных проверок.
R3d 11:17 MSK: 4 источника, 9 загрузок, 20 снимков, 2010 обратных проверок.
R3e 11:28 MSK: frozenSources=5, fixtureLoads=11, legacyRecoveries=0, snapshots=25, provenanceRoundTrips=2940, maxRasterRelativeAreaError=0.005641059792295122 (около 0.564%, порог 3%). fullTurnOwnersEqual, uniformPolarRotationNoOverlap, sourceInputsUnchanged, collisionsExplicit — true. Все пять источников, time=0,0.5,1,2,4. Одиннадцать загрузок: шесть baseline-строк плюс пять источников для дрейфа. Во всех указанных прогонах legacyRecoveries=0.

## Причины отказа — подтверждены пользовательским запуском
Код: tools/world-frame-validity.cjs, commit 57eec84. assess(snapshot) объясняет критерий overlapCells===0: пустые reasons либо ['fragment-overlap']. Некорректные и противоречивые diagnostics вызывают ошибку. Модуль не встроен в приложение; движение, фикстуры, baseline и старый тест не менялись.
Команда: node tools/world-frame-validity.cjs. Пользовательский вывод 2026-11-02 11:35 MSK: unitChecksPassed=true, integrationRun=true, sources=5, snapshots=25, rejectedFrames=17, generatorImported=false. У 17 кадров fragment-overlap, у 8 список пуст. Восемь допустимых: все пять при time=0 плюс K2 при time=0.5,1,2. Отдельный локальный unit-only прогон ассистента прошёл до записи; пять фикстур подтверждены именно пользовательским выводом.

## Метрика воды — подтверждена пользовательским запуском
Код: tools/world-water-metric.cjs и tools/world-water-metric-test.cjs, commit 169ae9a. Спецификация и восемь значений: docs/WATER_METRIC.md.
Команда: node tools/world-water-metric-test.cjs. Пользовательский вывод 2026-11-02 15:11 MSK: unitChecksPassed=true, integrationRun=true, sources=5, snapshots=25, measuredFrames=8, skippedFrames=17, generatorImported=false. Приглашение вернулось, ошибок не показано; числовой exit code отдельно не предоставлен. Крупнейший бассейн K2 занимает около 66% площади сферы. Это не ширина океана, не выбор кадра и не визуальная приёмка. Семнадцать кадров исключены по fragment-overlap. Устаревший integration pending уже заменён.

## Управляемое движение пары — подтверждено пользователем
Код: tools/world-pair-motion-test.cjs, commit 927e885a. Только существующая vondoran-227 K2 и motions overrides; src/world-drift.js не менялся. Спецификация: docs/PAIR_MOTION.md.
Локальный изолированный Node-прогон ассистента: exit code=0, unitChecksPassed=true, integrationRun=true, sources=1, snapshots=35, provenanceRoundTrips=210, generatorImported=false. SHA копий world-domain.js, world-drift.js, world-source-fixture.cjs и world-frame-validity.cjs совпали с прочитанными файлами; K2 прошла загрузчик. Это не был полный checkout или CI.
Пользовательский Mac-прогон 2026-11-02 15:24 MSK: те же показатели, sourceInputsUnchanged=true, motionInputsUnchanged=true, явно предоставлен exit_code=0. Расхождение: 17 допустимых снимков, угол центров от 1.7777877457763895 до 2.1187389727297403 радиана. Сближение: coarse [0,0.015625], refined [0,0.00000095367431640625], overlapCells на уточнённых концах 0 и 10. Это переход растровой диагностики почти у исходного положения, не положительный интервал свободного сближения и не точное время первого физического контакта. Числа не новый baseline.

## K4 — контроль подразделения подтверждён пользователем
Код: tools/world-k4-grouped-motion-test.cjs. Описание и история: docs/K4_GROUPED_MOTION.md. Две скорости K2 наследуются четырьмя дочерними фрагментами. Независимое декодирование в Python и затем JavaScript подтвердили одинаковую сушу и parentByChild=[0,1,0,1].
Первый пользовательский запуск 15:30 MSK завершился exit_code=1: deepStrictEqual различил poses [1,0,-0,0] и [1,0,0,0]. До него была только локальная проверка синтаксиса. Исправление 58d02cce ограничено сравнением конечных компонентов через ===, без epsilon; добавлены шесть регрессий. Регрессии отдельно прошли у ассистента в Node v20.20.1.
Повторный пользовательский запуск 2026-11-02 15:33 MSK: checksPassed=true, poseComparisonUnitChecksPassed=true, integrationRun=true, sources=2, K=4, motionGroups=2, comparisons=20, snapshots=40, provenanceRoundTrips=240, groupedCoverageEqual=true, sourceInputsUnchanged=true, motionInputsUnchanged=true, generatorImported=false, exit_code=0. Все 17 opening допустимы; closing time=0 допустим, положительные отсчёты имеют 10 и 130 клеток пересечения. Это подтверждает контроль подразделения при двух группах, не независимое движение K4.

## K4 — исходное независимое движение: локальный прогон ассистента
Новый tools/world-k4-independent-motion-test.cjs использует существующую K4 без motions overrides: четыре исходных axis/rate/spin, без поиска скоростей. Спецификация и ограничения в docs/K4_GROUPED_MOTION.md. На time=0,0.5,1,2,4 проверяются все шесть относительных вращений, исходные площади, растровые площади с прежним допуском 3%, provenance и явные причины отказа. Углы — кинематическая диагностика, не новая метрика географии или воды.
Изолированный Node-прогон ассистента: exit code=0, unitChecksPassed=true, integrationRun=true, sources=1, K=4, snapshots=5, relativePairChecks=30, provenanceRoundTrips=60, validFrames=1, rejectedFrames=4, maxRasterRelativeAreaError=0.0045891914976589065, sourceInputsUnchanged=true, generatorImported=false. Клетки пересечения: 0,137,358,852,3419. Все шесть пар имеют различающиеся вращения на каждом положительном отсчёте. Это наблюдения, не новый baseline.
Копии domain/drift совпали с Git blob SHA репозитория; экспортируемые функции загрузчика и assess скопированы в изолированную среду, labels и metadata прошли загрузчик. Это не полный checkout, CI или пользовательский запуск. Пользовательский прогон нового теста ожидается. Допустимого движущегося кадра в этом наборе не найдено; о всех промежуточных временах вывода нет.

## Границы приёмки
Для ранних пользовательских прогонов дрейфа, причин отказа и воды числовые exit codes не предоставлены; для пары и повторного grouped K4 получен 0. Первый grouped K4 получил 1; история сохранена. Пользователь скачивает ZIP; git switch/pull не нужны, точный SHA архива отдельно не проверен.
Только растровая диагностика отдельных моментов: не непрерывное обнаружение столкновений, не разрешение столкновений и не оценка океанов. Для исходного движения K2 пересекается при time=4; K3/K4/K6 уже при 0.5. Управляемые опыты используют другие скорости. Полный all-cases, CI, визуальное принятие и включение движения в приложение не подтверждены. Старый fallback полного режима сохранён; текущий baseline покрыт пятью фикстурами. Эталоны и baseline автоматически не менять. Геометрия, климат и UI не смешиваются.

## Следующий единственный шаг
После записи скачать ZIP и выполнить node tools/world-k4-independent-motion-test.cjs, затем echo "exit_code=$?". При расхождении не менять фикстуры автоматически.
После подтверждения — отдельно определить дальнейшее действие для допустимого кадра: текущий набор исходного K4 даёт только time=0. Не выдавать его за найденный движущийся мир и не переходить к визуальному принятию пересекающихся кадров. Выбор кадра и визуальное сравнение остаются отдельными шагами; кора/расколы только после них. Различать код, локальный тест ассистента, пользовательский прогон, визуальную приёмку и включение в приложение.
