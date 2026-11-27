# Fantasy Map Studio — справочник агента (v0.92.0)

Генератор фэнтези-миров + картографический рендерер, Rust 2021. Комментарии и UI — на русском.
`CLAUDE.md` = точная копия этого файла; правь оба.

## Правила экономии (обязательно)
- Проверка компиляции: `cargo check -p fms-core|fms-render|fms-studio` (без `--release`). Тесты/examples: добавь `--all-targets`.
- `cargo test --release`, генерацию атласов, `cargo run --release`, bundle-скрипт — **только по прямой просьбе пользователя**.
- Не читать сгенерированные SVG/PNG/JPG/PPM, `target/`, `Cargo.lock`, `fms-render/assets/` (бинарные `.rgba`, `.bin`).
- Большие файлы не читать целиком: `grep -n` по имени символа → чтение диапазона. `classic.rs` ~5000 строк; `civilization.rs`, `region.rs` ~2500; `server.rs`, `web/index.html` ~2100; `tectonic.rs` ~1700.

## Зависимости
- **Новые внешние крейты не добавлять**: алгоритмы (PNG, base64, JSON, HTTP, RNG, шум) пишутся с нуля.
- `fms-core`: зависимостей нет. `fms-render`: только `fms-core`.
- `fms-studio`: `fms-core`, `fms-render`; **исключение** — только target Windows: `tao`, `wry`, `rfd`. macOS: ObjC `src/macos.m`, собирается `build.rs` через `clang`/`ar`.

## Workspace (крейты в корне, не в `crates/`)
`fms-core` → `fms-render` → `fms-studio`
- `fms-core/` — физика планеты и мира, без UI и рендера.
- `fms-render/` — PNG и многослойный SVG.
- `fms-studio/` — сервер/API, нативные окна, фронтенд `web/index.html` (HTML+CSS+JS в одном файле, встроен через `include_str!` → после правки нужна пересборка).

## fms-core (`fms-core/src/`)

Конвейер (`planet.rs`, `generate_physical_core`): `tectonic` → `currents` + `climate` → `erosion` → повторно `currents` + `climate` → `hydrology` → `biomes` → `geography` → `resources`; затем `civilization` → `toponymy`.

API `planet.rs`:
- `generate(&tectonic::Options)`, `generate_with_options(&PlanetOptions)` — всё сразу.
- `generate_physical_with_options` — без стран/городов/дорог; `populate_civilization(&base, &CivilizationOptions) -> Planet` — населить клон (путь студии).

`PlanetOptions { tectonic: Options, climate: ClimateParams, erosion: ErosionParams, target_realms }`

`Planet { seed, grid, tectonic: World, currents, climate, erosion: ErosionResult, hydrology, biomes, geography, resources, civilization, names: WorldNames }`

| Файл | Структуры (ключевые поля) | Функции |
|---|---|---|
| `grid.rs` | `Grid {w,h,radius_km}` равнопромежуточная; поля = плоские `Vec` длины `w*h` | `idx`, `xy`, `lat_deg`, `lon_deg`, `neighbors4/8`, `spherical_dist_km` |
| `tectonic.rs` | `Options {seed,w,radius_km,activity,water_depth_km,target_continents,…}`, `World {elevation_km,thickness,margin,rift,trench,suture,…}` | `generate`, `isostasy` |
| `currents.rs` | `Currents {u,v,speed,temp_anomaly}` | `solve_with_rotation` |
| `climate.rs` | `ClimateParams {axial_tilt_deg,solar_offset_c,rotation_rate}`, `Climate {temp_c,temp_jan_c,temp_jul_c,precip_mm,aridity_index,glacier,permafrost,…}` | `compute_with_params` |
| `erosion.rs` | `ErosionParams`, `ErosionResult {elevation_km,incised_km,alluvium_km,…}` — **итоговый рельеф здесь** | `erode_with_params` |
| `hydrology.rs` | `Hydrology {is_ocean,is_lake,receiver,discharge_m3s,discharge_jan/jul_m3s,river_order,rivers,waterfalls,…}`, `River {order,cells,smoothed_pts,widths,regime,mouth}`, `Waterfall`, `FlowRegime`, `MouthKind` | `compute` |
| `biomes.rs` | `Biome` (19), `Bedrock`, `Biomes {biome,bedrock,soil_fertility}` | `classify`, `Biome::name/rgb` |
| `geography.rs` | `Geography {landmasses,lakes,bays,mountain_ranges,passes,natural_regions,marine_zone,*_id}` | `analyze` |
| `resources.rs` | `ResourceKind` (8), `Deposit`, `Resources {iron,…,fishery,deposits}` | `compute` |
| `civilization.rs` | `Civilization {habitability,livelihood,culture_id,realm_id,is_wild,cultures,settlements,wild_sites,realms,trade_routes}`; `Settlement {id,name,cell,role,tier,realm_id,*_score,trade_degree,is_port,river_access}`; `Realm`, `Culture`, `WildSite`, `TradeRoute {cells,segments: Vec<RouteKind>}`; `CivilizationOptions {include_realms,include_cities,include_routes,target_realms,salt}` | `simulate`, `simulate_with_options`, `route_land_road`, `route_sea_lane` |
| `toponymy.rs` | `WorldNames` (имена объектов `geography` и рек) | `name_world`, `settlement_name` |
| `region.rs` | `RegionOptions {center_lat/lon_deg,span_lon/lat_deg,scale 2..=16}`; `Region` — своя сетка + собственные поля рельефа/климата/гидрологии, `rivers`, `passes`, `settlements: Vec<RegionSettlement{global_id,…}>`, `roads: Vec<RegionRoad>`, `deposits` | `generate_region(&Planet,&RegionOptions)`, `route_region_road` |
| `rng.rs` | `Rng`, `Noise` — детерминированные, по seed | `Rng::sub(seed,tag)` |

