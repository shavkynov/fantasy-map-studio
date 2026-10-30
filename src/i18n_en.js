// Английский словарь для строк из JS и для каталогов. FM.T(ru, ...args) ищет русский текст целиком; {0}, {1} — подстановки.
// Каталоги (ресурсы, государства, расы…) переводятся по id: FM.localizeCatalogs(lang) подменяет поля, запоминая русский оригинал.
(function (FM) {
  'use strict';
  FM.EN_JS = {
    'Для календаря': 'For the calendar',
    'Приливы': 'Tides', 'Сильный прилив и отлив': 'Strong tides', 'Осушка при отливе': 'Tidal flats at low tide', '{0} м': '{0} m',
    'Подобрать по карте': 'Pick for this map', 'Заново подобрать планету под текущие seed и размер мира': 'Re-pick the planet for the current seed and world size',
    'Выгрузка мира в файл для приложения-календаря. Доля воды и города с широтами берутся с карты; параметры планеты подбираются под seed и размер мира (с условиями для жизни) и ничего на карте не меняют. Можно править вручную; пустое поле в файл не попадает.': 'Export the world to a file for the calendar app. The water share and cities (with latitudes) come from the map; planet parameters are picked from the seed and world size (within livable limits) and change nothing on the map. You can edit them; empty fields are left out of the file.',
    'Выгрузка мира в файл для приложения-календаря. Из карты берутся доля воды и города с широтами; параметры планеты вводятся здесь и на карту не влияют. Пустое поле в файл не попадает.': 'Export the world to a file for the calendar app. The water share and cities (with latitudes) come from the map; planet parameters are entered here and do not affect the map. Empty fields are left out of the file.',
    'Название мира': 'World name', 'по умолчанию — seed': 'default: the seed',
    'Радиус планеты, км': 'Planet radius, km', '(Земля 6371)': '(Earth 6371)', 'Плотность, г/см³': 'Density, g/cm³', '(Земля 5,51)': '(Earth 5.51)',
    'Оборот вокруг оси, земных часов': 'Rotation period, Earth hours', 'Год, земных суток': 'Year, Earth days', 'Наклон оси, ° (0–90)': 'Axial tilt, ° (0–90)',
    'Луны: название и период обращения, земных суток': 'Moons: name and orbital period, Earth days', '+ Луна': '+ Moon', 'Выгрузить для календаря': 'Export for calendar',
    'Название': 'Name', 'период, сут': 'period, days', 'Убрать луну': 'Remove moon', 'Луна {0}': 'Moon {0}',
    'Выгружено: вода {0}%, мест {1}, лун {2}': 'Exported: water {0}%, places {1}, moons {2}',

    ' (задано {0})': ' (set: {0})',
    'Суша: {0}%   Материков: {1}{2}   Плит: {3}   Государств: {4}': 'Land: {0}%   Continents: {1}{2}   Plates: {3}   States: {4}',
    'Городов: {0}   Дорог: {1}': 'Cities: {0}   Roads: {1}',
    'Генерация: {0} мс   Отрисовка: {1} мс': 'Generation: {0} ms   Render: {1} ms',
    'Клик по суше — падение метеорита: кратер с валом, у больших — горка в центре; часть кратеров с озером. Размер — ползунком.': 'Click on land to drop a meteorite: a crater with a rim, a central peak for big ones; some craters hold a lake. Size is set with the slider.',
    'Протяните от точки на суше в нужную сторону. От берега — длинный залив (очень длинный — сквозной пролив), из глубины суши — рифтовая долина с цепью озёр. Длина — по протяжке.': 'Drag from a point on land in the wanted direction. From the coast it makes a long gulf (a very long one — a through strait); from deep inland, a rift valley with a chain of lakes. Length follows the drag.',
    'Клик на высоком месте — каньон потечёт вниз по склону к морю; реки пойдут по его дну.': 'Click on high ground: a canyon runs downslope to the sea; rivers follow its floor.',
    'Клик рядом с вулканом — он взрывается: круглая котловина (часто с озером), вулкан гаснет. Вдали от вулканов — просто кальдера в точке клика.': 'Click near a volcano: it explodes, leaving a round basin (often with a lake) and the volcano goes out. Far from volcanoes, it is simply a caldera at the click point.',
    'Клик по суше у берега — овальный провал: круглый залив или внутреннее море. Размер — ползунком.': 'Click on land near the coast: an oval collapse — a round gulf or an inland sea. Size is set with the slider.',
    'метеорит': 'meteorite', 'раскол': 'rift', 'каньон': 'canyon', 'кальдера': 'caldera', 'провал': 'collapse',
    'Добавлено вручную: {0} ({1})': 'Added manually: {0} ({1})',
    'Вручную ничего не добавлено.': 'Nothing added manually.',
    'Здесь не получилось: {0} требует подходящего места (суша{1}).': 'Not possible here: a {0} needs a suitable place (land{1}).',
    ', ближе к берегу': ', closer to the coast',
    ', кликните выше по склону и дальше от берега: каньону нужен спуск к морю': ', click higher up the slope and farther from the coast: a canyon needs a descent to the sea',
    'Раскол: протяните линию от точки в нужную сторону.': 'Rift: drag a line from a point in the wanted direction.',
    ' · вариант {0} · {1} мс': ' · variant {0} · {1} ms',
    'Подписи: {0}': 'Labels: {0}', 'при зуме': 'on zoom', 'всегда': 'always', 'нет': 'none',
    'Размер/мощность': 'Size / power', 'Удалить': 'Delete',
    'Культура: влияет на выбор мест для городов': 'Culture: affects where cities are placed',
    'Раса: определяет звучание названий государства и его городов': 'Race: sets the sound of the state\'s and its cities\' names',
    'Тип государства: размер, число городов, культура': 'State type: size, number of cities, culture',
    'Клик по пустому месту — новая деревня (тип меняется справа). Тяните значок, чтобы перенести. ПКМ — удалить. Расставленные вручную города не пропадают при авто-расстановке.': 'Click an empty spot for a new village (change the type on the right). Drag an icon to move it. Right-click deletes. Hand-placed cities survive auto-placement.',
    'Клики — точки пути, он сам обходит горы и реки (на переправах ставятся мосты). Двойной клик или Enter — готово, Backspace — шаг назад, Esc — отмена. ПКМ по дороге — удалить.': 'Clicks add path points; the road avoids mountains and rivers by itself (bridges are built at crossings). Double-click or Enter finishes, Backspace steps back, Esc cancels. Right-click a road to delete it.',
    'Клик по государству — справка о нём (название, тип, раса, столица, города, площадь, ресурсы). Новые столицы создаются инструментом «Столица».': 'Click a state for its info (name, type, race, capital, cities, area, resources). New capitals are made with the "Capital" tool.',
    'Клик по суше — новая столица. Тяните столицу, чтобы перенести. ПКМ — удалить. Территории вырастают сами и останавливаются на хребтах и реках.': 'Click on land for a new capital. Drag a capital to move it. Right-click deletes. Territories grow by themselves and stop at ridges and rivers.',
    'Клики — точки границы (путь сам ищет хребты и реки). Двойной клик или Enter — готово, Backspace — шаг назад, Esc/ПКМ — отмена. Граница должна идти от берега до берега или до другой границы. ПКМ по готовой границе — удалить.': 'Clicks add border points (the path finds ridges and rivers itself). Double-click or Enter finishes, Backspace steps back, Esc / right-click cancels. A border must run from coast to coast or to another border. Right-click a finished border to delete it.',
    'Выберите государство в списке и закрашивайте. Shift — стереть правку. Правки кисти сохраняются при пересчёте.': 'Pick a state in the list and paint. Shift erases the edit. Brush edits survive recalculation.',
    'ледники': 'glaciers', 'тундра': 'tundra', 'тайга': 'taiga', 'леса': 'forests', 'равнины': 'plains', 'пустыни': 'deserts', 'саванна': 'savanna', 'джунгли': 'jungle', 'болота': 'swamps', 'горы': 'mountains',
    'столица': 'capital', 'города': 'cities', 'городки': 'towns', 'деревни': 'villages', 'порты': 'ports', 'крепости': 'fortresses', 'рудники': 'mines', 'руины': 'ruins',
    ' (глубокие: {0})': ' (deep: {0})', '. Главные: {0}': '. Main: {0}', 'бедна месторождениями': 'poor in deposits',
    'Тип': 'Type', 'Раса': 'Race', 'Столица': 'Capital', 'Поселения': 'Settlements', '(всего {0})': '(total {0})', 'Площадь': 'Area',
    '{0} клеток, {1}% суши': '{0} cells, {1}% of land', 'Земли': 'Lands', 'Ресурсы': 'Resources',
    'Сохранено: {0}': 'Saved: {0}', 'Файл не удалось прочитать.': 'Could not read the file.',
    'Это не файл мира Fantasy Map Studio.': 'This is not a Fantasy Map Studio world file.',
    'Загружен мир «{0}»': 'World loaded: "{0}"',
    'авто': 'auto', 'Авто': 'Auto',
    ' — генерация до минуты и больше': ' — generation takes a minute or more', ' — генерация 5–20 с': ' — generation takes 5–20 s',
    ' · для {0} континентов тесновато, лучше «Авто»': ' · cramped for {0} continents, "Auto" is better',
    'очень редко': 'very rare', 'редко': 'rare', 'обычно': 'normal', 'обильно': 'abundant', 'очень обильно': 'very abundant',
    'Нажмите, чтобы выбрать отдельные виды: {0}': 'Click to pick individual kinds: {0}',
    'Сначала создайте государства (вид «Страны» → Авто-расстановка).': 'Create states first (the "States" view → Auto-place).',
    // легенда
    'Государства': 'States', 'Поселения ': 'Settlements', 'Город': 'City', 'Городок': 'Town', 'Деревня': 'Village', 'Порт': 'Port', 'Крепость': 'Fortress', 'Рудник': 'Mine', 'Руины': 'Ruins',
    'Обозначения': 'Symbols', 'Граница государства': 'State border', 'Дорога': 'Road', 'Река': 'River', 'Морской путь': 'Sea route',
    'Тёплое течение': 'Warm current', 'Холодное течение': 'Cold current', 'Полярный лёд': 'Polar ice',
    'Кратер, кальдера': 'Crater, caldera', 'Раскол, каньон': 'Rift, canyon', 'Провал суши': 'Land collapse',
    'Ничьи земли': 'Unclaimed land', 'Спорные земли': 'Disputed land',
    'Глубина': 'Depth', 'Шельф (до 200 м)': 'Shelf (to 200 m)', 'Континентальный склон (≈1000 м)': 'Continental slope (≈1000 m)', 'Ложе океана (≈3000 м)': 'Ocean floor (≈3000 m)',
    'Абиссальная равнина (≈5000 м)': 'Abyssal plain (≈5000 m)', 'Жёлоба (глубже 7000 м)': 'Trenches (deeper than 7000 m)', 'Суша (затемнена)': 'Land (dimmed)',
    'Геология дна': 'Seabed geology', 'Срединный хребет и рифтовая долина': 'Mid-ocean ridge and rift valley', 'Трансформный разлом, зона разломов': 'Transform fault, fracture zone',
    'Глубоководный жёлоб (зубцы — к надвигающейся плите)': 'Deep-sea trench (teeth point to the overriding plate)', 'Вулканическая дуга, подводный вулкан': 'Volcanic arc, undersea volcano',
    'Подводная гора, гайот': 'Seamount, guyot', 'Горячая точка: цепь гор (возраст в млн лет)': 'Hotspot: seamount chain (age in Ma)', 'Океаническое плато': 'Oceanic plateau',
    'Подводный каньон и конус выноса': 'Submarine canyon and fan', 'Гидротермальный источник («чёрный курильщик»)': 'Hydrothermal vent ("black smoker")', 'Холодный метановый источник': 'Cold methane seep',
    'Изобаты: 200 м (кромка шельфа), 1000, 2000 …': 'Isobaths: 200 m (shelf edge), 1000, 2000 …', 'Жизнь': 'Life', 'Береговой риф': 'Fringing reef', 'Барьерный риф (за ним лагуна)': 'Barrier reef (lagoon behind it)',
    'Атолл на оседающем вулкане': 'Atoll on a sinking volcano', 'Заросли ламинарии (холодные берега)': 'Kelp forest (cold coasts)', 'Морская трава (спокойное мелководье)': 'Seagrass (calm shallows)',
    'Богатая рыбой банка (апвеллинг)': 'Fish-rich bank (upwelling)', 'Ресурсы дна': 'Seabed resources', 'Тёмное кольцо — глубокая, трудная добыча': 'Dark ring — deep, hard extraction',
    // статичный HTML без ключей
    'Fantasy Map Studio — Александра Шавкунова': 'Fantasy Map Studio — by Alexander Shavkunov', 'Александра Шавкунова': 'by Alexander Shavkunov',
    'Суша затемнена. Структуры размещены по тектонике мира: хребты — на расходящихся границах плит, жёлоба и дуги — на сходящихся, цепи гор — вдоль движения плиты над горячей точкой. Легенда — кнопка внизу.': 'Land is dimmed. Features follow world tectonics: ridges on divergent plate boundaries, trenches and arcs on convergent ones, seamount chains along the plate\'s motion over a hotspot. Legend — the button below.',
    'Ресурсы задаются при создании мира («Новый мир…»). Кружки — категории, тёмное кольцо — трудная добыча (глубокие шахты).': 'Resources are set when creating a world ("New world…"). Circles are categories; a dark ring means hard extraction (deep mines).',
    'Тяните центр — перемещается плита (стыки плит задают горы, рифты и дуги). Двойной клик по центру — меняет тип коры.': 'Drag the center to move a plate (plate boundaries define mountains, rifts and arcs). Double-click the center to change the crust type.',
    'Крепостная стена, башни': 'City wall, towers', 'Ворота': 'Gate', 'Мост': 'Bridge', 'Причал, лодка': 'Pier, boat', 'Ветряная мельница': 'Windmill', 'Поле, огород': 'Field, garden',
    'Сад, усадьба': 'Orchard, manor', 'Кладбище': 'Cemetery', 'Храм, часовня': 'Temple, chapel', 'Замок, цитадель': 'Castle, citadel', 'Площадь, фонтан': 'Square, fountain',
    'Холм, скальный выход': 'Hill, rock outcrop', 'Штольня (шахта)': 'Adit (mine)', 'Сторожевая башня': 'Watchtower', 'Улица, переулок': 'Street, lane', 'Квартал (застройка)': 'Block (buildings)',
    'Колесо мыши — масштаб, перетаскивание — сдвиг (при приближении). Выберите объект и кликните по карте: он ляжет вдоль ближайшей улицы (R — повернуть, Shift+клик — крупнее). ПКМ — удалить свой объект. Масштаб: колесо мыши или +/−. Прокрутка: перетаскивание, полосы справа и снизу, стрелки/WASD, клик по миникарте. Планировка строится по дорогам, рекам и морю мировой карты: ворота стоят там, где в город входят дороги.': 'Mouse wheel zooms, dragging pans (when zoomed in). Pick an object and click the map: it lies along the nearest street (R rotates, Shift+click makes it larger). Right-click deletes your own object. Zoom: wheel or +/−. Scroll: drag, side and bottom bars, arrows/WASD, click the minimap. The layout follows the world map\'s roads, rivers and sea: gates stand where roads enter the city.',
    'Размер растёт с числом континентов, чтобы они свободно помещались': 'Size grows with the number of continents so they fit freely',
    '1440×960: генерация и отрисовка заметно дольше': '1440×960: generation and rendering take noticeably longer',
    '0 — игнорировать; выше — города и дороги обходят вулкан, селятся на плодородном пепле, у склонов появляются сера/обсидиан и погребённые руины': '0 — ignore; higher — cities and roads avoid the volcano, settle on fertile ash, with sulfur/obsidian and buried ruins on its slopes',
    'Закрыть': 'Close', 'Вписать (0)': 'Fit (0)', 'Отдалить (−)': 'Zoom out (−)', 'Приблизить (+, колесо мыши)': 'Zoom in (+, mouse wheel)',
    'Колесо — масштаб; перетаскивание — пробел+мышь или средняя кнопка': 'Wheel zooms; pan with Space+mouse or the middle button',
    'Подписи улиц и районов: при увеличении / всегда / скрыть': 'Street and district labels: on zoom / always / hidden',
    'Другая планировка (расставленные вручную объекты сохраняются)': 'Another layout (hand-placed objects are kept)',
    'Убрать расставленные вручную объекты': 'Remove hand-placed objects',
    'Континентов:': 'Continents:', 'Островных групп:': 'Island groups:', 'Суши:': 'Land:', 'Древних эпох:': 'Ancient epochs:',
    'Суша': 'Land', 'Мазки добавляют или убирают сушу; карта пересчитывается только после «Применить», и то лишь вокруг правки. Берег строится сам: рваный, с заливами и полуостровами, у новой суши — мелководье. Клик — остров или бухта, протяжка — полуостров, перешеек, пролив.': 'Strokes add or remove land; the map is recalculated only after "Apply", and only around the edit. The coast builds itself: ragged, with bays and peninsulas, and shallows around new land. Click makes an island or a bay, dragging makes a peninsula, isthmus or strait.',
    'радиус {0} кл.': 'radius {0} cells', 'плавный': 'smooth', 'умеренный': 'moderate', 'рваный': 'ragged',
    'Нарисуйте мазок: он появится как цветной след, карта пока не изменится.': 'Draw a stroke: it appears as a coloured trail; the map does not change yet.',
    'Обзор': 'Browse', 'Правка карты': 'Edit map', 'Государства и города': 'States and cities', 'Размер кисти': 'Brush size', 'Берег': 'Coast', 'остров': 'island', 'материк': 'continent',
    'Клик': 'Click', 'Протяжка': 'Drag', '— остров или бухта': '— an island or a bay', '— полуостров, перешеек, пролив': '— a peninsula, isthmus or strait', '— обратное действие на один мазок': '— the opposite action for one stroke',
    '[ ] — размер · Enter — применить · Esc — сбросить · Ctrl+Z — отменить': '[ ] — size · Enter — apply · Esc — discard · Ctrl+Z — undo',
    'Мазок добавляет сушу': 'The stroke adds land', 'Мазок убирает сушу (получается залив, пролив или озеро)': 'The stroke removes land (making a bay, strait or lake)', 'Добавить или убрать сушу: острова, полуострова, проливы': 'Add or remove land: islands, peninsulas, straits',
    'Снять последний мазок или последнюю применённую правку': 'Undo the last stroke or the last applied edit', 'Для этого вида размер не задаётся: длина раскола — по протяжке, каньон идёт вниз по склону.': 'No size for this kind: a rift\'s length follows the drag, and a canyon runs downslope.',
    'Слои и стиль': 'Layers and style', 'Отменить': 'Undo', 'Убрать все': 'Remove all', 'Добавить': 'Add', 'Убрать': 'Remove',
    'Применить': 'Apply', 'Сбросить': 'Discard', 'Пересчитать только затронутое: остальная карта, государства, города и дороги вне зоны правки не меняются': 'Recalculate only the affected area: the rest of the map, states, cities and roads outside the edit stay unchanged', 'Сбросить неприменённые мазки': 'Discard strokes not yet applied',
    'Пересчитываем затронутое': 'Recalculating the affected area', 'Мазков в очереди: {0}. Нажмите «Применить», чтобы пересчитать карту.': 'Strokes queued: {0}. Press "Apply" to recalculate the map.', 'Уже применено: {0}': 'Already applied: {0}', 'Применено мазков: {0}': 'Strokes applied: {0}',
    'Добавить сушу': 'Add land', 'Убрать сушу': 'Remove land', 'Кисть': 'Brush', 'Изрезанность берега': 'Coast ruggedness', 'Убрать все правки суши': 'Remove all land edits',
    'Правок суши пока нет.': 'No land edits yet.',
    'Дом': 'House', 'Усадьба': 'Manor', 'Храм': 'Temple', 'Башня': 'Tower', 'Колодец': 'Well', 'Лавка': 'Stall', 'Дерево': 'Tree'
  };
  // каталоги: id -> поле -> английский текст
  const L = (label, why) => ({ label, why });
  FM.EN_CAT = {
    RESOURCES: { metal: 'Metals', stone: 'Stone and minerals', fuel: 'Fuel', timber: 'Timber', luxury: 'Luxury goods', sea: 'Sea fisheries', agri: 'Farming and livestock', special: 'Fantasy resources' },
    ACCESS: [null, { label: 'surface', short: 'surf.', how: 'placers, outcrops, gathering — no mines' }, { label: 'shallow', short: 'shall.', how: 'quarry, shallow adits' }, { label: 'deep', short: 'deep', how: 'timbered shafts with drainage' }, { label: 'ultra-deep', short: 'u-deep', how: 'ultra-deep or dangerous works' }],
    STATE_TYPES: { empire: 'Empire', kingdom: 'Kingdom', republic: 'Merchant republic', nomads: 'Nomad union', clans: 'Highland clans', tribes: 'Tribal union' },
    CULTURES: { realistic: 'Realistic', highland: 'Highlanders', woodland: 'Woodlanders', seafarers: 'Seafarers', steppe: 'Steppe folk' },
    RACES: { human: 'Humans', elf: 'Elves', dwarf: 'Dwarves', orc: 'Orcs' },
    CATASTROPHES: {
      meteor: ['Meteorites', 'Craters with a rim; some hold a lake, big ones have a central peak'],
      rift: ['Rifts', 'Narrow faults: long gulfs from the coast, rift valleys with a chain of lakes, rarely a through strait'],
      canyon: ['Canyons', 'Winding gorges downslope to the sea; rivers run along the floor'],
      caldera: ['Calderas', 'A volcano exploded: a round basin in its place, often with a lake'],
      subsidence: ['Land collapses', 'Oval subsidence near the coast: round gulfs and inland seas']
    },
    SEABED_RES: {
      oil: L('Oil', 'sedimentary basin of a passive margin with a thick shelf and river deltas'), gas: L('Natural gas', 'deep parts of sedimentary basins, the shelf slope'),
      hydrate: L('Gas hydrates', 'slope at 500–2500 m near cold seeps: low temperature and high pressure'), nodules: L('Polymetallic nodules', 'abyssal plains of old crust, very slow sedimentation'),
      sulfide: L('Sulfide ores (copper, zinc, gold)', 'hydrothermal fields of mid-ocean ridges and island arcs'), crust: L('Cobalt crusts', 'slopes of seamounts and guyots swept by currents'),
      phosph: L('Phosphorites', 'outer shelf of upwelling zones: dead biomass'), placer: L('Marine placers (tin, gold, gems)', 'shelf near big river mouths: heavy minerals washed down from the mountains')
    },
    KINDS: {
      iron: L('Iron', 'ancient shields and mountain belts; bog ore in swampy lowlands'), copper: L('Copper', 'plate-collision mountain belts and volcanic arcs'), tin: L('Tin', 'granites of ancient shields (and their river placers)'),
      lead: L('Lead and zinc', 'sedimentary strata near mountain belts (next to limestone)'), silver: L('Silver', 'veins of young belts, especially near volcanoes'), gold: L('Gold', 'quartz veins of young belts; placers in rivers rising in the mountains'),
      granite: L('Granite', 'intrusive massifs of ancient shields'), marble: L('Marble', 'metamorphosed limestones in mountain belts'), limestone: L('Limestone', 'sedimentary plains of warm seas, near coasts and former basins'),
      sandstone: L('Sandstone', 'arid basins and desert plateaus'), slate: L('Slate', 'weakly metamorphosed strata on belt slopes'), clay: L('Clay', 'river floodplains and lake lowlands'),
      salt: L('Salt', 'drying lagoons, salt flats of arid lowlands; rock salt in basins'), sulfur: L('Sulfur', 'fumaroles and volcano slopes'), obsidian: L('Obsidian', 'solidified acidic lavas of volcanic regions'),
      coal: L('Hard coal', 'coal basins: humid lowlands near mountain belts (ancient swamp forests)'), peat: L('Peat', 'cold wet lowlands and bogs'), oil: L('Oil and bitumen', 'sedimentary basins on dry lowlands by the sea (tar seeps on the surface)'),
      oak: L('Oak and beech', 'broadleaf forests of the temperate zone'), pine: L('Pine and spruce', 'taiga and coniferous mountain slopes'), hardwood: L('Tropical hardwoods (teak, ebony)', 'humid tropical forests'),
      masts: L('Ship timber', 'tall conifers along rivers and coasts (floating)'), bamboo: L('Bamboo and reeds', 'warm humid lowlands and swamps'),
      gems: L('Gemstones', 'pegmatites and contact zones of young belts, pipes in ancient shields'), wine: L('Wine', 'warm sunny slopes with moderate humidity'), spices: L('Spices', 'the hot humid belt'),
      furs: L('Furs', 'cold forests and tundra'), silk: L('Silk', 'warm humid river valleys with mulberry'), amber: L('Amber', 'coasts of the temperate north, conifer resin washed out by the sea'),
      incense: L('Incense and resins', 'hot dry uplands and savannas'), ivory: L('Ivory', 'savannas with large fauna'), dyes: L('Dyes (indigo, purple)', 'warm coasts and humid tropics'),
      fish: L('Fishing banks', 'wide shelf; cold currents lift nutrient-rich water'), whales: L('Whaling and sealing', 'cold polar and subpolar waters'), pearls: L('Pearls', 'warm shallow lagoons'),
      coral: L('Corals and sponges', 'warm clear tropical shallows'), mithril: L('Mithril', 'ancient cores of mountain chains, deeper than any ore vein'), adamant: L('Adamantite', 'volcano roots — where magma lifts material from the depths'),
      mana: L('Mana crystals', 'shear lines and plate collisions — "lines of power"'), springs: L('Healing springs', 'springs at mountain feet feeding rivers'), silverwood: L('Silverwood', 'ancient humid temperate forests'),
      dragonbone: L('Dragon bone', 'valleys of fire-breathing mountains — ancient nesting grounds'), starfall: L('Meteoric iron', 'fallen stars — impact sites do not depend on geology'),
      mercury: L('Mercury (cinnabar)', 'hydrothermal veins of volcanic belts and hot springs'), nickel: L('Nickel', 'ancient shields and ultramafic massifs'), cobalt: L('Cobalt', 'copper-nickel zones on the edges of ancient shields (blue pigment and alloys)'),
      platinum: L('Platinum', 'placers in rivers eroding ancient ultramafic massifs'), ironsand: L('Iron sands', 'black beaches near volcanoes and eroding ancient shields'), gypsum: L('Gypsum and alabaster', 'evaporated shallow basins of dry lowlands'),
      chalk: L('Chalk', 'sediments of warm shallow seas, now coastal plains'), flint: L('Flint', 'nodules in chalk and limestone strata'), basalt: L('Basalt', 'solidified lava flows of volcanic plateaus'),
      quartz: L('Quartz and rock crystal', 'veins and pegmatites in mountain belts and shields'), kaolin: L('Kaolin (white clay)', 'weathered granites of warm humid climate'), jade: L('Jade', 'serpentinite zones of young mountain belts, river pebbles'),
      saltpeter: L('Saltpeter', 'dry caves and guano in hot deserts'), alum: L('Alum', 'hydrothermally altered rocks of volcano slopes'), pumice: L('Pumice', 'volcanic ashfalls and floating pumice at coasts'),
      ochre: L('Ochre and pigments', 'iron-rich weathering crusts of warm savannas and plains'), glasssand: L('Glass sand', 'quartz beaches and dunes'), lignite: L('Brown coal', 'young peat basins of temperate lowlands'),
      gas: L('Natural gas ("eternal fires")', 'oil basins and swampy lowlands'), oilshale: L('Oil shale', 'sedimentary basins with ancient organic mud'), asphalt: L('Asphalt lakes', 'oil seeps on the surface in hot dry basins'),
      cedar: L('Cedar and cypress', 'warm mountain forests of moderate humidity'), yew: L('Yew (bows)', 'humid broadleaf forests of the temperate zone'), cork: L('Cork oak', 'warm dry Mediterranean-type forests near coasts'),
      rubber: L('Rubber and resin trees', 'hot humid tropical forests'), mangrove: L('Mangroves', 'warm muddy coasts'), birch: L('Birch and birch bark', 'cold forests and forest-tundra'), willow: L('Willow and osier', 'temperate river floodplains'),
      grain: L('Grain (wheat, barley)', 'fertile temperate plains with enough moisture'), rice: L('Rice', 'warm floodable lowlands and river deltas'), millet: L('Millet and sorghum', 'warm semi-arid plains and savannas'),
      horses: L('Horses', 'steppes and meadow plains with year-round forage'), cattle: L('Cattle', 'grassy lowlands with enough moisture'), sheep: L('Sheep and wool', 'cool uplands and hills with meadows'),
      camels: L('Camels', 'hot deserts and dry savannas'), reindeer: L('Reindeer', 'tundra and forest-tundra'), flax: L('Flax and hemp', 'cool humid plains'), cotton: L('Cotton', 'hot river valleys with irrigation'),
      olives: L('Olives and figs', 'dry hot summers and mild winters by warm seas'), dates: L('Date palms (oases)', 'oases and river valleys in hot deserts'), tea: L('Tea', 'warm humid foothill slopes'),
      coffee: L('Coffee', 'tropical uplands with humid climate'), cacao: L('Cocoa', 'the hot humid equatorial belt'), sugar: L('Sugar cane', 'hot humid lowlands along rivers'), saffron: L('Saffron', 'dry uplands with hot summers and cold winters'),
      honey: L('Honey and wax', 'flowering forests and meadows'), lapis: L('Lapis lazuli', 'metamorphosed limestones of dry highlands'), oysters: L('Oysters and shellfish', 'shallows of temperate and warm seas'),
      kelp: L('Kelp and seaweed', 'cool shallows and cold currents'), walrus: L('Walrus ivory and pinnipeds', 'ice edge of Arctic coasts'), ambergris: L('Ambergris', 'sperm whale remains on warm and temperate shores (a rare find)'),
      caviar: L('Sturgeon and caviar', 'mouths of big rivers of cool seas'), turtles: L('Tortoiseshell', 'warm tropical lagoons and beaches'), aether: L('Aether crystals', 'summits of the highest ranges — closest to the celestial sphere'),
      sunstone: L('Sunstone', 'scorching deserts where sand fuses into gem glass'), frostiron: L('Cold iron', 'permafrost and glacial uplands'), stormglass: L('Storm glass', 'cold stormy shores where lightning melts the sand'),
      phoenixash: L('Phoenix ash', 'craters of active volcanoes'), dreamlotus: L('Dream lotus', 'warm misty marshes')
    }
  };
  FM.T = (ru, ...a) => { const d = FM.uiTextLang === 'en' ? FM.EN_JS : null; const t = (d && d[ru]) || ru; return a.length ? t.replace(/\{(\d+)\}/g, (m, i) => a[i] !== undefined ? a[i] : m) : t; };
  // подменить поля каталогов под язык интерфейса (русский оригинал хранится в _ru)
  FM.localizeCatalogs = (lang) => {
    const en = lang === 'en', C = FM.EN_CAT;
    const setf = (o, f, v) => { if (!o) return; if (o['_ru_' + f] === undefined) o['_ru_' + f] = o[f]; o[f] = en && v != null ? v : o['_ru_' + f]; };
    for (const k in C.RESOURCES) setf(FM.RESOURCES && FM.RESOURCES[k], 'label', C.RESOURCES[k]);
    for (const k in C.STATE_TYPES) setf(FM.STATE_TYPES && FM.STATE_TYPES[k], 'label', C.STATE_TYPES[k]);
    for (const k in C.CULTURES) setf(FM.CULTURES && FM.CULTURES[k], 'label', C.CULTURES[k]);
    for (const k in C.RACES) setf(FM.RACES && FM.RACES[k], 'label', C.RACES[k]);
    (FM.CATASTROPHES || []).forEach(o => { const t = C.CATASTROPHES[o.id]; if (t) { setf(o, 'label', t[0]); setf(o, 'hint', t[1]); } });
    for (const k in C.SEABED_RES) { setf(FM.SEABED_RES && FM.SEABED_RES[k], 'label', C.SEABED_RES[k].label); setf(FM.SEABED_RES && FM.SEABED_RES[k], 'why', C.SEABED_RES[k].why); }
    (FM.RES_KIND_LIST || []).forEach(o => { const t = C.KINDS[o.id]; if (t) { setf(o, 'label', t.label); setf(o, 'why', t.why); } });
    if (FM.ACCESS) FM.ACCESS.forEach((o, i) => { const t = C.ACCESS[i]; if (o && t) for (const f of ['label', 'short', 'how']) setf(o, f, t[f]); });
  };
})(window.FM = window.FM || {});
