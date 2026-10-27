# Ratropolis Underground — архитектура и контракты модулей

Документ для разработчиков (и агентов), которые пишут код параллельно. Дизайн игры — в [GDD.md](GDD.md).

## Стек

- Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript strict, Tailwind CSS v4, Zustand 5, Vitest 5, tsx.
- Игра целиком клиентская: `src/app/page.tsx` → `GameClient` → `next/dynamic(GameRoot, { ssr: false })`. Внутри компонентов игры `window`, `localStorage`, `AudioContext` доступны сразу.
- Каждый файл с хуками/обработчиками начинается с `"use client";`.
- **Никаких внешних ассетов**: графика — inline SVG, CSS, эмодзи, canvas; звук — WebAudio-синтез.

## Карта каталогов

```
src/game/types.ts          контракт типов (id, состояние, эффекты, Fx, SceneAction)
src/game/data/*.ts         таблицы контента: resources, jobs, buildings, upgrades, zones, meta (указы, медали, экспресс), events (вагоны, тайминги), headlines, sources (где взять), commissions (поручения Короля); v3: districts (Лондон на карте), curios (Кунсткамера)
src/game/engine/*.ts       чистый движок без DOM: state, derive, economy, events, actions, step, offline, save, formulas, conditions, rng, hints (подсказки), piles (обходчик), narrative (коронация, переселение), progress (медали, поручения); v3: goals (мозг целей), hold (удержание часов), metaMath (мета-множители), clone (копия состояния для стора); только для тестов — testkit (общие колонии и золотые сохранения), __fixtures__/saves (золотые сохранения)
src/game/store.ts          Zustand-стор: useGame(selector), derivedOf(game), действия игрока
src/game/useGameLoop.ts    rAF-цикл 10 Гц, автосейв, офлайн при скрытой вкладке; часы стоят под церемонией (store.ceremony)
src/game/useSampled.ts     подписка на срез стора не чаще hz раз в секунду (v2)
src/game/fx.ts             шина эффектов: onFx/emitFx (из движка), onUiFx/emitUiFx (из UI: тряска, вспышки, всплывающие числа)
src/lib/                   format (числа), v3: layoutMode (телефонная раскладка), useBackCloses («Назад» закрывает оверлей)
src/audio/sfx.ts           синтез звуков (API ниже)
src/components/ui/kit.tsx  общий UI-кит: BrassButton, Plate, Rivets, ResIcon, CostList, AmountList, Bar, Ring, Odometer, Tip, Badge, Stamp, cx
src/components/GameRoot.tsx раскладка экрана (подключает все компоненты ниже)
src/components/layout/     Header, SkyStrip («Наверху»), ResourceBar, NewsTicker, Toasts
src/components/colony/     ColonyView (SVG-срез подземелья, решётка, камеры, крысы, узкоколейка, кошелёк, блестяшки, Суета, Цель)
src/components/fx/         FxLayer (всплывающие числа и частицы поверх всего экрана)
src/components/panels/     SidePanel (вкладки) + BuildingsTab, JobsTab, UpgradesTab, MapTab, ScheduleTab, MigrationTab, MedalsTab, SettingsTab
src/components/scenes/     SceneHost (крупный план событий) + примитивы catch/piles/taps/timing/choice, MarketPopup
src/components/modals/     OfflineModal, SaveIssueModal (оба next/dynamic из GameRoot), CoronationOverlay → Celebration, MigrationOverlay → MigrationCeremony (оболочки решают, когда открыть; шоу — ленивые чанки), CeremonyLoading (тёмный фон-диалог, пока грузится чанк)
src/components/dev/        DevPanel (только NODE_ENV=development или ?dev в URL)
scripts/balance-sim.ts     headless-симулятор баланса (npm run sim); v3: scripts/sim-matrix.ts (npm run sim:matrix, сиды параллельно), scripts/capture-fixtures.ts (золотые сохранения ботом)
```

## Состояние и стор

- `useGame((s) => s.game.res.crumbs)` — выбирайте **примитивы** или маленькие объекты; весь `game` заменяется новым объектом каждый тик (10 раз в секунду) и при каждом действии. v3 (ENG-6): **поддеревья, которые не изменились, сохраняют прежний объект** (`shareState`), поэтому `useGame((s) => s.game.scene)` или `s.game.buildings` возвращают тот же объект, пока в них ничего не поменялось, и компонент не перерисовывается. Новый объект — только там, где правда что-то изменилось (а `time`, `res`, `ema` меняются каждый тик).
- `derivedOf(game)` — мемоизированные (по объекту состояния) производные значения (`Derived` из `engine/derive.ts`): лимиты, жильё, слоты, множители, сила клика, автосбор поездов, интервалы и т. д. (v3: неиспользуемый хук `useDerived()` удалён; `useGame((s) => derivedOf(s.game).housing)`.)
- **GameState — простые данные, как JSON** (ENG-6): объекты, массивы, числа (в том числе `Infinity` — «никогда» в таймерах), строки, булевы, `null`. Никаких `Map`, `Set`, `Date`, экземпляров классов и функций — стор копирует состояние `cloneState` (`engine/clone.ts`, в ~6 раз дешевле `structuredClone`) перед каждым тиком и действием и публикует `shareState(prev, next)`. Опубликованный снимок **никогда не мутируется** (на этом держится общий доступ к поддеревьям): UI только читает, движок работает на копии. Тесты проверяют правило `assertPlain` (`engine/testkit.ts`).
- Действия: `useGame.getState().buyBuilding(id)`, `.click(x, y)`, `.scene({ a: "ready" })` и т. д. — полный список в `GameStore` (`src/game/store.ts`).
- UI-состояние: `tab`, `buyMode`, `sheet` в том же сторе (v2 — см. «v2 UI contract»).
- Формулы для UI: `engine/formulas.ts` (`buildingCost`, `buyCount`, `maxAffordable`, `timeToAfford`, `affordFraction`, `lockedByCap`, `expeditionCost`, `expressStageCost`, `crownsForRun`, `nextCrownAt`, `canMigrate`, `humanClock`), `engine/derive.ts` (`milestoneMult`, `nextMilestone`, `eventValue`, `idleRats`, `stunnedRats`), `engine/actions.ts` (`buildingVisible`, `upgradeVisible`, `currentExpedition`, `expressCost`), `engine/conditions.ts` (`check`, `describeCond`), `engine/events.ts` (`nextTrain`, `trainActive`, `netCost`, `summarize`).
- Видимость интерфейса: `game.revealed[key]` (липкие флаги): `res_<id>`, `tab_buildings`, `tab_jobs`, `tab_upgrades`, `tab_map`, `tab_schedule`, `tab_migration`, `tab_medals`, `news`, `goal`, `suspicion`, `steam`, `bustle`, `exp_<zone>`, `zone_<zone>`.

## Эффекты (Fx)

Движок кладёт в `ctx.fx` события `Fx` (см. `types.ts`), стор рассылает их через `onFx`. Кто реагирует:

| Fx | Звук (AudioDirector) | Визуал |
|---|---|---|
| `click` | `sfx.click()` | FxLayer: «+N» у курсора (цвет ресурса), «ПОЛНО» если `full`; решётка пружинит |
| `drop` / `find` | `sfx.coin()` / `sfx.find()` | FxLayer: всплывающее число; `find` — крупно с обводкой |
| `buy` | `sfx.thud()` | камера в колонии подпрыгивает, облачко пыли |
| `milestone` | `sfx.fanfare()` | золотое кольцо, бейдж ×2 |
| `tier` | — | вспышка «Камера расширена!» |
| `upgrade` | `sfx.tin()` | — |
| `birth` | `sfx.squeak()` (не чаще 3/с) | ♥ над гнездом |
| `vagrants` | `sfx.squeak()` | тост |
| `medal` | `sfx.medal()` | гербовая плашка сверху 2.5 с (Toasts) |
| `zoneDig` / `zoneOpen` | `sfx.dig()` / `sfx.fanfare()` | тряска 6 px, газетная плашка «ЭКСТРЕННЫЙ ВЫПУСК» |
| `sceneStart` / `scenePhase` / `sceneEnd` | см. сцены | SceneHost |
| `trainSoon` | `sfx.bell()` | тост «К путям!» с кнопкой |
| `toast` | — | Toasts |
| `news` | `sfx.typewriter()` (редко) | NewsTicker |
| `frenzy` | — | красно-золотая рамка «АВРАЛ!» |
| `hunger` | — | ResourceBar: крошки красные |
| `coronation` | `sfx.coronationBells()` | CoronationOverlay |

UI-эффекты (`emitUiFx`): `{k:"shake", px, ms}` (GameRoot трясёт экран с учётом настроек), `{k:"flash", color, ms}`, `{k:"float", text, x, y, color, big}` (FxLayer рисует текст в экранных координатах).

## Сцены (крупный план событий)

`game.scene: Scene | null`. Сцена занимает окно колонии (на телефоне — весь экран). Движок ведёт фазы по таймерам `phaseEnds` (игровое время, совпадает с реальным при 10 Гц). Пока UI-компонент сцены смонтирован, он шлёт `scene({a:"attach"})` (и `detach` при размонтировании) — тогда у фаз `catch/piles/taps` есть 4 с форы, у `haul` — 22 с, чтобы UI успел прислать результат. Без UI движок сам решает фазу автосбором.

| id | Фазы | Что делает UI |
|---|---|---|
| `carriage` | `catch` | падающие сквозь решётку предметы `scene.items` (t — момент появления от `phaseStart`, жизнь `itemLife`), клик/свайп, комбо; в конце `scene({a:"catch", result})` |
| `capsule` | `rumble` → `catch` → `piles` → done | дрожит стеклянная труба (5 с), капсулы по `perCar` с; кучи с вагонетками; итог — тост |
| `metro_train`, `royal_express` | `rumble` → `catch` → `piles` → `haul` | «Гул»: позиция бригады `{a:"position"}`, сети `{a:"net", section}` / `{a:"netsRepeat"}`, «По местам!» `{a:"ready"}`, «Пропустить» `{a:"skip"}`; проход: гигантские колёса, предметы по вагонам `scene.cars[i].itemIds`, искры (`item.spark`), фонарь (`scene.lantern`), крюк (`scene.hookCar`, шкала timing), заводные ловцы (`upgrades.clockwork_legion`); `{a:"catch", result}`; кучи `scene.piles[k]` + `{a:"piles", fractions}`; карточка `scene.haul` + `{a:"dismiss"}` |
| `downpour` | `taps` → `catch` | `scene.taps.count` вентилей по `hp` кликов за `duration` с → `{a:"taps", cleared}`; затем плавучий мусор (catch) |
| `cat` | `warn` → `taps` | огромный глаз; выбор `{a:"choice", option:"hide"|"fight"}`; бой: лапа с прочностью `taps.hp` за `taps.duration` с → `{a:"taps", cleared: 1|0}` |
| `ratcatcher` | `warn` → `taps` | дудочка; `{a:"choice", option:"pay"|"fight"}`; бой: `taps.count` нот (каждая летит 3.2 с к норе) → `{a:"taps", cleared: лопнуто}` |

`CatchResult`: `caught[{id, combo, lantern}]` (combo — номер шага комбо в момент поимки, lantern — предмет был в луче фонаря), `netted[id]` (сети/заводные крысы), `sparksHit`, `hook: none|miss|hit|perfect`, `maxCombo`. Ценности предметов уже посчитаны движком (`item.value`), UI только ловит.

Фоновые события: `game.purse` (кошелёк на полу колонии, `clickPurse()`), `game.shinies[]` (блестяшки, `clickShiny(id)`), `game.market` (лавка Бенедикта, `marketDeal(i)`).

## Звук (`src/audio/sfx.ts`)

`sfx.unlock, setVolume(v, enabled), click, find, coin, tin, thud, squeak, fanfare, medal, blip(step), bump, ouch, clack, whistle(royal?), bell, hiss, pop, splash, meow, bonk, pipe(note), jackpot, dig, typewriter, drip, rumbleStart(i)/rumbleSet(i)/rumbleStop, chuffStart(rate)/chuffSet(rate)/chuffStop, coronationBells`. Все вызовы безопасны до `unlock()` и при выключенном звуке. Сцены вызывают `sfx.blip(combo)`, `sfx.clack()` и т. п. напрямую; `AudioDirector` слушает `onFx` и включает/выключает гул поезда по фазе сцены.

v2 (AU-1): `sfx.click(step?)`, `playerClick(bustle | null, frenzy)` (пентатоника по Суете, без утомления), `playerDrop()`, `cue(cue, intensity?, pitch?)` — все 17 `SfxCue` (UiFx `sfx` от `sfxCue()`), `scout(step)`, `migration()`, `record()`, `commission(done)`, `rumbleCut(sec?)` (держит гул в нуле до следующего `rumbleStart/Stop`), `setAmbience(v)` (живой предпросмотр ползунка «Фон»), `ambience(state)`, `ambienceStop()`, тип `AmbienceState`. Фон — отдельная шина `settings.ambience` (`src/audio/ambience.ts`): гул комнаты, капель и ручей Канализации, тиканье часов Подвалов, дальние поезда Метро, гомон Вокзала, механизмы; приглушается на −9 дБ под сценой. Модули: `core.ts` (лимитер, голоса, `setAmbienceCore`, `duckAmbienceCore`, `clockMs`, `voicesNow`), `instruments.ts`, `clicks.ts`, `cues.ts`, `ambience.ts`. В dev: `window.__rrAudio = { sfxCue, emitUiFx, sfx }`.

