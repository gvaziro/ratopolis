# Как помочь колонии / Contributing

*Short English version: use Node 24, run `npm run check` before a pull request, run `npm run test:slow` and
`npm run sim -- --strict` when you touch `src/game/data` or `src/game/engine`, keep the numbers in the data tables and
GDD in sync, and follow the save-schema rule below. Player-facing text is Russian.*

## Перед pull request

1. Node.js 24 (`.nvmrc`), зависимости — `npm ci`.
2. В свежем клоне один раз `npm run typegen` (или `npm run dev`): Next создаёт `next-env.d.ts` и типы маршрутов, без них
   `tsc` не видит типов Next.
3. **`npm run check`** — типы, ESLint (с кэшем) и быстрые тесты, ровно то, что гоняет CI ([ci.yml](.github/workflows/ci.yml)).
   Быстрый набор укладывается в 20 секунд; если ваш тест дольше нескольких секунд, назовите файл `*.slow.test.ts`.
4. Если меняли `next.config.ts`, `src/app` или ассеты — `npm run build` и `npm run build:static` (статический экспорт для
   GitHub Pages; CI собирает оба и проверяет, что каждая ссылка в `out/index.html` и в манифесте ведёт на файл).

## Если трогали движок или данные

`src/game/data/**` и `src/game/engine/**` — это баланс, его проверяют боты:

- `npm run test:slow` — трёхчасовой прогон бота и другие марафоны.
- `npm run sim -- --strict` — сид 12345: все проверки GDD (раздел 15.14) должны остаться PASS, иначе процесс завершится
  с ошибкой. Для сравнения — `npm run sim -- --seed 777` и `npm run sim:matrix` (несколько сидов параллельно; с
  `-- --baseline scripts/balance-baseline.json` — сравнение с базовой линией).
- Ночной workflow [balance.yml](.github/workflows/balance.yml) делает то же самое на каждом PR в эти папки и кладёт
  SUMMARY в отчёт запуска.

## Данные — источник истины

- Все числа игры живут в таблицах `src/game/data/*.ts`: цены, производство, тайминги поездов, тексты событий. Движок
  и интерфейс **читают** таблицы и формулы (`engine/formulas.ts`, `engine/metaMath.ts`) и не держат своих копий.
  Никаких «магических» чисел в компонентах.
- Поменяли таблицу — поправьте соответствующую таблицу в [docs/GDD.md](docs/GDD.md) в том же PR. GDD описывает, как
  игра устроена сейчас, а не как задумывалась когда-то.
- Новый экспорт или поле состояния нужен интерфейсу — сначала контракт в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Сохранения: правило схемы

Старые сохранения игроков обязаны загружаться. Изменилась форма `GameState` (поле переехало, переименовано, поменяло
смысл):

1. поднять `SCHEMA_VERSION` в `src/game/engine/state.ts`;
2. добавить шаг `MIGRATIONS[старая версия]` в `src/game/engine/save.ts` (тест «has a step for every schema below the
   current one» упадёт без него);
3. снять золотые сохранения новой версии `npx tsx scripts/capture-fixtures.ts` и **оставить** фикстуры старых версий;
4. добавить случай в `save.test.ts`.

Новое поле, которому хватает значения по умолчанию, получает его в `state.ts` и в `mergeDefaults` — отдельный шаг
миграции тогда не нужен. Подробности — в разделе «Сохранения» в ARCHITECTURE.

## Интерфейс и тексты

- Всё, что видит игрок, — по-русски, с викторианско-стимпанковым крысиным юмором. Числа со словами — через `plural()`
  из `src/lib/format.ts` («3 крысы», «5 крыс»).
- Учитывайте настройки «Меньше движения» и «Без тряски», телефоны от 320 px и телефон боком.
- Анимации — через ref и `requestAnimationFrame`, без перерисовки React каждый кадр.
- Никаких внешних ассетов: графика — SVG, CSS, эмодзи, canvas; звук — синтез WebAudio.

## Ошибки

Заводите issue по шаблону [«Ошибка в колонии»](https://github.com/gvaziro/ratopolis/issues/new?template=bug.yml) и
прикладывайте файл сохранения: вкладка ⚙️ «Настройки» → «💾 Скачать файл» (или «📜 Скачать сохранение» на экране аварии).
С ним колонию можно открыть ровно в том виде, в каком её видите вы.

## Лицензия

Лицензия проекта пока не выбрана (это решение автора). Присылая изменения, вы соглашаетесь, что они войдут в проект на
тех условиях, которые автор выберет.