Инвариант: результат детерминирован по seed и параметрам.

## fms-render (`fms-render/src/`)

Поток: `&Planet` / `&Region` по ссылке → `RenderOutput {width,height,style,base_rgb,flat_rgb,overlay: OverlayModel}`.

- `lib.rs`: `render_world(planet,seed,style)`, `render_region(planet,reg,reg_opt,seed,style)`, `*_with_options` (`RenderOptions {style,target_width,title}`); `RenderOutput::{to_png_bytes,to_base_png_bytes,write_png,to_svg_standalone,to_svg_with_image_href,write_svg_standalone}`.
- `classic.rs` — **весь фактический рендер**: `render_classic_world`, `render_classic_region`, `compose_scene` (растр + все SVG-слои), `render_classic_svg` (обёртка), `theme_of(Style) -> ClassicTheme` (палитры), `paint_base_raster`, `place_features` (горы/леса), `trace_river_polylines`/`trace_region_rivers`, `build_world_roads`/`build_region_roads`, `border_lines`, `realm_label_paths`.
- `terrain.rs`: `Style`, `RenderOptions`, `OverlayModel` и пины (`SettlementPin`, `WildSitePin`, `DepositPin`, `PoiPin`, `WaterfallPin`, `MapLabel`, `OverlayRoute`), `choose_region_window`, `trace_ocean_currents`. SVG-слои лежат строкой в `OverlayModel.classic_svg_layers`.
- `proj.rs` — **проекция Паттерсона**: `patterson_y`, `patterson_phi` (обратная), `find_optimal_seam_lon` (разрез по океану), `WorldProj::{fit,project,inverse}`; регион: `RegionProj::{new,project_cell,project_lat_lon,inverse}`. Дубликат прямой формулы в JS: `pattersonY`, `worldGeoToSvg` в `web/index.html` — менять синхронно.
- `svg.rs` — тонкий делегат в `classic::render_classic_svg`. `png.rs` — свой кодек PNG + `base64_encode`.
- `assets.rs`: `AssetPack` (спрайты). Классический рендер его **не использует** (`_pack`); `load_default_or_empty` работает и без каталога.

Стили (`Style::ALL`): `Sepia` (slug `sepia`, дефолт), `Ink` (`ink`, ч/б), `Color` (`color`). `from_slug` принимает и алиасы.

SVG: `layer-base` (растр PNG), далее группы `layer-water-detail`, `layer-ice`, `layer-rivers`, `layer-roads`, `layer-coast`, `layer-relief`, `layer-forests`, `layer-currents`, `layer-routes`, `layer-borders`, `layer-settlements`, `layer-wildsites`, `layer-pois`, `layer-deposits`, `layer-labels`, `layer-frame`, `layer-legend`.
Порядок в `compose_scene` значим; изменения слоя обычно нужны и в растре (`flat_rgb`), и в SVG.

## fms-studio (`fms-studio/`)