## Стиль

- Палитра — CSS-токены в `globals.css`, в Tailwind: `bg-soot`, `bg-panel`, `bg-panel-2`, `border-line`, `text-parchment`, `text-parchment-dim`, `text-brass`, `text-brass-light`, `text-copper`, `text-verdigris`, `text-gaslight`, `text-danger`, `text-good`. Шрифты: `font-display` (Cormorant SC — заголовки), `font-sans` (PT Sans), `font-mono` (JetBrains Mono — числа, `tabular`).
- Числа — только через `fmt`, `fmtRate`, `fmtTime`, `fmtInt` из `src/lib/format.ts`.
- Тексты интерфейса — по-русски, с юмором викторианской газеты.
- Настройки `settings.reducedMotion` и `settings.noShake` отключают тряску, зум и вспышки; частиц на 70% меньше.
- Мобильная раскладка: от 375 px, отступы 16 px, без горизонтальной прокрутки страницы, цели касания ≥ 40 px.
- Производительность: canvas для частиц и предметов событий (≤ 200 частиц), `React.memo` для карточек, селекторы примитивов.

## v2 UI contract

Опубликован владельцем движка (EN-7) до остальной работы над движком: пакеты stage 2 (scenes, colony, panels, shell, audio) пишут против **этих имён и сигнатур**. Сигнатуры окончательные; реализации, помеченные «ждёт EN-x», уже работают в минимальном виде и будут уточнены, но не переименованы. Всё v1 сохранено: старые поля и экспорты не меняли форму, новые поля сцен/улова — необязательные.

### Соглашения

- **data-target** (элементы панелей, на которые ведут подсказки, тосты и `focus`): `b_<BuildingId>`, `j_<JobId>`, `u_<UpgradeId>`, `e_<EdictId>`, `z_<ZoneId>`, `x_express`. Камеры колонии для `fly`: `building:<BuildingId>`.
- **TabId** теперь живёт в `types.ts`; `import { type TabId } from "@/game/store"` продолжает работать (реэкспорт).
- Счётные строки — только через `plural()` / `fmt*` из `src/lib/format.ts`.
- Все чистые хелперы ниже покрыты vitest в `src/game/**/*.test.ts`.

### `src/game/fx.ts`

```ts
type SfxCue = "footstep"|"thump"|"doppler"|"tinnitus"|"rumbleCut"|"medalTier"|"tierLost"|"carClear"|"stamp"|"tick"|"heartbeat"|"patent"|"unlock"|"valveCreak"|"bubbles"|"crownTick"|"chime";
function sfxCue(cue: SfxCue, o?: { intensity?: number; pitch?: number }): void   // = emitUiFx({k:"sfx", …})
```

| UiFx (новые) | Кто шлёт | Кто слушает |
|---|---|---|
| `{k:"sfx"; cue; intensity?; pitch?}` — intensity 0..1 (громкость, по умолчанию 1), pitch множитель частоты (1) | сцены (SC-1/2/3/5/6), SH-5, через `sfxCue()` | AudioDirector (AU-1) |
| `{k:"focus"; tab; target?}` — через кадр после `store.focus()` | `store.focus`, `store.applyHint` | SidePanel: scrollIntoView `[data-target=target]` + `rr-glow` 1.6 с (PA-5) |
| `{k:"unlock"; items:{key; tab; text}[]}` — пачка «Открыто!» за ≤ 3 с | панели (PA-5) | Toasts (SH-3), кнопка «Открыть» → `focus(items[0].tab, items[0].key)` |
| `{k:"fly"; from:{x,y}; target; icon}` — from в client px, target = `building:<id>` | BuildingCard при покупке (PA-3) | fx/particles (CO-7) |
| `{k:"toast"; text; icon?; tab?; target?}` | стор («Отчёт об отлучке потерян»), любой UI | Toasts (SH-3) |

Старые `shake` / `flash` / `float` без изменений. Слушатели с `switch (fx.k)` должны иметь `default`.

### `src/game/store.ts` (UI-состояние не сохраняется)

```ts
sheet: "half" | "full";  setSheet(v): void;  toggleSheet(): void            // PA-2, SH-2
focus(tab: TabId, target?: string): void      // set({tab}), затем следующий кадр (или 100 мс, если кадры стоят) → UiFx focus (CO-3, CO-7, CO-8, PA-3, SH-3)
applyHint(h: Hint): void                      // выполняет h.action (assignJob / contributeExpedition / buyBuilding(id,1) / buyUpgrade), затем focus(h.tab, h.target) (CO-3)
buyBuilding(id, mode?)                        // mode 10 = ровно 10 уровней (или остаток до maxLevel) либо ничего; "max" — частично (PA-3)
buyEdictRank(id: EdictId): void               // ранг II/III, после первой коронации (PA-6)
buySeal(id: SealId): void                     // купить за 120 👑 и сделать активной; купленную — активировать по правилам setSeal (PA-6)
setSeal(id: SealId): void                     // смена активной печати бесплатно, только пока game.time < 60 (PA-6)
acceptCommission(id: CommissionId): void      // принять поручение Короля (PA-6)
setSetting("reducedMotion", v)                // заодно сбрасывает settings.reducedMotionFromOS (SH-4)

// безопасность сохранений (EN-8, SH-1)
crashed: boolean;  crashError: string | null;  resetCrash(): void        // перечитать последнее сохранение и снять крэш
saveIssue: null | {kind:"corrupt"; quarantineKey: string} | {kind:"newer"; version: number} | {kind:"locked"};
backups(): {slot: 1|2; at: number; rats: number; crownsEver: number}[]   // новые сверху; at = epoch ms записи той копии
restoreBackup(slot: 1|2, expectedAt?: number): boolean   // expectedAt ≠ bakmeta[slot].at → false, хранилище не тронуто
rawSave(): string | null                      // строка из localStorage как есть (JSON) — для «Скачать сохранение»
importSaveFile(text: string): boolean         // принимает и сырой JSON (rawSave), и «RATRO1:…»; копия делается до импорта
takeOverTab(): void                           // при saveIssue "locked": «Играть здесь»
startFresh(): void                            // новая колония (настройки сохраняются); недоступно при "newer"/"locked"
```

Типы `SaveIssue` и `BackupInfo` экспортируются из стора. Пока `crashed` или `saveIssue !== null`, игра не тикает, действия игрока игнорируются, `save()` ничего не пишет. Порча сохранения: сырая строка копируется в `quarantineKey` (`<key>:corrupt:<ms>`), основной ключ не трогается до выбора игрока. Ключи копий: `<key>:bak1`, `<key>:bak2`, мета `<key>:bakmeta`. Слот 1 — скользящая копия раз в 5 мин (из `save()`); слот 2 — копия перед `importSave`/`importSaveFile`, `hardReset`, `startFresh`, `restoreBackup` и перед первой перезаписью сохранения старой схемы, скользящая копия его не трогает (откат к слоту 2 меняет две колонии местами). Вкладки: Web Lock `ratropolis:<key>` + BroadcastChannel того же имени. На свежем сейве `settings.reducedMotion` берётся из `prefers-reduced-motion`, `reducedMotionFromOS = true`. Для крэша в dev: `__rr.getState()` / тест-хук `stepHooks.before` в `engine/step.ts`.

### `src/game/useSampled.ts`

```ts
useSampled<T>(selector: (s: GameStore) => T, hz = 3, eq = shallow): T
```
Сразу при монтировании, затем не чаще `hz` раз в секунду (первое изменение — сразу, остальные — по заднему фронту окна); ререндер только если `eq` говорит «изменилось». Для PA-1, PA-7, CO-3 (1 Гц).

### Новые поля состояния (`types.ts`, умолчания в `state.ts`, загрузка v1 — `save.ts`)

| Где | Поле | Смысл | Пишет / читает |
|---|---|---|---|
| Settings | `hints: boolean` (true) | строка подсказки старейшины | SH-4 / `nextHint`, CO-3 |
| Settings | `ambience: number` 0..1 (0.5) | громкость фона | SH-4 / AU-1 |
| Settings | `textScale: 1 \| 1.15 \| 1.3` (1) | zoom панели, шапки, ленты | SH-4 |
| Settings | `reducedMotionFromOS: boolean` | reducedMotion взят из ОС | стор / SH-4 «как в системе» |
| Meta | `edictRank: Partial<Record<EdictId, number>>` | ранги указов; читать через `edictRank()` | EN-9 / PA-6 |
| Meta | `seal: SealId \| null`, `sealsOwned: SealId[]` | великие печати | EN-9 / PA-6 |
| Meta | `coronations: number` | коронаций всего (считается) | `coronationLine`, медали |
| Meta | `carLog`, `variantLog: Partial<Record<…, HaulRating>>` | журнал путейца | ждёт EN-11 / PA-7 |
| Meta | `seenLines: Partial<Record<SceneEventId, number[]>>` | увиденные реплики бестиария | ждёт EN-6 / PA-7 |
| Meta | `history: RunHistoryEntry[]` (≤ 20), `records: Partial<Record<RecordKey, number>>` | летопись забегов и рекорды (с) | ждёт EN-11 / PA-6, PA-7 |
| GameState | `scouted: Partial<Record<ZoneId, number>>` 0..3 | выплаты разведчиков (оплаченный шаг) | EN-4 (готово) / CO-8 |
| GameState | `newsRecent: string[]` | кольцо без повторов | ждёт EN-10 |
| GameState | `commissions: CommissionState \| null`, `charters: number` | поручения Короля, грамоты | ждёт EN-12 (принятие уже работает) / PA-6 |
| RunStats | `cleanCars`, `goldStreak`, `goldHauls`, `downpoursWon`, `frenzies`, `royalExpresses` (+ старые `lanternMax`, `hookPerfects`) | счётчики подвигов и поручений; **уже считаются** | медали, поручения |
| Scene | `variant?: TrainVariantId`, `line?: LinePair`, `announce?: string`, `suspBefore?: number`, `cars[k].special?: "cheese"` | вариант поезда, реплики сцены, баннер «Сырный вагон…», подозрение на старте прохода | ждёт EN-5/EN-6 / SC-4, SceneFrame |
| CatchItem | `skip?: boolean` | искры, которых нет на позиции «у стены»: не рисовать, не считать | ждёт EN-5 (движок уже их не учитывает) / SC-3 |
| CatchResult | `cleanCars?: number` | UI может прислать; иначе движок считает сам | SC-2 |
| SceneAction | `{a:"taps"; cleared; fastMs?}` | время от первого до последнего вентиля | SC-6 / EN-11 |
| HaulSummary | `headline?: string` | «Тем временем наверху» | ждёт EN-6 / SC-4 |
| HaulSummary | `suspicionParts?: {pass; lantern; total}` | разбивка подозрения | ждёт EN-5 / SC-3 |
| HaulSummary | `jackpotSeconds?: number` | джекпот в секундах пассивного дохода (≤ `HOOK_JACKPOT_CAP_SEC`, есть только при джекпоте) | EN-1 (готово) / SC-3 |
| EdictDef | `decree: string`, `ranks?: {cost; effect}[]` | указ-грамота; ранги II/III (ranks[0] = II) | PA-6 |
| AchievementDef | `progress?: {stat; goal}`, `group?: "colony"\|"events"\|"meta"\|"secret"` | счётные медали, разделы кабинета | PA-7 |

**Отступление от брифа:** у `HaulSummary` уже было поле `suspicion: number`, которое читает v1 HaulCard. Чтобы UI v1 компилировался, `haul.suspicion` остаётся числом (= total), а разбивка лежит в **`haul.suspicionParts`**.

Новые id: `ACHIEVEMENT_IDS` + 24 медали v2 (`nomads, all_london, treasury, thousand_crowns, seal_and_tail, full_code, long_train, tail_horizon, again_throne, naturalist, purser, honored_rail, genealogy`; секретные `hungry_king, miser, forever_tuesday`; подвиги `clean_car_10, no_spark, gold_streak, ties_survivor, dry_paws, cat_nightmare, royal_retinue, full_consist`) — описания и группы готовы, выдача ждёт EN-11. `SEAL_IDS`, `TRAIN_VARIANT_IDS`, `COMMISSION_IDS`, `RecordKey`, `TextScale`, `HaulRating`, типы `LinePair`, `TrainVariantDef`, `DistrictMods`, `DistrictTrait`, `SealDef`, `CommissionDef`, `CommissionState`, `RunHistoryEntry`.

### Новые Fx движка

| Fx | Когда | Кто реагирует |
|---|---|---|
| `{k:"scout"; zone; res; amount; step: 1\|2\|3}` | выплата разведчиков на 25/50/75% экспедиции — **уже шлётся** (ручной вклад и «Автовзнос»); amount — фактически добавлено; вместе с новостью «Разведчики вернулись …» | Toasts «Разведчики вернулись…» (SH-3), LockedBand блик (CO-8), AU-1 |
| `{k:"migration"; crowns; district; weekday; summary:{seconds; eRun; trains; bestRating; rats}}` | `migrate()` — **уже шлётся**, ровно один раз; district — индекс нового района | MigrationOverlay (SH-5), AU-1 |
| `{k:"record"; what: RecordKey; time; prev}` | новый рекорд колонии (ждёт EN-11) | Toasts (SH-3), AU-1 |
| `{k:"commission"; id; done: boolean}` | принято (`done:false`, уже шлётся) / исполнено (ждёт EN-12) | панели, тосты |

