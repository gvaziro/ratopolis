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
src/game/data/*.ts         таблицы контента: resources, jobs, buildings, upgrades, zones, meta (указы, медали, экспресс), events (вагоны, тайминги), headlines
src/game/engine/*.ts       чистый движок без DOM: state, derive, economy, events, actions, step, offline, save, formulas, conditions, rng
src/game/store.ts          Zustand-стор: useGame(selector), useDerived(), действия игрока
src/game/useGameLoop.ts    rAF-цикл 10 Гц, автосейв, офлайн при скрытой вкладке
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
- UI-состояние: `tab`, `buyMode` в том же сторе.
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

`sfx.unlock, setVolume(v, enabled), click, find, coin, tin, thud, squeak, fanfare, medal, blip(step), bump, ouch, clack, whistle(royal?), bell, hiss, pop, splash, meow, bonk, pipe(note), jackpot, dig, typewriter, rumbleStart(i)/rumbleSet(i)/rumbleStop, chuffStart(rate)/chuffSet(rate)/chuffStop, coronationBells`. Все вызовы безопасны до `unlock()` и при выключенном звуке. Сцены вызывают `sfx.blip(combo)`, `sfx.clack()` и т. п. напрямую; `AudioDirector` слушает `onFx` и включает/выключает гул поезда по фазе сцены.

## Стиль

- Палитра — CSS-токены в `globals.css`, в Tailwind: `bg-soot`, `bg-panel`, `bg-panel-2`, `border-line`, `text-parchment`, `text-parchment-dim`, `text-brass`, `text-brass-light`, `text-copper`, `text-verdigris`, `text-gaslight`, `text-danger`, `text-good`. Шрифты: `font-display` (Cormorant SC — заголовки), `font-sans` (PT Sans), `font-mono` (JetBrains Mono — числа, `tabular`).
- Числа — только через `fmt`, `fmtRate`, `fmtTime`, `fmtInt` из `src/lib/format.ts`.
- Тексты интерфейса — по-русски, с юмором викторианской газеты.
- Настройки `settings.reducedMotion` и `settings.noShake` отключают тряску, зум и вспышки; частиц на 70% меньше.
- Мобильная раскладка: от 375 px, отступы 16 px, без горизонтальной прокрутки страницы, цели касания ≥ 40 px.
- Производительность: canvas для частиц и предметов событий (≤ 200 частиц), `React.memo` для карточек, селекторы примитивов.

## Правила параллельной работы

- Каждый агент правит **только свои файлы** (список в задаче). Движок, данные, типы и стор меняет только владелец движка; если нужен новый экспорт или поле — опишите это в отчёте.
- Не запускайте `next dev` / `next build` (их запускает интегратор). Проверка: `npx tsc --noEmit -p .` — чините ошибки только в своих файлах; `npx eslint <свои файлы>`.
