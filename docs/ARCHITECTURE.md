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
src/game/data/*.ts         таблицы контента: resources, jobs, buildings, upgrades, zones, meta (указы, медали, экспресс), events (вагоны, тайминги), headlines, sources (где взять), commissions (поручения Короля)
src/game/engine/*.ts       чистый движок без DOM: state, derive, economy, events, actions, step, offline, save, formulas, conditions, rng, hints (подсказки), piles (обходчик), narrative (коронация, переселение), progress (медали, поручения)
src/game/store.ts          Zustand-стор: useGame(selector), useDerived(), действия игрока
src/game/useGameLoop.ts    rAF-цикл 10 Гц, автосейв, офлайн при скрытой вкладке
src/game/useSampled.ts     подписка на срез стора не чаще hz раз в секунду (v2)
src/game/fx.ts             шина эффектов: onFx/emitFx (из движка), onUiFx/emitUiFx (из UI: тряска, вспышки, всплывающие числа)
src/audio/sfx.ts           синтез звуков (API ниже)
src/components/ui/kit.tsx  общий UI-кит: BrassButton, Plate, Rivets, ResIcon, CostList, AmountList, Bar, Ring, Odometer, Tip, Badge, Stamp, cx
src/components/GameRoot.tsx раскладка экрана (подключает все компоненты ниже)
src/components/layout/     Header, SkyStrip («Наверху»), ResourceBar, NewsTicker, Toasts
src/components/colony/     ColonyView (SVG-срез подземелья, решётка, камеры, крысы, узкоколейка, кошелёк, блестяшки, Суета, Цель)
src/components/fx/         FxLayer (всплывающие числа и частицы поверх всего экрана)
src/components/panels/     SidePanel (вкладки) + BuildingsTab, JobsTab, UpgradesTab, MapTab, ScheduleTab, MigrationTab, MedalsTab, SettingsTab
src/components/scenes/     SceneHost (крупный план событий) + примитивы catch/piles/taps/timing/choice, MarketPopup
src/components/modals/     OfflineModal, CoronationOverlay
src/components/dev/        DevPanel (только NODE_ENV=development или ?dev в URL)
scripts/balance-sim.ts     headless-симулятор баланса (npm run sim)
```

## Состояние и стор

- `useGame((s) => s.game.res.crumbs)` — выбирайте **примитивы** или маленькие объекты; весь `game` заменяется новым объектом каждый тик (10 раз в секунду) и при каждом действии.
- `useDerived()` — мемоизированные производные значения (`Derived` из `engine/derive.ts`): лимиты, жильё, слоты, множители, сила клика, автосбор поездов, интервалы и т. д.
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
backups(): {slot: 1|2; at: number; rats: number; crownsEver: number}[]   // bak1 = новее; at = epoch ms записи той копии
restoreBackup(slot: 1|2): boolean
rawSave(): string | null                      // строка из localStorage как есть (JSON) — для «Скачать сохранение»
importSaveFile(text: string): boolean         // принимает и сырой JSON (rawSave), и «RATRO1:…»; копия делается до импорта
takeOverTab(): void                           // при saveIssue "locked": «Играть здесь»
startFresh(): void                            // новая колония (настройки сохраняются); недоступно при "newer"/"locked"
```

Типы `SaveIssue` и `BackupInfo` экспортируются из стора. Пока `crashed` или `saveIssue !== null`, игра не тикает, действия игрока игнорируются, `save()` ничего не пишет. Порча сохранения: сырая строка копируется в `quarantineKey` (`<key>:corrupt:<ms>`), основной ключ не трогается до выбора игрока. Ключи копий: `<key>:bak1`, `<key>:bak2`, мета `<key>:bakmeta`. Копии: раз в 5 мин (из `save()`), перед `importSave`/`importSaveFile`, `hardReset`, `startFresh`, `restoreBackup` и перед первой перезаписью сохранения старой схемы. Вкладки: Web Lock `ratropolis:<key>` + BroadcastChannel того же имени. На свежем сейве `settings.reducedMotion` берётся из `prefers-reduced-motion`, `reducedMotionFromOS = true`. Для крэша в dev: `__rr.getState()` / тест-хук `stepHooks.before` в `engine/step.ts`.

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
| HaulSummary | `jackpotSeconds?: number` | джекпот в секундах пассивного дохода (≤ 180, есть только при джекпоте) | EN-1 (готово) / SC-3 |
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
suspicionInfo(s, d): { pct; perMin; activeOnly: true; etaSec: number|null; reducers: {label; amount}[] }
converterBottleneck(s, d, job): ConverterBottleneck | null   // {job, eff, kind:"full"|"input", res, text, supplier?, need?, supplierLocked?, building?}
jobValuePerRat(s, d, job): { value; surplus; capped: ResId[] }
inputRunway(s, d, job): { res; seconds } | null
ratsAcc(n): "крысу" | "крыс" | "крысы"     // «отправьте 3 крыс»
```
`steamBreakdown` — CO-4 (fix: нет котла/мест → boiler, кочегары голодают → miners, есть свободные места → stokers). `suspicionInfo` — SH-3: perMin = 1%·suspicionMult только при активной игре (офлайн 0), etaSec = (100 − p)/perMin·60 (47% → 3180 с). `converterBottleneck` — логика JobsTab.bottleneck(), перенесённая в движок (PA-4), null при ≥ 95% или без рабочих. `jobValuePerRat` — рыночная ценность выхода одной крысы в секунду (📜💍 по 50, 💨 0, при текущей эффективности конвертера), `capped` — выходы, упёршиеся в лимит (их вклад 0), `surplus` — работа даёт 🍞, а крошек > 50% сверх прокорма (PA-4). `inputRunway` — через сколько секунд кончится падающий вход конвертера (PA-4).

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
METRO_BASE_CARS = 4; RANDOM_CAR_WEIGHTS; HOOK_JACKPOT = {hit: 2.5, perfect: 4, royalHit: 4, royalPerfect: 6}; HOOK_JACKPOT_CAP_SEC = 180
// data/buildings.ts, data/upgrades.ts, data/zones.ts, engine/derive.ts
MILESTONE_JOB_BOOST = 1.2; MILESTONES; TINKERS_MULT = 1.6; ZONE_FROM («из Канализации»); milestonesReached(level)
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

## Правила параллельной работы

- Каждый агент правит **только свои файлы** (список в задаче). Движок, данные, типы и стор меняет только владелец движка; если нужен новый экспорт или поле — опишите это в отчёте.
- Не запускайте `next dev` / `next build` (их запускает интегратор). Проверка: `npx tsc --noEmit -p .` — чините ошибки только в своих файлах; `npx eslint <свои файлы>`.