### Подсказки и «Где взять» — `src/game/engine/hints.ts` (EN-7, готово)

```ts
type HintAction = {kind:"assign"; job; n} | {kind:"contribute"; zone} | {kind:"buyBuilding"; id} | {kind:"buyUpgrade"; id} | {kind:"focus"};
interface Hint { id: string; icon: string; text: string; why: string; tab: TabId; target?: string; action?: HintAction }
nextHint(s, d): Hint | null
```
Правила по порядку (первое сработавшее): 1) еда в минусе / голод → «Еда в минусе: верните N крыс в собиратели» (assign forager N); 2) жильё полно и гнездо стоит ≤ 2× запаса → buyBuilding nest (не при включённом Прорабе для гнёзд); 3) открыт карманник/барахольщик, на нём 0 крыс, его ресурс не растёт, а видимая цель его ждёт → «Монетки сами не копятся: отправьте 3 крыс в карманники (+X 🪙/с)», why перечисляет цели; 4) конвертер < 60% → текст `converterBottleneck` (assign поставщиков или стройка); 5) в экспедицию можно внести ≥ 25% остатка ресурса (или он упёрся в лимит), без «Автовзноса» → contribute; 6) доступно улучшение → «Можно изобрести «X»»; 7) склад полон и доступен склад побольше → buyBuilding. `settings.hints === false` → null. `id` стабилен для ситуации (`hungry`, `housing`, `idle_job:pickpocket`, `converter:mechanic`, `expedition:sewers`, `upgrade:<id>`, `storage:<res>`).

```ts
storageHintFor(s, d, res): { text: string; target?: string; buildingId?: BuildingId }
```
Видимый склад → «🥫 Кладовка в жестянке ур. 3», target `b_<id>`; склад открытой зоны, ещё не открытый → ««Кладовка в жестянке» — откроется, когда упрётесь в лимит 🍞»; склад закрытой зоны → ««…» — в новой зоне «Подвалы»», target `z_<zone>` (PA-3). Вспомогательно: `storageBuildingsFor(res): BuildingId[]`.

```ts
resourceSources(s, res): { icon; label; kind: "job"|"building"|"click"|"event"; job?: JobId; workers?: number }[]
```
Открытые работы (label во множественном числе: «Карманники», workers = текущие), видимые здания с производством, событийные источники из `data/sources.ts` (`EVENT_SOURCES`, `JOB_PLURAL`, `JOB_TO`) — PA-3 «Где взять».

```ts
steamBreakdown(s, d): { stock; buffer; gross; stokers; slots; convEff; consumers: {id; name; icon; perSec}[]; steamEff; fix: "boiler"|"miners"|"stokers"|null }
suspicionInfo(s, d): { pct; perMin; activeOnly: true; threshold; etaSec: number|null; reducers: {label; amount}[] }
converterBottleneck(s, d, job): ConverterBottleneck | null   // {job, eff, kind:"full"|"input", res, text, supplier?, need?, supplierLocked?, building?}
jobValuePerRat(s, d, job): { value; surplus; capped: ResId[] }
inputRunway(s, d, job): { res; seconds } | null
ratsAcc(n): "крысу" | "крыс" | "крысы"     // «отправьте 3 крыс»
```
`steamBreakdown` — CO-4 (fix: нет котла/мест → boiler, кочегары голодают → miners, есть свободные места → stokers). `suspicionInfo` — SH-3: perMin = 1%·suspicionMult (×3 под поручением «Щепки от дудки») только при активной игре (офлайн 0), threshold — порог Крысолова района (100, Мэйфэр 80), etaSec = (threshold − p)/perMin·60 (47% → 3180 с), 0 — Крысолов уже идёт. `converterBottleneck` — логика JobsTab.bottleneck(), перенесённая в движок (PA-4), null при ≥ 95% или без рабочих. `jobValuePerRat` — рыночная ценность выхода одной крысы в секунду (📜💍 по 50, 💨 0, при текущей эффективности конвертера), `capped` — выходы, упёршиеся в лимит (их вклад 0), `surplus` — работа даёт 🍞, а крошек > 50% сверх прокорма (PA-4). `inputRunway` — через сколько секунд кончится падающий вход конвертера (PA-4).

### Покупки — `engine/economy.ts`, `engine/formulas.ts`

```ts
levelGain(s, d, id, k): Partial<Record<ResId, number>>   // прирост валового производства/с от +k уровней: diff grossRates на state с +k (точно по построению)
paybackSeconds(s, d, id, k): number                      // цена (рынок) / ценность прироста в секунду; Infinity если прироста нет
buildingCostFor(s, id, k): Amounts                       // цена следующих k уровней
milestoneInfo(level): { prev: number; next: number; jobBoost: number }   // prev 0 = вех нет, next Infinity после последней; jobBoost = MILESTONE_JOB_BOOST (1.2)
grossRates(s, d): ResMap;  unitValue(r): number
buyCount(s, id, mode)                                    // ×10: ровно 10 (или остаток до maxLevel) либо 0
prevCrownAt(s): number                                   // E_run текущего венца — для полосы между prev и nextCrownAt (CO-3)
crownThreshold(c): number                                // E для c венцов по мягкому потолку v2 (c ≤ 100: 1e6·(c/10)², дальше 1e8·(c/100)^10)
```
PA-3 (карточки, «выгодно», честный ×10), CO-2 (полоса до вехи). Надбавка работе за вехи (`jobYield × 1.2^вех` у производящих построек с `jobPct` или местами работы) уже в `derive` (EN-4). `crownsForRun` считает по `crownThreshold` (EN-1): это наибольшее k с `crownThreshold(k / бонус) ≤ E_run`, так что `prevCrownAt ≤ E_run < nextCrownAt` всегда, а `nextCrownAt` при 0 венцов = 1e6.

### Экономика v2 (EN-1…EN-4) — дополнительные экспорты

```ts
// engine/actions.ts
SCOUT_STEPS = [0.25, 0.5, 0.75]; SCOUT_SECONDS = 60;
expeditionFraction(s, zone): number            // среднее min(1, внесено/нужно) — как GoalWidget (CO-8: полоса и метки 25/50/75)
scoutResource(s, d, zone): ResId | null        // что принесут следующие разведчики (самый дефицитный ресурс с V > 0)
// engine/events.ts
trainDropRes(s, r): ResId                      // во что превращается выпадение r, пока r не открыт (🔔🛤️ → ⚙️, 💍 → 🪙); 🔔💍 открыты с Метро
incomeValue(s): number                         // Σ ema_r × курс_r — мерило потолка джекпота
// data/events.ts
METRO_BASE_CARS = 4; RANDOM_CAR_WEIGHTS; HOOK_JACKPOT = {hit: 2.5, perfect: 4, royalHit: 4, royalPerfect: 6}; HOOK_JACKPOT_CAP_SEC = 120 (баланс 24.10)
// data/buildings.ts, data/upgrades.ts, data/zones.ts, engine/derive.ts
MILESTONE_JOB_BOOST = 1.2; MILESTONES; TINKERS_MULT = 1.75; ZONE_FROM («из Канализации»); milestonesReached(level)
```
Пар (💨) теперь `excludeGlobal`: кочегар даёт ровно 3 × jobYield 💨/с. Метро: +50 жилья, Подвалы — 50 крыс. Указ `express_blueprints` хранит ≤ 5 этапов (`KEPT_STAGES_MAX`). Новость этапа экспресса — «Этап «…»: {👤}», заголовок коронации — из `coronationLine`.

### Сцены — `engine/piles.ts`, `data/events.ts`, `engine/events.ts`

```ts
PILE_STEP = 0.06; PILE_HOLD_RATE = 5; LINEMAN_START = 1.5; LINEMAN_END_FRAC = 0.85;
linemanX(t, dur): number            // 0..1 по полосе
pileLockTime(i, n, dur): number     // когда сапог обходчика доходит до кучи i из n (центр (i+0.5)/n)
stepPile(frac, dt, holding, clicks, auto): number   // max(frac, auto) + clicks·STEP + hold·STEP·HOLD_RATE·dt, ≤ 1
POSITION_FEEL = { wall:{hitR:0.85, sparkKeep:0.5}, rails:{hitR:1, sparkKeep:1}, ties:{hitR:1.3, sparkKeep:1, sparkGrabPx:50} }
LANTERN_MULT = 2.5                  // уже используется resolveCatch
RATING_TABLE                        // как в v1
TRAIN_VARIANTS: Record<TrainVariantId, TrainVariantDef>; TRAIN_VARIANT_ORDER   // name, icon, physics "bounce"|"float"|"flutter", tint (null у normal)
EVENT_LINE_POOLS: Record<SceneEventId, LinePair[]>; LINE_DESTS   // шаблоны {time} {dest} {n}; первая пара = EVENT_LINES
catchProgress(sc, caughtIds: Set<number>, lostIds: Set<number>): { share; maxReachable; tier: HaulSummary["rating"] }
```
SC-1 (кучи и обходчик; длительности фаз в EVENT_TIMING сменит EN-5), SC-2 (живая шкала: веса ровно как в resolveCatch — пойманное руками, сетями и заводными / вся не-искровая масса; tier без правила «royal без искр»), SC-3 (POSITION_FEEL, LANTERN_MULT), SC-4 (варианты: `scene.variant` начнёт заполняться в EN-6; пока его нет — это «normal»).

### Мета и повествование

```ts
// engine/narrative.ts
coronationLine(s): { human: string; rat: string }   // 1-я: «Для людей это одна среда.» / «Для крыс — целая история.»; род: вт/чт/пн — один, ср/пт/сб — одна, вс — одно
migrationPreview(s): { gained; bonusBefore; bonusAfter; affordable: EdictId[]; nextDistrict: string; nextTrait: DistrictTrait; weekday: string }
humanWeekday(s): string;  weekdayAt(migrations, day): string
// engine/core.ts
edictRank(s, id): number            // 0 не подписан, 1, 2, 3; старые сейвы с edicts[id]=true → 1
// data/zones.ts
DISTRICT_TRAITS: DistrictTrait[];  districtTrait(i): DistrictTrait     // ≥ 6: черты 1–5 по кругу, сила ×1.25
DISTRICT_LOC;  districtLoc(i): string                                  // «в Саутварке»
// data/meta.ts
SEALS: Record<SealId, SealDef>;  SEAL_ORDER;  EXPRESS_STAGE_LINES: LinePair[]   // параллельно EXPRESS_STAGES
// engine/progress.ts
achievementProgress(s, id): { cur; goal } | null    // для медалей с progress; заработанная → cur = goal
commissionProgress(s): { id; cur; goal } | null      // активное поручение
// data/commissions.ts
COMMISSIONS: Record<CommissionId, CommissionDef>;  COMMISSION_ORDER;  CHARTER_MAX; CHARTER_MULT; CHARTER_MULT_CAP
```
SH-5 (`coronationLine`, Fx migration), PA-6 (`edictRank`, `EDICTS[id].ranks/decree`, SEALS, `districtTrait`, `migrationPreview`, `EXPRESS_STAGE_LINES`, COMMISSIONS, `commissionProgress`, `meta.records`), SH-3 (`districtTrait`, `suspicionInfo`), PA-7 (`achievementProgress`, `ACHIEVEMENTS[id].group`, `meta.carLog/variantLog/seenLines/history/records`, `EVENT_LINE_POOLS`), PA-5 (`edictRank`, ranks). Эффекты рангов, печатей и черт районов применяет EN-9; покупка и выбор работают уже сейчас.

### Прочее

- Вкладка «Медали» открывается, только когда открыта «Постройки» или есть ≥ 2 медали (первый клик больше не показывает пустой кабинет).
- `engine/save.ts`: `deserialize(str): GameState | SaveNewer | null` (`SaveNewer = {error:"newer"; version}`, проверка `isNewerSave`), `savedVersion(str)`, `importAny(str)` (JSON или «RATRO1:»), `importString(str): GameState | null`. `SCHEMA_VERSION = 2`; `migrate()` выбрасывает битые элементы массивов (shinies, news, haulLog, stunned, market.deals, history…) и зажимает настройки.

### Итог интеграции (EN-5…EN-13, 24.10.2026)

Все пометки «ждёт EN-x» выше закрыты: варианты поездов, сырный вагон, реплики, заголовок «Тем временем наверху», ранги/печати/районы, газета, медали 2.0, летопись и рекорды, поручения работают в движке и покрыты тестами (`src/game/engine/v2depth.test.ts`).