Один обработчик для всех платформ: `StudioApp::{handle_raw_target, handle_get}` → `StudioResponse {status,content_type,disposition,body}` (`src/server.rs`). Только GET; JSON собирается вручную.

| Платформа | Транспорт | Файлы |
|---|---|---|
| macOS | `WKWebView`, схема `fms://app/`; FFI `fms_handle_request`/`fms_free_buf`, без порта | `src/desktop.rs`, `src/macos.m` |
| Windows | `WebView2` (`wry`), custom protocol `fms` → `http://fms.localhost/`, поток 8 МБ на запрос | `src/windows_app.rs` |
| Linux / `--web` | свой HTTP на `std::net`, `127.0.0.1:7878`, открывает браузер | `serve_with_browser` |

Флаги (`src/main.rs`): `--web`, `--no-browser`, `--port|-p N`, `--host H` (любой включает веб-режим).

Сохранение файлов (JS `triggerDownload`/`saveBase64`): macOS — `messageHandlers.fmsSave {url|dataBase64, filename}` → `NSSavePanel`; Windows — `window.ipc.postMessage("SAVE_URL\n<имя>\n<url>" | "SAVE_B64\n<имя>\n<b64>")` → `rfd`; веб — обычная загрузка.

### Эндпоинты
- `/`, `/index.html`, `/favicon.ico`
- `/api/world` (JSON: размеры, `proj`, `suggested_region`, URL-ы, `realms`, `waypoints`), `/api/world/{map.png,overlay.svg,download.png,download.svg}`
- `/api/region` и те же `/api/region/{…}`
- `/api/world/project?lat&lon` → `{x,y,in_bounds}`; `/api/world/unproject?px&py` → `{lat,lon,in_bounds}`
- `/api/inspect` — карточка; `/api/route_road` — конструктор дорог

Общие параметры мира (`parse_world_opts`): `seed` (деф. `e`), `w` (90..720, деф. 360), `continents` (0..6), `activity`, `water_depth`, `tilt`, `solar`, `rotation`, `civ_realms`, `civ_cities`, `civ_routes`, `target_realms`, `civ_salt`; плюс `style`, `target_w`.
Регион: `lat|reg_lat`, `lon|reg_lon`, `span|reg_span`, `scale` (2..16); `lat`/`lon` имеют приоритет над `reg_*`.

**Карточка поселения** `/api/inspect?mode=world|region` + `settlement_id` | `lat&lon` | `px&py`.
Ответ (`build_inspect_json`): климат/рельеф/гидрология точки, `biome`, `realm_name`, `culture_name`, `nearest_*`, `resources{8}`, опционально `settlement {id (null у местных в регионе),name,tier,role,realm,lat,lon,population_score,trade_degree,resource/food/water/timber/mineral_score}`.
JS: `inspectSettlement`, `inspectPixel`, `renderInspectCard` (`#inspect-card`).

**Конструктор дорог** `/api/route_road?mode=…&from_lat&from_lon` (или `from_px&from_py`) `&to_lat&to_lon` (или `to_px&to_py`) `&allow_sea=1&target_name=`.
Без цели — дорога к ближайшим поселениям (до 4 попыток). Сначала суша, затем морской путь (при `allow_sea`).
Ответ (`build_road_json`): `{ok,is_sea,placed,from_placed,to_placed,length_km,max_elev_m,target_name,pts,geo_pts}` или `{ok:false,error}`.
Дороги и метки пользователя живут только в JS (`state.customRoads`, `state.customMarkers`, `handleRoadClick`, `renderCustomOverlays`); класс дороги `roadTier` 1..3 на сервер не передаётся.

Кэш (`StudioCache`, LRU): физические планеты 3, населённые 6, рендеры мира 6, регионов 8. Новый параметр генерации обязан попасть в ключ (`PhysWorldKey`/`CivKey`/`RenderKey`/`RegionKey`) и в `world_query_string`.

## Тесты, examples, CI
- `fms-core/tests/{planet,water,tectonic}.rs`, `fms-render/tests/render.rs`, `fms-studio/tests/api.rs`.
- Examples (по просьбе): `fms-render --example atlas -- <seed> <prefix> <sepia|ink|color|all>`; `fms-core --example planet|region` (PPM), `gen`, `sea`.
- CI: `.github/workflows/rust.yml` (test + examples, release), `release.yml` (сборки с `-D warnings` на macOS); bundle: `fms-studio/scripts/bundle_macos.sh`.