```ts
// engine/ranks.ts (без зависимостей от движка; core.ts реэкспортирует edictRank)
edictRank(s, id); byRank(s, id, vals, none); sealOn(s, id); RANKED   // значения рангов I/II/III
// engine/commissions.ts
charterMult(s); offerCommissions(s, skip?); checkCommission(s, ctx)   // housekeeping; Fx commission {done:true}
// engine/events.ts
rushHour(s); floodedTracks(s); pickVariant(s)                          // EN-6: варианты (новинка ×2.5 до первой встречи)
// engine/actions.ts
assignable(s, d, job)   // сколько крыс assignJob реально переведёт (подсказка «отправьте N крыс» — по нему)
RECORD_LABEL; fmtRunTime(sec)                                          // рекорды колонии
openZone(s, zone, ctx, noRecord?)                                      // noRecord: зона открыта указом на старте
// engine/hints.ts
storageHintFor(s, d, res, price?)   // с ценой — уровень склада, который её вместит
jobValuePerRat(s, d, job) → { value, net, surplus, capped }   // net — за вычетом сырья конвертера
// engine/narrative.ts
migrationPreview(s).affordableRanks: { id, rank }[]                    // ранги, которые купит та же «покупка подряд»
// engine/derive.ts
highestZoneId(s); Derived.{ districtRes, purseFreq, purseEffect, lucky, ratcatcherAt, catMult, marketInterval, silence, commission }
// data/headlines.ts
pickHumanHeadline(haul, scene); HEADLINES.restart / filler_<zone> / filler_d0…d5 / filler_crowned / record / commission_done
// data/upgrades.ts
RAT_MEMORY_RANKS; ratMemoryUpgrades(rank)
// store.ts
markCrashed(error)   // CrashScreen: ошибка рендера замораживает игру как крэш движка
```

Новые поля: `GameState.recentLines` (кольцо из 4 последних реплик на событие), `GameState.coronatedAt` (−1 до коронации), `Timers.filler`, `Meta.cheeseCars`, `Scene.lineIdx`, `Scene.lanternSusp` (фактическая прибавка подозрения от фонаря). `HaulSummary.suspicionParts = { pass, lantern, total }`: total — всё изменение от начала прохода, lantern — фактическая прибавка (×`suspicionMult`). Газета не повторяет строку в пределах 9 последних (`news()` пропускает повтор). Медали со счётчиком (`ACHIEVEMENTS[id].progress`) выдаются housekeeping при достижении цели. «Ещё до обеда» — коронация до 10:00.

UI (stage 2 [B], доделано интегратором): PA-5 (заколоченная контора, тосты «Открыто», честное свечение «Переселения»), PA-6 (ранги, печати, черта района, превью переселения, строки этапов, «Поручения Короля», рекорды на карте), PA-7 (кабинет медалей по разделам, прогресс, без спойлеров, «Журнал путейца», бестиарий с репликами, летопись забегов), SH-4 (`useHotkeys`, событие окна `rr-escape`, «Фон», «Подсказки», «Размер текста», «Клавиши», контраст `--muted`/`text-danger`), SH-5 (`modals/MigrationOverlay.tsx`, строка коронации из `coronationLine`), SH-6 (`app/icon.svg`, `icon1.tsx` 192/512, `apple-icon.tsx`, `opengraph-image.tsx`, `manifest.ts`, метаданные), SC-4 (варианты: баннер, тон поезда, физика «float/flutter», сырный вагон, реплики сцены, вырезка из газеты), SC-5 (великан на перроне, рука кондуктора с фонарём, вставка «Наверху» `scenes/UpstairsInset.tsx`, удар прибытия, доплер, звенящая тишина), SC-6 (без заставки у Кота/Крысолова, клавиши 1/2, лапа-проигрыш, кольцо попадания и сердцебиение, вентили-штурвалы), CO-5 (`colony/Traffic.tsx`, свет по часам, дождь), CO-6 (поклажа, жители камер, без кучек, облик от улучшений), CO-7 (интерактивная подсказка камеры, сигналы у края, полёт иконки, леса, «ПАТЕНТ!»), CO-8 (силуэт следующей зоны, табличка экспедиции, золотая решётка, корона-курсор).

### Ревизия v2 (24.10.2026): изменённые и новые API

```ts
// store.ts
save(): boolean                          // false — запись не удалась (хранилище закрыто/полно) или сохранение на паузе; первый отказ — тост со ссылкой на «Настройки»
noteHidden(at: number); noteVisible()    // экспорт модуля (не стора): пока часы стоят, каждое сохранение помечено моментом остановки (вызывает useGameLoop)
restoreBackup(slot, expectedAt?)         // см. выше: слот 1 — скользящий, слот 2 — «до импорта/отката/сброса»
abandonCommission(): void                // вернуть активное поручение Королю без грамоты; три новых предложения
runSeq: number                           // UI: +1 при подмене игры целиком (adopt: импорт, откат, «Начать заново», сброс; resetCrash; захват вкладки). GameRoot: key = `${meta.migrations}:${runSeq}`
ceremony: boolean; setCeremony(on)       // церемония открыта (счётчик: часы стоят до закрытия последней). Ставят CoronationOverlay и MigrationOverlay
// engine/commissions.ts
abandonCommission(s, ctx?): boolean      // также при Печати Тишины, если активное поручение стало невозможным
// engine/events.ts
WHISTLE_FLOOR = 5; whistle(s, ctx)       // поезд ≤ 5 с — отказ без платы; иначе раньше на min(60, left − 5) с
metroCarCount(d): number                 // вагонов в поезде Метро, 3..11 (trainComposition, табло «Расписания», симулятор)
// engine/derive.ts, engine/economy.ts
converterPotential(s, d, r, eta?)        // сколько конвертеры дали бы r без потолка склада («Автовзнос» полного ресурса)
OFFLINE_SLICE = 2                        // офлайн фазы 1–3 tickEconomy идут кусками ≤ 2 с
// data/events.ts
EVENT_TIMING.backgroundStarve = 60       // фоновое событие, просроченное на 60 с, стартует и под защитой поезда; поезд ждёт ≥ 40 с
// data/sources.ts
JOB_FROM; EventSource.noSilence          // «из механиков»; источник скрыт под Печатью Тишины
// engine/hints.ts
suspicionInfo(...).threshold; подсказки `hungry:<job>` (только фокус), `housing:store`
```

- Новые поля: `GameState.runBestRating` (лучший улов забега, для летописи и `migrate()`), `meta.lifetime.wagons` (вагоны за все забеги, медаль «Хвост за горизонтом» — 15).
- Ранги указов (`EDICTS[id].ranks[k].effect`) — **полные формулировки**: карточка указа показывает текст ранга вместо базового.
- `useGameLoop`: часы «держатся» (`heldAt`), пока вкладка скрыта или открыта церемония; когда вкладка видна и церемоний нет, удержанное время засчитывается (> 60 с — `catchUp` с отчётом, меньше — `advance`). Удержание до 60 с, в котором была церемония, — просто пауза без зачёта: поезд или событие, подошедшие под церемонией, ждут игрока, а не разыгрываются автосбором. Во время крэша/`saveIssue` удержание переносится на «сейчас» (выход из остановки перечитывает сохранение).
- Колония: оверлей внутри колонии с атрибутом `data-wheel-scroll` забирает колесо мыши себе (колония не панорамируется; Ctrl+колесо по-прежнему зумит). `colony/layout.ts`: `tipBox`, `railBox` (размещение подсказки камеры и рейки зон); `geometry.ts`: `uiX`/`uiY`.
- `fx/fxBus.ts`: `flightStart(target)` → `done()`, `flightPending(target)`, `onLand(fn)` — камера ждёт прилёта иконки покупки и подпрыгивает при посадке; `inColony(p)`, `clampToColony(p, pad?, padBottom?)` — частицы для камер вне экрана не рисуются, вспышка вехи прижимается к краю колонии.
- Сцены: `SceneHost` строит тело каждой сцены через `next/dynamic` с повтором загрузки (3 попытки); `BodyGuard` ловит только ошибки загрузки чанка («Сцена не загрузилась» · «Ещё раз» / «Пропустить», движок тем временем решает сцену сам), прочие ошибки уходят в CrashGuard. `sceneUtils.nearestStanding(locked, j)`, `TimingBar` prop `royal`, `UpstairsInset` prop `className`.
- `panels/alerts.ts`: `firstSentence(text)` не режет внутри скобок и «кавычек».
- AudioDirector: при `crashed`/`saveIssue` гул поезда, пыхтение и фон останавливаются.

## v3 UI contract

Опубликован владельцем движка (ENG-12) до остальной работы над движком v3: пакеты stage 2 (scenes, colony, panels, shell, audio, repo) пишут против **этих имён и сигнатур**. Сигнатуры окончательные; реализации с пометкой «уточнит ENG-x» уже работают в минимальном корректном виде и будут доработаны, но не переименованы. Всё v1/v2 сохранено: старые экспорты и поля не меняли форму, новые поля состояния, сцен и улова — необязательные или со значением по умолчанию. `SCHEMA_VERSION = 3`.

### Соглашения v3

- **Удержание (K1).** `isHeld(st)` из `store.ts` — единственный флаг «игра стоит» для сцен (SCN-1) и звука (AUD-1).
- **Телефон.** Один источник: `src/lib/layoutMode.ts` (`PHONE_MQ` = узко **или** низко). CSS-зеркало — `max-md:` и вариант `short:` оболочки (SHL-3).
- **Звуки v3** — только через `sfxCue3()` / UiFx `sfx3`: союз `SfxCue` не расширяется (его исчерпывающе отображает `src/audio/cues.ts`).
- **Районы.** Новые UI читают район через `districtInfo(meta)` / `districtAt(meta, i)` / `districtById(id)`. Старые `districtName/districtTrait/districtLoc(index)` из `data/zones.ts` оставлены для совместимости: без второго аргумента они отвечают для старого маршрута (12 районов, затем второй круг «II»), с `meta` — для настоящего (ENG-11).
- **Сроки.** `fmtTime` — для ETA: ≥ 100 ч → «> 4 д», не число → «—» (было «∞»). Для прошедшего времени, которое бывает длиннее (время под землёй, отлучка), — новый `fmtDuration`.
- Все новые чистые хелперы покрыты vitest: `src/game/engine/v3contract.test.ts`, `save.test.ts`, `src/lib/*.test.ts`.

### Настройки, звук, тосты (ENG-12)

| Где | Имя | Смысл | Кто |
|---|---|---|---|
| `Settings` | `sfxVolume: number` 0..1 (1) | шина эффектов; `volume` остаётся мастером | SHL-6 (ползунок), AUD-3 |
| `Settings` | `music: number` 0..1 (0.35) | генеративная музыка района | SHL-6, AUD-3 |
| `fx.ts` | `type SfxCue3 = "giantVoice" \| "ratChatter" \| "coachman" \| "hoof" \| "curio" \| "counter" \| "growl"` | v3-звуки (смысл каждого — в JSDoc) | SCN-2/4, COL-1/4 шлют; AUD-2 играет все 7 |
| `fx.ts` | UiFx `{k:"sfx3"; cue: SfxCue3; intensity?; pitch?}` | как `sfx` | AudioDirector |
| `fx.ts` | `sfxCue3(cue, o?: {intensity?; pitch?}): void` | = `emitUiFx({k:"sfx3", …})` | все |
| `fx.ts` | UiFx `unlock`: `items[i]: {key; tab; text; icon?; name?; desc?}` | структурированный тост «Открыто»: иконка, имя, одна строка «что даёт»; `text` — прежняя полная строка | PAN-1 шлёт, SHL-1 рисует |

`setSetting("sfxVolume" | "music", v)` — обычный `setSetting`; при загрузке оба зажимаются в 0..1, сохранение v2 без них получает 1 и 0.35.

### `src/lib/layoutMode.ts`, `src/lib/useBackCloses.ts`

```ts
PHONE_MQ = "(max-width: 767px), (max-height: 520px)";  SHORT_MQ = "(max-height: 520px)"
usePhoneLayout(): boolean        // useSyncExternalStore; на сервере и при гидрации false
useShortLayout(): boolean        // телефон боком / низкий экран
isPhoneLayout(): boolean; isShortLayout(): boolean; matchesQuery(q): boolean   // вне React (обработчики, стор)
useBackCloses(open: boolean, close: () => void): void
createBackCloser(env: BackEnv): BackCloser   // ядро хука (тесты): open(close) → token, release(token), depth()
BACK_STATE = { rr: "ov" }
```
`useBackCloses` действует только на телефонной раскладке. Когда `open` становится true — `history.pushState({rr:"ov", token}, "")`; системное «Назад» (popstate) закрывает **верхний** оверлей вызовом `close()`; закрытие из UI делает `history.back()`, только если верхняя запись наша (`rr === "ov"`), и собственный `back()` не считается нажатием «Назад». Десять циклов «открыть/закрыть» не удлиняют историю (тест). Кто: SHL-4 (модалки, лист), SCN-5 (сцены), COL-2, PAN-1/2.

### `store.ts`

```ts
isHeld(st: Pick<GameStore, "ceremony" | "crashed" | "saveIssue">): boolean   // ceremony || crashed || saveIssue !== null (ENG-5)
creditShortHold(away: number): void       // ENG-5: deferTrainsForReturn → away/TICK неактивных тиков в одном клоне; trainSoon из зачёта не испускается, toastFor = −1, если зачёт его менял → «К путям!» на первом же тике с настоящим отсчётом, один раз
rewarnTrains(): void                      // toastFor = −1: «К путям!» заново на следующем тике (creditHold после паузы > 0.5 с)
catchUp(seconds, o?: { report?: boolean }) // report: false — зачёт без «Пока вас не было» (церемония дольше минуты при видимой вкладке)
setFocus(job)                              // теперь ещё ставит flags.focus_manual (ENG-1: автофокус новорождённых выключается)
setSteamPriority(p: SteamPriority): void   // ENG-4, PAN-1 «вентиль пара»
migrate(to?: DistrictId): void             // ENG-11: район из migrationPreview().options (принимается любой свободный на этом круге); без аргумента — options[0]
applyHint(h)                               // HintAction "assign" с setFocus: переводит крыс и делает работу фокусом БЕЗ focus_manual
devTrigger(id, variant?: TrainVariantId)   // для metro_train: следующий поезд — этого варианта (circus, fog, …)
devHandleAllowed(nodeEnv, search): boolean // window.__rr и ?slot= — в dev всегда, в production только с ?dev (REP-2 e2e)
```
`window.__rr` (= `useGame`) теперь есть и в production-сборке, если в адресе есть `dev` (`?dev`, `?dev=1`, `?slot=x&dev`).

### Удержание часов и поезда — `engine/hold.ts`, `engine/events.ts` (ENG-5)

```ts
type HoldCredit = "pause" | "ticks" | "catchUp";  SHORT_HOLD_SEC = 60
holdCredit({ away, ceremony, scene }): HoldCredit   // pause: away ≤ 60 и (церемония или scene.interactive); ticks: away ≤ 60; иначе catchUp
deferTrainsForReturn(s, away): number[]  // поезда (капсула до Метро, метро, экспресс) раньше s.time+away+15 → s.time+away+15+h·10 (хеш, не ГСЧ), кроме уже объявленного, что придёт не раньше конца зачёта + 1 с; свисток едет с ними; экипаж (крупный план / дождь через решётку) переносится так же, без тоста; «К путям!» самого раннего перенесённого придержан до releaseDeferredToast
releaseDeferredToast(s, deferred): void
```
`useGameLoop` переходит на `holdCredit` в ENG-5 (там же передышка 35 с после сцены). SCN-1 замораживает часы сцены, пока `isHeld` или вкладка скрыта; AUD-1 ставит звук на паузу по `isHeld`.

**ENG-5, готово.**
```ts
// engine/hold.ts
MIN_CREDIT_SEC = 0.5
interface HoldStore { game: Pick<GameState, "scene">; creditShortHold(away); catchUp(seconds, o?: { report?: boolean }); rewarnTrains?() }   // useGame.getState() подходит
creditHold(st, away, ceremony, drivenScene = false, wasHidden = true): HoldCredit   // pause — ничего (> 0.5 с: rewarnTrains), ticks — creditShortHold (> 0.5 с), catchUp — catchUp(away, { report: wasHidden })
// engine/events.ts
trainBreather(s): void              // в endScene: поезд метро / экспресс раньше s.time + 35 → s.time + 35, whistleUsedFor вместе с ним
EVENT_TIMING.trainBreather = 35
```
- `useGameLoop`: `hold()` запоминает, вёл ли интерфейс сцену (`scene.interactive`) в момент начала удержания; `release()` = `creditHold(store, away, былаЦеремония, вёлСцену)`. Тем же `creditHold(store, gap, false)` засчитывается «сон» вкладки без `visibilitychange` (разрыв кадров > 2 с): сцена на экране ждёт, поезд переносится. Ручных `advance(away/TICK)` в цикле больше нет.
- `creditShortHold(away)` в сторе: `deferTrainsForReturn` → `min(600, away/TICK)` неактивных тиков → publish; «К путям!» приходит на первом же тике после зачёта с настоящим отсчётом (тест: `v3hold.test.ts`). `useGameLoop` передаёт в `creditHold`, была ли вкладка скрыта за удержание. `loadFromStorage` и `adopt` сбрасывают `toastFor`. «Гул из глубины» не играет, если `meta.seenEvents` уже содержит `metro_train`. Долгий кадр (> 10 тиков) в `advance` не считает подсказку прочитанной: `resumeHintClock` (как и `simulateOffline`).
- Передышка вызывается в `endScene`, значит и в симуляторе, и в `abortScene`. Капсулы она не трогает. Симулятор считает `RunReport.unwarnedTrains` — поезда метро/экспрессы, перед которыми 31 с не было `trainSoon` (цель 0, печатается в строке «сцены» отчёта забега).
- Тесты — `src/game/engine/v3events.test.ts` («ENG-5»: пауза на настоящем сторе, `creditShortHold(40)`, передышка после экспресса, `isHeld`).

### Цели и старейшина — `engine/goals.ts`, `engine/hints.ts` (ENG-1)

```ts
ETA_LONG_SEC = 7200                                   // ETA дольше — «долго»
potentialRate(s, d, r): number;  potentialRates(s, d): ResMap   // производство без потолка склада (конвертеры по входам); 🍞 — за вычетом прокорма
projectBottleneck(s, d, need: Amounts, paid?: Amounts): { res; remaining; etaSec; full } | null   // самый медленный ресурс; rate≈0 → Infinity, никогда NaN; null — ничего не осталось
expeditionBottleneck(s, d, zone); expressBottleneck(s, d)
currentProject(s): { kind: "expedition"; zone } | { kind: "express"; stage } | null   // как GoalWidget: экспедиция (не во время копки), иначе экспресс
buildNowPick(s, d): { id: BuildingId; kind: "useful" | "cheap"; minutesSaved: number | null } | null
newbornTarget(s, d): { job: JobId; auto: boolean; reason: string | null }   // куда пойдёт следующий новорождённый; auto/reason — ENG-1
type HintAction = … | { kind: "assign"; job; n; setFocus?: boolean }
```
`buildNowPick`: кандидаты — видимые, по карману, не на максимуме, не склады, не упираются в лимит; «useful» — наибольшее сэкономленное время текущего проекта (≥ 0.05 мин) на рыночную цену, иначе «cheap» — самое дешёвое. Флаги `focus_manual` (игрок выбрал фокус сам; старые сохранения с фокусом ≠ собиратели получают его при загрузке), `first_rumble`, `first_carriage`. Кто: COL-2 («Цели колонии» 2.0: `buildNowPick`, `projectBottleneck`, `currentProject`, `ETA_LONG_SEC`), PAN-1 (`newbornTarget`, бейдж «авто»).

**ENG-1, готово (уточнения без смены сигнатур).**
- `potentialRates` — конвертеры ограничены входами: остаток входа после производителей и предыдущих конвертеров плюс запас/600 с; входы чистые (минус то, что сжигают конвертеры), 🧀 — минус сырная диета. Половина «потенциала» живёт в новом `engine/potential.ts` (её зовёт тик экономики — автофокус; без циклов импорта), `goals.ts` реэкспортирует всё оттуда — UI импортирует, как и раньше, из `goals.ts`.
- `buildNowPick`: прирост постройки = `levelGain` + её новые места, занятые лишними крысами (`donorPool`), так первая мастерская ценна своими ⚙️; своя цена вычитается из запасов проекта; пока полное жильё держит колонию ниже нужного числа крыс (`crewTarget`), выбор не трогает цену следующего гнезда (`pickReserve`).
- `newbornTarget`: `auto` = `autoFocusOn(s)` = `!flags.focus_manual && s.assignMode === "focus"` (**отступление от черновика**: автофокус работает и после «Цепочки передачи», пока игрок не выбрал звезду и не включил пропорции; «Пневмоприказы» включают умное распределение и выключают его). `reason`: «для «Канализации» не хватает 🪙», «крошек впритык: сперва прокормить колонию», «еда в минусе: …» или null. Тот же выбор делает `core.newbornJob` в тике (на каждого новорождённого).
- `HintAction`: `contribute` += `keep?: Amounts` (что оставить на складе), `assign` += `from?: JobId[]` (из каких работ брать крыс; без него — весь `donorPool`). `store.applyHint` = `hints.applyHintAction(s, d, h, ctx)` в `mutate`.
- Гистерезис подсказки: новое поле `GameState.hintMemo: HintMemo = { id; since; muted; mutedUntil }` (по умолчанию пустое; сохраняется). `store.advance` раз в секунду игры зовёт `trackHint`; `nextHint` пропускает заглушённую подсказку — UI ничего менять не нужно.
- `revealed.goal` — с `flags.vagrants` (раньше 120 с).

```ts
// engine/goals.ts (кроме контракта выше)
buildGain(s, d, id, rates?, needed?): Partial<ResMap>   // прирост «Выгодно сейчас»
pickReserve(s, d): Amounts                               // что «Выгодно сейчас» не тратит (цена гнезда для экипажа)
// engine/potential.ts (реэкспорт из goals.ts)
AUTO_FOOD_MARGIN = 1.3; STOCK_HORIZON = 600
type Project; interface Bottleneck; interface Donor { job; n }
crumbGross(s, d, rates?); foragerOutput(s, d); foragersNeeded(s, d, margin, rates?); upkeep(s)
bottleneckAt(s, d, rates, need, paid); projectShortfall(s, d, need, paid?, rates?): Bottleneck[]  // все недостающие, медленные первыми
projectNeed(s, p); projectForText(p) /* «для «Канализации»» */; projectName(p) /* «экспедиция «Подвалы»» */
jobFor(s, d, r, rates?): JobId | null      // куда поставить крысу ради r (голодный конвертер → поставщик входа)
slotMakerOf(r): { job; building } | null
crewTarget(s): number                       // экипаж экспедиции на карте, иначе порог её показа
neededSet(s, d, rates?): Set<ResId>
donorPool(s, d, target, rates?, needed?): Donor[]   // кого «Сделать» может забрать: бездельники, бригады с переливом, потом собиратели сверх 1.3× (пока 🍞 в цене цели — лишь сколько её ускоряет)
movableTo(s, d, target, pool): number
jobsAfterMove(s, target, pool, n): Record<JobId, number>; shortfallAfterMove(s, d, target, pool, n): Bottleneck[] | null
fasterShortfall(a, b): boolean               // goals-1: сколько собирателей перевести, не сделав 🍞 самым медленным
autoFocusOn(s); autoFocus(s, d, rates?): { job; reason }
// engine/hints.ts
HINT_STALE_SEC = 180; HINT_MUTE_SEC = 60; STORE_LEVELS_MAX = 3
trackHint(s, d): Hint | null; hintTaken(s, id); applyHintAction(s, d, h, ctx): boolean
resumeHintClock(s)                          // goals-5: часы подсказки с нуля после отлучки (offline.ts, store.advance при кадре > 10 тиков)
crewAcc(job, n)                             // «6 собирателей», «22 барахольщика»
// engine/actions.ts
applyAssignHint(s, d, job, n, setFocus?, donors?)   // donors — по порядку; без них: собиратели сверх запаса еды, бездельники
contributeExpeditionKeeping(s, zone, keep, ctx)
```
Порядок правил и тексты — GDD 12.6. `storageHintFor` больше не предлагает склад, чей следующий уровень сам упирается в лимит, и не просит больше 3 уровней (`common.tsx` может убрать свою поправку `storeLink`).

### Пар — `engine/economy.ts`, `engine/actions.ts` (ENG-4)

```ts
GameState.steamPriority: "works" | "power"   // works (по умолчанию) = плавильни и кузни первыми (порядок v2); power = прессы и часы первыми
setSteamPriority(s, p)                       // + store.setSteamPriority
steamBudget(s, d): { supply; cap; press; clock; conv; eff }   // supply — что дадут кочегары без потолка буфера; press/clock/conv — запрос в 💨/с на полном ходу; eff — КПД прессов и часов
```
Кто: PAN-1 (вентиль), COL-1/COL-2 (манометр), AUD-2 (пар слышен; читает `s.steamEff`, `caps.steam`).

**ENG-4, готово.**
- Котёл: `BUILDINGS.boiler.maxLevel = 12`; в `derive` эффекты котла считаются по `min(уровень, d.boilerMax)`, `d.boilerMax = boilerMaxLevel(districtMods.boilerMaxDelta)` (12 + район; Гончарни +2 — ENG-11). Сохранение v2 с котлом 28 грузится с 28, но места кочегаров и буфер — как у 12. Бюджет на максимуме: 24 × 3 × 1.5 × 1.25 = 135 💨/с.
- Покупка выше максимума закрыта везде: `formulas.buildingMaxLevel(s, id)` (для котла — с поправкой района; остальные — `maxLevel` или ∞) и `atMaxLevel(s, id)` читают `maxAffordable`, `buyCount`, Прораб, кошелёк («Пуговица фортуны»), рынок, `buildNowPick`, подсказки складов и бот симулятора. **UI:** где карточка проверяет `BUILDINGS[id].maxLevel` сама, лучше звать `atMaxLevel(s, id)` (для котла в Гончарнях иначе разойдётся на 2 уровня).
- `tickEconomy`: на `"power"` фаза пара прессов и часов идёт сразу после кочегаров, перед первым конвертером, который ест пар (`STEAM_CONVERTERS` = плавильщики, кузнецы); на `"works"` — после всех конвертеров, как в v2 (вывод симулятора по умолчанию не меняется). `levelGain` на «прессам» считает запасом весь пар кочегаров.
- `hints.steamBudgetLine(s, d)` → «бюджет 135 💨/с: прессы 44 · часы 50 · плавильни/кузни 26»; то же в `steamBreakdown().budgetLine`. `steamBreakdown().fix` больше не советует котёл, когда он на максимуме (`null`: дальше решает вентиль).
- Бот симулятора: на «прессам» (`power`), пока экспресс ждёт ресурс, который ускоряет общий множитель; на «заводу», когда ждёт 🔔/🛤️ (их делают плавильни и кузни), 📜/💍 или экспресса ещё нет (`Bot.steamWant`).

### Поезда, опасности, туман — `engine/events.ts`, `data/events.ts` (ENG-8, ENG-9)

```ts
Scene.crash: boolean                    // уже было: авария на позиции бригады (ENG-8: ещё и половина автосбора)
crashChance(pos, variant = "normal", royal = false): number   // CREW_POSITIONS[pos].crash × variant.crashMul × 1.5 для экспресса
expectedAuto(pos, variant, base, cap = 0.9): number           // min(cap, base·auto(pos))·(1 − 0.5·crashChance)
vigilance(S, from = 50): number         // доля ценности поезда, что достаётся крысам: 1 до from, 0.5 при 100
HaulSummary.vigilance?: number          // доля, отнятая бдительностью (ENG-8)
TrainVariantDef: crashMul?, bounces?, restitution?, launchMul?, fog?; gate += "fog"
TRAIN_VARIANTS.circus  // 🎪 «Цирк Сэнгера»: bounces 3, restitution 0.72, launchMul 1.25, physics "bounce" (вес 0 до ENG-9, затем 0.08)
TRAIN_VARIANTS.fog     // 🌫️ «Гороховый суп»: fog: true, sMul 1.2; принудительно, пока fogActive
fogActive(s): boolean                   // s.time < s.buffs.fogUntil; в тумане addSuspicion не прибавляет (уже работает)
catLungeAt(seq, n): number              // пик n-го выпада Кота от начала боя: 0.6 + 1.1·n ± 0.15 (хеш); замах за 0.3 с до пика
CAT_COUNTER_WINDOW = 0.18               // ± от пика
SceneAction {a:"taps"; cleared; fastMs?; perfect?: number}   // кот: отбитые выпады; ≥ 3 → награда ×1.5, тост «Кот бежит, поджав хвост!» (уже работает)
ScenePhase "warn" у экипажа + Scene.tutorial?: boolean        // первый экипаж — урок ловли (ENG-9)
Shiny.kind?: "carriage"; Shiny.amt?: number                    // дождь у решётки после Метро; clickShiny берёт amt (уже работает)
GameState.carriagePass: { seq; until } | null                  // экипаж проезжает над решёткой: мини-сцена неба, копыта
Buffs.fogUntil: number                                         // 0
Fx { k: "deepRumble" }                                         // «Гул из глубины» (ENG-9), один раз
metroTeaser(s): string | null                                  // «🚇 ??? — там ходит Бог Грома» после first_rumble до открытия Метро
```
Кто: SCN-2 (`crashChance`, `expectedAuto`, `scene.crash`, `TRAIN_VARIANTS` bounces/fog), SCN-4 (`catLungeAt`, `CAT_COUNTER_WINDOW`, `perfect`, `scene.tutorial`, фаза `warn`), COL-1 (`Fx deepRumble`), COL-4 (`Shiny.kind`), SHL-5 (`s.carriagePass`, `scene.variant`), PAN-2 (`metroTeaser`), AUD-2/AUD-4 (`Fx deepRumble`, вариант поезда). `TRAIN_VARIANT_IDS` += `circus`, `fog` (журнал путейца покажет две новые марки). Для проверки в браузере: `__rr.getState().devTrigger("metro_train", "circus")`.

**ENG-8, готово.**
- **Бдительность.** `buildTrain` умножает ценность каждого предмета поезда и капсулы (и 💍) на `vigilance(s.suspicion, d.vigilanceFrom)` при сборке состава; `Scene.vigilance?` (новое необязательное поле) = отнятая доля, `haul.vigilance` её получает. `Derived.vigilanceFrom` = `districtMods.vigilanceFrom ?? 50` (`VIGILANCE_FROM`). `suspicionInfo()` += `vigilance` (доля, отнятая сейчас), `vigilanceFrom`, `vigilanceLine` («Бдительность людей: −12% к добыче поездов (выше 50 👁)», ниже порога — правило). **UI:** Header/SuspicionTip может показать `vigilanceLine`.
- **Офлайн.** `d.offline.eta = min(1, …)`; `RANKED.eternal_night_shift = [0.25, 0.25, 0.25]`; `d.offline.capSec = 3600 × ranks.offlineHours(s)` = 2 + 2·[night_shift] + 4·[указ] + 2·(ранг − 1) ч (до 12). Тексты рангов: «…лимит времени +6 ч» / «+8 ч».
- **Печати.** `Derived.excludedMult` / `excludedParts` — множитель печатей на 📜 и 💍 (`resMult` для `excludeGlobal`, кроме 💨): Династия `1 + 0.1 × migrations`, Тишина `SILENCE_EXCLUDED_MULT` 1.3; клик ×2 Тишины убран. Венцы печати не трогают (`crownBonusMult` без изменений).
- **Ранги II/III.** `ranks.CLICK_BLUEPRINTS = [0, 0.005, 0.01]`: ручной клик (не автоклик) даёт эту долю `potentialRate(📜)` (`actions.click`, без Fx). `ranks.PURSE_TRINKETS = { chance: [0, 0.2, 0.3], amount: [0, 3, 6] }`: кошелёк проверяет `hash01(lifetime.purses, 0x7e57)` (не ГСЧ сима), даёт 💍 с Fx `drop` и дописывает в тост «А в подкладке ещё N 💍!».
- **Авария.** `CREW_POSITIONS`: стена 0.85, шпалы 1.15. `beginCatch` берёт риск `sceneCrashChance(s, sc)` = `crashChance(position, variant, royal)` × 0.5 с `timetable_in_head`; при аварии `sc.crash = true`, `sc.auto *= CRASH_AUTO_MULT` (0.5), испуг 3% на 90 с, тост и заметка карточки «Авария …! Тележки перевернулись: автосбор ×0.5». Офлайн-поезда по-прежнему без аварий, у рельсов.
- Бот симулятора стоит у рельсов; `--seal railway|silence|dynasty|auto` (`SimOptions.seal`, `SimSeal`) навязывает печать для абляции.

**ENG-9, готово.**
```ts
// data/events.ts
EVENT_TIMING += carriageWarn 2, tutorialItemLife 3, tutorialWindow [0.5, 7], rainCount [6, 10], rainS 10, rainLife 6,
                rainAuto 0.25, rainPass 7, fogInterval [1200, 1800], fogLength 180, rumbleAt 390, rumbleRats 10
EVENT_LINE_POOLS.carriage / .capsule: LinePair.drops / .gift у строк (таблица — GDD 8.3)
TRAIN_VARIANTS.circus.weight = 0.08
DEEP_RUMBLE { icon; toast; news: [👤, 🐀] };  FOG_TOAST { icon; text };  GRATE_RAIN_TOAST { icon; text }
HEADLINES.fog                                  // одна строка: без броска ГСЧ
// types.ts
Timers.fog: number                             // Infinity до Метро; v2/старые v3 сохранения получают Infinity (mergeDefaults), первый тик с Метро назначает
// engine/events.ts
lineTable(s, d, line, base): { drops; k }      // таблица строки и множитель ценности: средняя рыночная цена предмета = как у base
carriageToast(sc): string                      // «Экипаж: поймано 5/8 — 🍞+64 🪙+9 (без вас было бы 🍞+21)»
sweepShiny(s, d, sh, ctx?): number             // неподобранная подкова: 25% amt (тик фона, simulateOffline)
fogGap(t): number                              // 1200 + 600·hash(t) с
CAT_COUNTER_HITS = 3; CAT_ROUT_COUNTERS = 3; CAT_ROUT_MULT = 1.5; catHits(plain, perfect)
catFightSec(hp): number                        // бой с котом: 10 с или дольше — до выпада, которым он побеждается одними контрударами, + CAT_FIGHT_TAIL
CAT_FIGHT_TAIL = 0.5                           // с после окна последнего контрудара (отскок и «БАЦ!» доигрывают; ревью SCN-4)
```
- **Кот.** `startCat` ставит `taps.duration = catFightSec(hp)`, выбор «Отбиться» входит в `taps` на эту длительность: до 24 hp бой 10 с, как в v2, 25–27 hp — 11 с; кот 40 hp (9-й и дальше) — 16 с, чтобы 14 контрударов (42 удара) успевали (`catLungeAt(seq, 13)` ≤ 15.05 с, плюс окно 0.18 с и хвост 0.5 с). Интерфейс (CatScene) уже берёт длину боя из `scene.taps.duration`. Бот симулятора отвечает на 5-й секунде — его прогон не меняется.
- **Урок ловли.** `startCarriage` при пустом `flags.first_carriage`: сцена в фазе `warn` (2 с, `tutorial: true`), предметы ставятся ровно от 0.5 до 7 с (броски ГСЧ те же, что у обычного экипажа), `itemLife` 3; `autoResolvePhase("warn")` у экипажа = вход в `catch` (ловля 10.3 с); `resolveCatch` умножает пойманное лапой на 2 (`TUTORIAL_HAND_MULT`), а предметы урока стоят половину (`TUTORIAL_ITEM_MULT` 0.5): лапа получает ценность экипажа v2, автосбор — половину (ловля = 8× автосбора); с полной ценностью урок сдвигал первые 11 минут бота на 1:15 вперёд. Флаг ставится в конце, как раньше. Выбор `choice` в фазе `warn` экипаж игнорирует (бот симулятора шлёт его всем `warn`).
- **Строка решает добычу.** `resolveLine` теперь несёт `drops`/`gift` строки в `scene.line`. `startCarriage` и `buildTrain` для капсул берут `lineTable(s, d, sc.line, обычная таблица)`; `addGift` кладёт подарок одним лишним предметом (id = `items.length`, вагон и момент — `hash01(seq, 304/305)`). Нераскрытый ресурс подарка — через `trainDropRes`, кроме 💍.
- **Дождь у решётки.** С Метро `tickEvents` при `timers.carriage ≤ t` (без сцены, вне правила 20 с и охраны поезда) зовёт `startCarriage` → `startGrateRain`: строка по `hash01(seq, 101)` (в бестиарий не пишется), 6–10 `Shiny {kind: "carriage", amt}` + подарок, `s.carriagePass = { seq, until: t + 7 }` (тик фона обнуляет его по истечении), `stats.carriages++`, тост `GRATE_RAIN_TOAST`, новость `carriage`. Истёкшие подковы: `sweepShiny` и один Fx `drop` на ресурс (без `x/y/frac` — не «тинь» клика). Бот симулятора ловит подковы с `catchRate`, обычные блестяшки — с 50%.
- **Туман.** `tickEvents`: с Метро `timers.fog` назначается (`fogGap`), в срок, без сцены и когда поезд метро придёт не позже чем через `fogLength − 30` = 150 с (в каждом тумане есть туманный поезд) — `buffs.fogUntil = t + 180`, тост `FOG_TOAST`, новость `fog`. Пассивный рост подозрения в тумане тоже стоит (`!fogActive`), фонарь `fog`-варианта — 0.4. Симулятор считает `RunReport.fogs` и `rainPasses`.
- **Гул из глубины** — в `tickBackground` (только онлайн): `deepRumble`, тост, две `pushNews`; таймеры событий и ГСЧ не трогает (тест на двойнике: `rng` и все таймеры, кроме газетной «затычки», совпадают).
- Тесты — `src/game/engine/v3events.test.ts` («ENG-9 (A)…(G)»); `save.test.ts` — `timers.fog` у старого сохранения. Поменялись старые тесты: «фон под сценой» (`events.test.ts`) и «фон при голодном поезде» (`v2review.test.ts`) берут экипаж до Метро, χ² вагонов — с уже виденными вариантами, `clone.slow.test.ts` больше не ждёт сцену экипажа после Метро, `v3contract` «goals» кликает, как игрок (его 10 🍞 раньше давал экипаж).

### Кунсткамера — `data/curios.ts` (ENG-10)

```ts
type CurioId (24, CURIO_IDS в types.ts); type CurioOwner = "pemberley"|"wiggins"|"ashby"|"hatchett"|"grant"|"city"
CURIOS: Record<CurioId, CurioDef>         // {id, name, icon, owner, source:{scene, car?, variant?, special?}, human, rat, hint}
CURIO_SETS: Record<CurioOwner, CurioSetDef>; CURIO_SET_ORDER; CURIO_ORDER; TROPHY_CURIO
curioSets(s): { owner; name; icon; perk; items: {id; owned}[]; done }[]   // витрина по наборам
curioSetDone(s, owner): boolean
Meta.curios: CurioId[]                    // навсегда; неизвестные id при загрузке выбрасываются; трофеи v2 → первые экспонаты
CatchItem.curio?: CurioId                 // ценность 0, вес 0 (на рейтинг не влияет)
HaulSummary.curio?: CurioId;  Fx { k: "curio"; id }
медали first_curio, curio_full (progress stat "curios", 24)
```
Кто: PAN-2 (витрина), SCN-2 (метка диковины в поезде, `HaulSummary.curio`), AUD-2 (`sfx3 curio`, `Fx curio`). Выпадение, перки, выдача медалей — ENG-10.

**ENG-10, готово.**
```ts
// data/curios.ts (чистое: выпадение и перки; хеши номера сцены, ни одного броска ГСЧ)
type CurioScene = "metro_train" | "royal_express" | "carriage" | "capsule" | "downpour"
CURIO_CHANCE = { metro_train: 0.04, royal_express: 0.12, carriage: 0.02, capsule: 0.02, downpour: 0.04 }
CURIO_RICH_CARS = ["first", "baggage"]; CURIO_RICH_MULT = 2; CURIO_LIFE_ADD = 1.5; CURIO_GLOBAL_PCT = 0.5
CURIO_BELL_CHANCE = 1/3; CURIO_SALT = 0xc0710
CurioDef.source.also?: SceneEventId[]           // ещё где выпадает: перчатка и монокль — и в плавучем мусоре Ливня
interface CurioSceneInfo { id; seq; cars: {kind; special?}[]; variant? }   // Scene подходит; дождь у решётки — один «экипаж»
curioCandidates(s, sc): {id; car; w}[]           // неполученные диковины этой сцены по вагонам (w = 2 в 1-м классе и багажном)
curioChance(s, sc): number                       // CURIO_CHANCE × max(w); 0 без кандидатов
rollCurio(s, sc): { id; car } | null             // hash01(seq, SALT) < шанс → взвешенный выбор hash01(seq, SALT+1)
curioPerks(meta): CurioPerks                     // { purseEffect 1.25, findMult 1.25, royalItems 2, sparkMult 0.8, rumbleAdd 3, charterMult 1.06 } за полные наборы
CURIO_PERK_VALUES; curioMult(meta)               // часть «Кунсткамера» = 1 + 0.005·n
curioSetDone(s, owner)                           // параметр расширен до { meta: { curios } }
// engine/curios.ts
catchCurio(s, id, ctx?): boolean                 // meta.curios (+ трофей v2 cat_fur/broken_pipe), Fx curio, пара в газете, first_curio / curio_full, тост полного набора
curioNews(id): [👤, 🐀]                          // «👤 {human}» / «🐀 В Кунсткамере пополнение: «{name}»»
addCurioItem(s, sc): { id; car } | null           // rollCurio → предмет в своём вагоне: value 0, weight 0, lifeAdd 1.5, момент — хеш
// types.ts (необязательные поля)
CatchItem.lifeAdd?: number                       // сколько секунд предмет живёт сверх scene.itemLife (диковина: 1.5)
Shiny.curio?: CurioId                            // диковина в дожде у решётки (amt 0)
Derived.sparkMult: number; Derived.royalExtraItems: number
```
- **Где выпадает.** `buildTrain` (поезд метро, экспресс, капсулы) и экипаж до Метро (не урок) зовут `addCurioItem` после всей добычи: состав, предметы и поток ГСЧ те же, что без диковины. Поезд метро: кандидаты — диковины его вагонов (`source.car`), варианта (`source.variant`: шпора — товарняк, мешок — почтовый на Эдинбург; любой вагон, кроме паровоза) и сырного вагона (`special`); шанс 4%, а если среди кандидатов есть диковина 1-го класса или багажного вагона — 8%, и такие выбираются вдвое чаще. Экспресс — только королевский вагон, 12%. Дождь у решётки после Метро: `rollCurio` по номеру прохода, диковина — отдельная подкова `Shiny {kind: "carriage", amt: 0, curio}` (живёт на 1.5 с дольше; `clickShiny` отдаёт её в Кунсткамеру с тостом «В Кунсткамеру: «…»!», неподобранная пропадает). Ливень: после закрытых вентилей плавучий мусор может принести перчатку или монокль (`also`). Кот: первая победа даёт клок шерсти, следующие — бубенчик Мурзифера с шансом 1/3 (хеш номера сцены), при бегстве кота (≥ 3 контрудара) — наверняка; Крысолов — сломанную дудку при победе. Трофеи v2 по-прежнему пишутся в `meta.trophies`.
- **Ловля.** `resolveCatch`: диковина не входит ни в долю рейтинга, ни в «поймано X/Y», ни в «Вагон чист!», ни в кучи; её ловят лапа, сеть или заводные крысы (как в CatchCanvas), тогда `catchCurio` и `haul.curio`. Уже полученная не выпадает; упущенная может выпасть снова. `catchDuration` учитывает `lifeAdd`.
- **Перки.** `derive`: часть «Кунсткамера» после «Медалей»; `purseEffect` ×1.25, `dropMult` ×1.25, `rumbleMetro` +3 (и экспресс), `sparkMult` 0.8 (искры вагона `round(искры × 0.8)`), `royalExtraItems` 2 (королевский вагон); `metaMath.charterMult(s)` — ×1.06 при ≥ 1 грамоте (поле `meta` необязательно: `charterMult({charters: n})` для панелей, как раньше).
- **Медали.** `first_curio` — при первой диковине, а также в housekeeping, если экспонаты уже есть (трофеи v2); `curio_full` — на 24-й (и счётчик «curios»).
- **Симулятор.** Бот ловит диковины как обычные предметы (`catchRate`) и подковы дождя; `RunReport.curiosOwned`; `--long` печатает «+N (M/24)» и проверку «Кунсткамера после 7-го забега: 8–18 из 24»; `SIM_OVERRIDES` `curios` меняет шансы.
- Тесты — `src/game/engine/v3content.test.ts` («ENG-10»).

### Лондон — `data/districts.ts`, `engine/narrative.ts`, `engine/actions.ts` (ENG-11)

```ts
type DistrictId (12, DISTRICT_IDS в types.ts); DISTRICTS: Record<DistrictId, DistrictDef>   // {id, name, loc, icon, trait, fillers, landmark, pos:{x,y} 0..100, neighbors}
DISTRICT_ORDER; LEGACY_DISTRICT_SEQ                       // старый маршрут + шесть новых (для старых сохранений)
type DistrictInfo = { id; name; loc; icon; trait; lap };  type DistrictOption = DistrictInfo
districtInfo(meta): DistrictInfo                          // текущий район (имя с «II» на втором круге, черта ×1.25; с третьего круга ×1.25², не сильнее)
districtAt(meta, index); districtById(id); districtInfoOf(id, lap?); districtOptions(meta); districtFree(meta, id); legacyVisited(i); legacyDistrictId(i)
migrationPreview(s).options: DistrictOption[]             // до двух вариантов, options[0] — по умолчанию (nextDistrict/nextTrait = options[0])
migrate(s, now, ctx, to?: DistrictId)                     // + store.migrate(to?)
Meta.districtId: DistrictId; Meta.visited: DistrictId[]   // meta.district = visited.length − 1 (индекс, как раньше)
Fx migration.districtId?; RunHistoryEntry.districtId?
DistrictMods.boilerMaxDelta?; DistrictMods.vigilanceFrom? // ENG-4 / ENG-8
Cond { migrations: number }; describeCond → «после первого Великого Переселения»   // ENG-3
```
Кто: PAN-2 (карта Лондона: `DISTRICTS[id].pos/neighbors/landmark`, `migrationPreview().options`, `migrate(to)`, летопись по `districtId`), SHL-5 (`districtInfo` для неба и эпилога), AUD-3 (музыка по `districtInfo(meta).id`). Черты первых шести и по 4 строки газеты на район — ENG-11. Движок (derive, таймеры, газета) уже берёт черту и строки газеты из текущего района.

**ENG-11, готово.**
```ts
// data/districts.ts
DISTRICT_TRAITS; amplifyMods(m, k); lapNumeral(n)   // перенесены сюда из data/zones.ts (zones реэкспортирует: без цикла импорта)
DistrictInfo.loc                                     // на втором круге с номером: «в Сити II»
districtOptions(meta)                                // свободные соседи текущего района (≤ 2): следующий по старому маршруту первым, если он среди них, остальные — по хешу номера переселения; не хватает соседей — ближайшие свободные
// types.ts: DistrictMods += satietyMult? (сама «Сытость», нет = 1.25), metroInterval? (с между поездами метро, нет = 240)
// engine/derive.ts: SATIETY_MULT = 1.25; METRO_INTERVAL = 240
// data/zones.ts (старые помощники; для старого маршрута, с meta — по настоящему)
districtName(index, meta?); districtLoc(index, meta?); districtTrait(index, meta?)   // DISTRICTS / DISTRICT_LOC — 12 имён старого маршрута
// data/meta.ts
EXPRESS_STAGE_LINE_SETS: LinePair[][]               // 3 пары на этап: первый экспресс, второй, дальше
expressStageLine(stage /*1..10*/, coronations): LinePair   // min(coronations, 2); EXPRESS_STAGE_LINES = первые пары (как раньше, LinePair[])
CORONATION_LINES: LinePair[]                         // 10 пар по номеру коронации: {weekday} {one} {nth} {Nth} {weeks}
// engine/narrative.ts
ordinalF(n); storyWeeks(migrations); weeksText(migrations)   // «за неделю» при migrations < 7, иначе «за 2 недели», «за 5 недель»
expressLineSet(s): number                            // какой набор строк этапов читает экспресс забега: meta.coronations − (коронован в этом забеге ? 1 : 0); его берут новость этапа и (по UI REQUEST) ExpressPanel
coronationLine(s)                                    // та же сигнатура: CORONATION_LINES[n−1], после 10-й — строки 2–10 по кругу
// data/headlines.ts: filler_crowned (8), filler_late (6, с 4 переселений); filler_d0…d5 убраны (строки районов — DISTRICTS[id].fillers)
// engine/step.ts
fillerPool(s): string[]; LATE_FILLER_MIGRATIONS = 4  // общие + зона + 4 строки своего района + коронованные + поздние
```
- **Черты.** Боро-маркет: «Сытость» ×1.5 и рынок раз в 4–5 мин / 📜 −25%. Гончарни: ⚙️ ×1.5, котёл до 14 / поезда метро раз в 300 с. Читальный зал — без изменений. Особняки: 🪙 ×1.5, кошельки ×2 / 💍 −25%. Биг-Бен: экспресс ×0.6, 💍 ×1.35 / 📜 −20% и бдительность с 30 👁 (план — 💍 ×1.5 и 40: по абляции он один выходил за −12%, GDD 15.17). Шесть новых — как в плане и таблице GDD 10.4 (Сити — подозрение ×1.3, Челси — интервал экспресса ×1.3). Второй круг — `amplifyMods` (новые ключи: «Сытость» 1.5 → 1.625, интервал метро 300 → 315).
- **Маршрут.** По умолчанию (`migrate()` без района, симулятор, офлайн) первые три забега — Уайтчепел → Саутварк → Ламбет, как в v2; дальше — первый вариант карты. `meta.district` по-прежнему индекс (`visited.length − 1`), «Весь Лондон наш» — пройдено ≥ 5 районов (`progressStat("district")` = `visited.length − 1`).
- **Газета.** Строки-затычки берутся из `fillerPool(s)`: района — только текущего (`districtInfo(meta).id`), так что на 7-м забеге больше нет строки Уайтчепела. Новость этапа экспресса — `expressStageLine(stage, meta.coronations).human`.
- **Тексты.** «Жёлоб под тендером»; поручение «Королевская почта» 📯 → «Почётный караул» 🚆, «Сухие лапы» → «Шлюзовая вахта» («…во время ливня»); «Королевский выводок» I — «…и 50 🍞»; «Скряга» — «Переселиться, храня в казне 200 👑»; «Весь Лондон наш» — «Обжить шесть районов Лондона»; котёл и 3-й этап — «Леди Пемберли (дом №12) снова без чайника».
- **Симулятор.** `--district id[@run]` (`SimOptions.district`, `forceDistrict`) навязывает району забег (по умолчанию 3-й), посещённый или нет; `scripts/sim-traits.ts` — абляция черт: забеги 1…n−1 один раз на повтор (снимок), затем забег n с каждой из 12 черт с того же снимка `--samples` раз (по умолчанию 3 повтора × 6 проб = 18 забегов на черту, ~33 мин на 4 потоках) (проба 0 — ГСЧ снимка, проба m — оба потока ГСЧ, игры и бота, пересеяны по m, одинаково для всех черт: парные забеги; `runOne` экспортирован); медиана коронации по повторам × пробам против «Тумана», плюс сдвиг среднего геометрического с 90% бутстреп-интервалом и парная медиана отношений. Пул потоков: сначала снимки, потом по задаче на повтор × пробу × район. Зачем пробы — GDD 15.17: от одного снимка «Туман» коронуется и за 30, и за 64 минуты. `SIM_OVERRIDES` `districts` подменяет моды черт. Бот по ходу абляции исправлен в четырёх местах (GDD 15.14, «После ENG-10/ENG-11»): `planJobs` при вентиле «works» проверяет входы плавилен и кузниц без спроса пресса и часов (как `economy.ts`); `supporter.brass = "smelter"` (кузнецы ставятся с плавильщиками); `chooseBuilding` держит 💍/📜, нужные этапу экспресса, от построек, которые их не делают (`kept`/`makes`/`keep`), и не кладёт их в `wishes`; `enablers` судит по устойчивому потоку (`flows(…, Infinity)`) и добавляет опоры цепочки из `BUNDLES`.
- Тесты — `src/game/engine/v3content.test.ts` («ENG-11»); по смыслу изменены `v2contract` (черты: у района своя черта, второй круг «II» ×1.25), `v2depth` (Боро-маркет: «Сытость» ×1.5, 📜 ×0.75), `v2review` (порог Крысолова — Доки, 85).
- **UI.** `ExpressPanel` читает `expressStageLines(expressLineSet(s))` (`metaText.ts`): тот же набор строк, что и новость этапа.

**Ревизия движка v3 (26.10.2026), дополнения контракта.**
```ts
// data/districts.ts
MAX_DISTRICT = 999; clampDistrict(v: unknown): number   // perf-saves-6: save.ts зажимает meta.district и районы летописи в 0..999
// черты растут ×1.25 за круг только до третьего круга (k ≤ 1.25², ENG-13): дальше интервал экспресса 0.6, минусы 0.75 и порог бдительности уходили в ноль и ниже
// data/zones.ts
zoneAdds(id: ZoneId, meta): string   // pacing-9: «что даёт» зона; у Вокзала без «…после первого Великого Переселения», когда колония уже переселялась
// lib/useBackCloses.ts
BackEnv.history.replaceState         // perf-saves-2: после перезагрузки с открытым оверлеем запись {rr:"ov"} занимается заново, а не дублируется
```

### Мета-математика — `engine/metaMath.ts` (ENG-3, ENG-7)

```ts
crownPctPer(meta): number            // % ко всему за каждый венец: 2 (3 с «Милостью Короля»)
crownsMult(meta): number             // часть «Венцы» в derive
crownBonusMult(s): number            // множитель венцов забега: коронация ×1.25 × грамоты (× печать — ENG-8)
charterMult(s): number               // перенесён сюда; engine/commissions.ts реэкспортирует
charterAtCap(s): boolean             // ещё одна грамота ничего не добавит
expressMult(s); expressBonusPct(s)   // часть «Крысиный экспресс» = (1 + 0.2·этапы)·1.1^вагоны (ENG-3) и «+X% ко всему» в процентах
EXPRESS_STAGE_PCT = 20; EXPRESS_WAGON_MULT = 1.1
```
`derive`, `formulas.crownsForRun` и `migrationPreview` читают эти функции, поэтому панели печатают ровно те числа, на которые умножает движок. Кто: PAN-2 (`expressBonusPct`, `charterAtCap`), SHL (`charterAtCap`). В `src/game` других копий этих правил нет (ни `kings_favor ? 3`, ни `Math.pow(1.05`, ни `20 * stage` вне `metaMath.ts`); тест `v3contract` сверяет помощники с частями `derive()` и с `migrationPreview().bonusBefore` («Бонус ко всему» = (часть «Венцы» − 1) × 100) на всех золотых сохранениях.

### Темп экспресса и мета — ENG-3, готово

```ts
// data/meta.ts
EXPRESS_BASE = { rails: 500, gears: 100000, brass: 10000, trinkets: 50, blueprints: 250 }; type ExpressRes
EXPRESS_GROWTH: Record<ExpressRes, number> = { rails: 1.6, gears: 1.6, brass: 1.6, trinkets: 1.45, blueprints: 1.45 }   // было число 1.55
WAGON_GROWTH = 2; WAGON_LINEAR = 0.5; WAGON_LINEAR_RES = ["trinkets", "blueprints"]   // вагон k: этап 10 × 2^k | × (1 + 0.5k)
// data/upgrades.ts: express_plan.unlock += { migrations: 1 }; UpgradeDef.lockedFlavor? (новое необязательное поле)
// data/commissions.ts
CHARTER_MULT_CAP = 1.63; RETIRED_COMMISSIONS = ["replenish"]; WAGON_OFFER_MAX_SEC = 480; COMMISSIONS.clean_three
// engine/commissions.ts
nextWagonEta(s): number            // projectBottleneck следующего вагона, с; Infinity без чертежа; 0 — всё на складе
// engine/actions.ts
SCOUT_STEPS = [0.25, 0.5, 0.75, 0.9]; SCOUT_NEAR_TEXT = "Разведчики: до цели рукой подать"
expeditionFraction(s, zone)        // по ценности: Σ min(1, внесено/нужно)·нужно·unitValue / Σ нужно·unitValue
// engine/formulas.ts
unitValue(r)                       // перенесён из economy.ts (economy реэкспортирует)
```
- **Ворота переселения.** `upgradeVisible(s, "express_plan")` ложно при `meta.migrations = 0` (купленный чертёж остаётся). **UI:** MapTab может брать текст из `UPGRADES.express_plan.lockedFlavor` вместо своей строки. Медаль `forever_tuesday` — «Короткая неделя — коронация во втором забеге» (`migrations === 1`). Бот симулятора без переселения больше не берёт чертёж (`Bot.project`).
- **Цены экспресса.** `expressStageCost(s, n)`: этап `ceil(база_r × рост_r^(n−1) × 0.75^[чертежи])`, вагон k = n − 10: `ceil(база_r × рост_r^9 × скидка × (2^k | 1 + 0.5k))`. Тост вагона «+10% ко всему» теперь правда (`expressMult`). Медаль «Хвост за горизонтом» — 10 вагонов за всё время.
- **Разведчики.** Шаг 4 (90%) платит как шаг 3, новость `scout_near` («Разведчики: до цели рукой подать! Вернулись …»), Fx `scout` со `step: 4`. **UI:** `Toasts.tsx` для `fx.step === 4` может писать `SCOUT_NEAR_TEXT`; LockedBand уже читает `expeditionFraction`, так что полоса % теперь по ценности.
- **Поручения.** `offerCommissions` не предлагает `RETIRED_COMMISSIONS` и «Ещё вагон», пока `nextWagonEta(s) > 480`. «Пополнение» у старого сохранения доигрывается до 60 рождений (цель 200 → 60). Шаг миграции не нужен: id и описание на месте.
- Тесты ENG-3, ENG-4 и ENG-8 — `src/game/engine/v3balance.test.ts` (ворота, цены, разведчики по ценности, грамоты, поручения и старое «Пополнение», вентиль пара, котёл 12 и сохранение с 28, бюджет 135, бдительность, офлайн по рангам, печати, ранги II/III, авария).

### Сохранения — `engine/save.ts` (ENG-7)

```ts
SCHEMA_VERSION = 3
MIGRATIONS: Record<number, SaveMigration>   // MIGRATIONS[v]: сохранение v → v+1, по порядку от raw.schemaVersion, до mergeDefaults
runMigrations(raw, registry?, to = SCHEMA_VERSION); migrate(raw, registry = MIGRATIONS, to = SCHEMA_VERSION)   // `to` — для тестов будущего шага
```
Шаг 1 → 2 пустой (все поля v2 даёт `mergeDefaults`; `edicts[id] = true` читается как ранг 1). Шаг 2 → 3: `flags.focus_manual`, если фокус ≠ собиратели; `meta.district` → `visited`/`districtId` по старому маршруту (и `districtId` у записей летописи); трофеи → `meta.curios`. Поручение «replenish» (ENG-3 убирает его из выдачи) сохраняет id и описание, поэтому сохранения с ним загружаются без перекройки. Остальные поля v3 получают значения по умолчанию из `mergeDefaults`: шаг нужен, только если данные переезжают, переименовываются или меняют смысл.

**Правило выпуска (обязательно):** изменилась схема сохранения ⇒ (1) поднять `SCHEMA_VERSION` в `engine/state.ts`; (2) добавить шаг `MIGRATIONS[старая версия]` (тест «has a step for every schema below the current one» упадёт без него); (3) снять фикстуры новой версии `npx tsx scripts/capture-fixtures.ts` и **оставить** фикстуры старых версий — они доказывают, что старые сохранения грузятся; (4) случай в `save.test.ts`.

**Золотые сохранения** — `src/game/engine/__fixtures__/saves/*.json`, настоящие строки сохранения (`serialize`), снятые ботом симулятора (`scripts/capture-fixtures.ts`, сид 12345; имя начинается с версии схемы): `v3-run1-10min`, `-60min`, `-150min` (667 крыс, умное распределение), `v3-run1-metro-catch` (поезд посреди ловли), `v3-run1-crowned` (после коронации, поручения), `v3-run3-commission` (ранги указов, печать, активное поручение), `v2-run2-30min` (второй забег в форме сохранения v2: поля v3 сняты, `schemaVersion: 2`). Необязательный `v1-early` снимается движком коммита 18a0f85 через временный `git worktree`, если это git-репозиторий с таким коммитом (иначе тихо пропускается). `save.fixtures.test.ts`: каждое грузится (версия текущая, `scene === null`), играет 600 тиков и 8 ч отлучки; инварианты — нет NaN/±∞ (кроме таймеров), ресурсы ≥ 0, Σ работ ≤ крыс, простые данные.

### Производительность — `engine/clone.ts`, `actions.smartAssign` (ENG-6)

```ts
cloneState<T>(s: T): T                     // глубокая копия простых данных; ничего не делит с s
shareState<T>(prev: T, next: T): T         // next, где поддеревья, равные prev, заменены объектами prev (prev целиком, если ничего не изменилось)
```
Стор: `mutate`, `advance`, `catchUp`, `devWarp` копируют `cloneState`; `mutate` и `advance` публикуют `shareState(prev, next)`. `smartAssign` даёт те же работы, что v2 (оракул — замороженная копия v2 в `smartAssign.test.ts`), но слагаемые снабжения считает один раз за вызов: ≈ 0.14–0.5 мс вместо ≈ 2.8 мс на 667 крысах; `simulateOffline(8 ч)` на 150-минутной колонии ≈ 0.4–0.7 с вместо ≈ 2 с; тик стора на ней ≈ 45–60 % прежнего. Строка SUMMARY `npm run sim -- --seed 12345 --summary` не изменилась ни на байт.

### Тесты и скрипты (ENG-7, REP-1)

- `npm test` (`vitest run`) — быстрый набор без `*.slow.test.ts`. `npm run test:slow` (`--mode slow`) — только медленные, `npm run test:all` (`--mode all`) или `SLOW=1` — всё. Медленные: трёхчасовой прогон бота — `src/game/data/reachability.slow.test.ts`; `cloneState` на каждом 600-м тике трёхчасового забега и 30 минут игры со всеми сценами на замороженном оригинале — `src/game/engine/clone.slow.test.ts`; час газеты (36 000 шагов, перенесён из `v2depth.test.ts`) — `src/game/engine/headlines.slow.test.ts`. Новичок (ENG-2) проходит окна GDD 15.14 на сидах 12345 и 777 — `src/game/engine/newcomer.slow.test.ts`. Быстрый набор под нагрузкой соседних агентов: ≈ 17 с (Duration vitest); `offline.test.ts` берёт золотое сохранение вместо 40 минут бота в `beforeAll`.
- **Общий тест-кит** `src/game/engine/testkit.ts` (только для тестов): `metroState(seed?, {quiet?})` (колония на станции метро, 200 собирателей), `playedState()` (минута игры), `ticks(s, n, active?)`, `triggerEvent(s, id)` (как `devTrigger`), `tourScenes(start, kinds, maxTicks)` (бот проходит сцены на клоне замороженного состояния), `fixtureNames()`, `rawFixture(name)`, `loadFixture(name)` (через `deserialize`), `assertPlain(s)` / `nonPlainPaths`, `nonFinitePaths(s)`, `deepFreeze`, `sharedObjects`. Своих копий этих помощников в тестах не заводите.
- `npx tsx scripts/capture-fixtures.ts [--seed N] [--out dir] [--only name,…]` — снять золотые сохранения заново (≈ 2–4 мин).
- `npm run sim:matrix -- [--seeds 12345,777,1,2,3] [--bots active,passive,newcomer] [--workers N] [--baseline f] [--write-baseline [f]] [--dump f]` — `scripts/sim-matrix.ts` (ENG-2): (сид × бот) параллельно в дочерних процессах (`balance-sim.ts --summary --quiet --tails`), таблица хвостов K3–K6 и новичка по сидам; `--baseline` (`scripts/balance-baseline.json`) — метрики, сдвинувшиеся > 10%, и код выхода 1; `--write-baseline` / `npm run sim:baseline` — записать.
- `scripts/balance-sim.ts` (ENG-2): `--bot newcomer|all`, `--replicates N` (worker_threads, медианы), `--policy never-migrate`, `--runs` до 8 и `--long`, `--steam`, `--binding`, `--tails`; подробности — GDD 15.14. `scripts/simStats.ts` — чистая статистика (судьи проверок, медиана, свод повторов, формат) с тестом `scripts/simStats.test.ts`. `RunReport` += `binding`, `steamLog`, `steamShortSec`, `maxHungry`, `foragerShare`, `newcomer`, `curiosGained`, `wagons`, `crownsLeft`, `sinksLeft`; `SimOptions` += `botSeed`, `policy`, `long`; `Bot` третьим аргументом берёт `{ policy }` и сам ставит `flags.focus_manual` активному и пассивному ботам (их решения не меняются).

## Правила параллельной работы

- Каждый агент правит **только свои файлы** (список в задаче). Движок, данные, типы и стор меняет только владелец движка; если нужен новый экспорт или поле — опишите это в отчёте.
- Не запускайте `next dev` / `next build` (их запускает интегратор). Проверка: `npx tsc --noEmit -p .` — чините ошибки только в своих файлах; `npx eslint <свои файлы>`.
