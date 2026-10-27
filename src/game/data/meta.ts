import type { AchievementDef, AchievementId, EdictDef, EdictId, LinePair, SealDef, SealId, UpgradeId } from "../types";
import { RAT_MEMORY_RANKS, UPGRADES } from "./upgrades";

/**
 * The whole effect of rat_memory at rank `rank` (2..3), a full statement like the other rank texts (the edict card
 * shows the rank's text instead of the base one): the first 11 upgrades plus every rank's extras, by their real names.
 */
function keptAlso(rank: number): string {
  const names = RAT_MEMORY_RANKS.slice(0, rank - 1)
    .flat()
    .map((id: UpgradeId) => `«${UPGRADES[id].name}»`);
  return `Сохраняются первые 11 улучшений, а также ${names.length > 1 ? `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}` : names.join("")}`;
}

export const EDICTS: Record<EdictId, EdictDef> = {
  royal_litter: {
    id: "royal_litter",
    name: "Королевский выводок",
    icon: "🐀",
    cost: 3,
    effect: "Старт забега с 10 крысами, 5 гнёздами и 50 🍞",
    decree: "Повелеваем плодиться усердно и не жаловаться на тесноту. Подписано хвостом.",
    ranks: [
      { cost: 9, effect: "Старт с 25 крысами, 10 гнёздами и 500 🍞" },
      { cost: 30, effect: "Старт с 60 крысами, 20 гнёздами и 5 000 🍞" },
    ],
  },
  ancestral_paws: {
    id: "ancestral_paws",
    name: "Лапы предков",
    icon: "🦴",
    cost: 3,
    effect: "Клик ×3 навсегда",
    decree: "Да передастся хватка дедов внукам — вместе с мозолями.",
    // v3 (ENG-8): ranks II/III also reach the 📜 bottleneck — each click of the paw brings a share of the 📜/s
    ranks: [
      { cost: 9, effect: "Клик ×6 навсегда; каждый клик лапой приносит ещё 0.5% выработки 📜/с" },
      { cost: 30, effect: "Клик ×12 навсегда; каждый клик лапой приносит ещё 1% выработки 📜/с" },
    ],
  },
  golden_whiskers: {
    id: "golden_whiskers",
    name: "Золотые усы",
    icon: "✨",
    cost: 8,
    effect: "Кошельки вдвое чаще, их эффекты длятся ×1.5",
    decree: "Всякая дама, уронившая кошелёк, объявляется благодетельницей колонии.",
    // v3 (ENG-8): ranks II/III also reach the 💍 bottleneck — a purse may hold pocket watches
    ranks: [
      { cost: 24, effect: "Кошельки втрое чаще, эффекты ×2; кошелёк с шансом 20% несёт ещё 3 💍" },
      { cost: 80, effect: "Кошельки вчетверо чаще, эффекты ×2.5; кошелёк с шансом 30% несёт ещё 6 💍" },
    ],
  },
  rat_memory: {
    id: "rat_memory",
    name: "Крысиная память",
    icon: "🧠",
    cost: 8,
    effect: "Первые 11 улучшений (от «Острых резцов» до «Охоты на ходу») сохраняются",
    decree: "Забывать полезное запрещается. Забывать долги — дозволяется.",
    ranks: [
      { cost: 24, effect: keptAlso(2) },
      { cost: 80, effect: keptAlso(3) },
    ],
  },
  eternal_night_shift: {
    id: "eternal_night_shift",
    name: "Вечная ночная смена",
    icon: "🦉",
    cost: 6,
    effect: "Офлайн: эффективность +25%, лимит времени +4 ч",
    decree: "Ночь объявляется рабочим временем. Сон — по воскресеньям, и то не всем.",
    // v3 (ENG-8): efficiency stops at 100% (night_shift + rank I); ranks II/III lengthen the absence instead
    ranks: [
      { cost: 18, effect: "Офлайн: эффективность +25%, лимит времени +6 ч" },
      { cost: 60, effect: "Офлайн: эффективность +25%, лимит времени +8 ч" },
    ],
  },
  old_tunnels: {
    id: "old_tunnels",
    name: "Старые ходы",
    icon: "🗺️",
    cost: 10,
    effect: "Канализация открыта с начала; экспедиция в Подвалы −75%",
    decree: "Карты дедов — достояние короны. Копии не выносить.",
    ranks: [
      { cost: 30, effect: "Канализация и Подвалы открыты с начала забега" },
      { cost: 100, effect: "Канализация и Подвалы открыты с начала; экспедиция в Метро −50%" },
    ],
  },
  felt_soles: {
    id: "felt_soles",
    name: "Указ о тишине",
    icon: "🤫",
    cost: 10,
    effect: "Рост подозрения ×0.5",
    decree: "Пищать — шёпотом. Топать — никогда.",
    ranks: [
      { cost: 30, effect: "Рост подозрения ×0.35" },
      { cost: 100, effect: "Рост подозрения ×0.25" },
    ],
  },
  inherited_foreman: {
    id: "inherited_foreman",
    name: "Наследный прораб",
    icon: "⛑️",
    cost: 12,
    effect: "«Цепочка передачи», «Заводная крыса» и «Прораб» сохраняются",
    decree: "Каска из жёлудя переходит от отца к сыну.",
  },
  timetable_in_head: {
    id: "timetable_in_head",
    name: "Расписание в голове",
    icon: "🕰️",
    cost: 15,
    effect: "Поезда +2 вагона, «Гул» +5 с, автосбор +0.10, риск аварии ×0.5",
    decree: "Расписание знать наизусть. Опоздавших Бог Грома не ждёт.",
    ranks: [
      { cost: 45, effect: "Поезда +3 вагона, «Гул» +5 с, автосбор +0.10, риск аварии ×0.5" },
      { cost: 150, effect: "Поезда +4 вагона, «Гул» +5 с, автосбор +0.10, риск аварии ×0.5" },
    ],
  },
  lucky_tail: {
    id: "lucky_tail",
    name: "Счастливый хвост",
    icon: "🍀",
    cost: 20,
    effect: "Ценность предметов поездов и капсул ×2",
    decree: "Хвост — к удаче. Особенно завязанный узелком.",
    ranks: [
      { cost: 60, effect: "Ценность предметов поездов и капсул ×2.5" },
      { cost: 200, effect: "Ценность предметов поездов и капсул ×3" },
    ],
  },
  express_blueprints: {
    id: "express_blueprints",
    name: "Чертежи экспресса",
    icon: "📃",
    cost: 30,
    effect: "Первые 5 этапов Крысиного экспресса сохраняются; новые на 25% дешевле",
    decree: "Чертежи хранить в королевском архиве, подальше от моли и кота.",
  },
  kings_favor: {
    id: "kings_favor",
    name: "Милость короля",
    icon: "👑",
    cost: 40,
    effect: "Бонус за венец: +2% → +3% к производству",
    decree: "Его Величество милостив. Сегодня.",
  },
};

export const EDICT_ORDER = Object.keys(EDICTS) as EdictId[];

export const ACHIEVEMENTS: Record<AchievementId, AchievementDef> = {
  first_crumb: { id: "first_crumb", name: "Первая крошка", icon: "🍞", desc: "Собрать 1 🍞", group: "colony" },
  colony_100: { id: "colony_100", name: "Посёлок", icon: "🏘️", desc: "100 крыс", group: "colony", progress: { stat: "rats", goal: 100 } },
  colony_1000: { id: "colony_1000", name: "Мегаполис", icon: "🌆", desc: "1 000 крыс", reward: "Золотая решётка", group: "colony", progress: { stat: "rats", goal: 1000 } },
  click_1000: { id: "click_1000", name: "Мозолистые лапки", icon: "🖐️", desc: "1 000 кликов", group: "colony", progress: { stat: "lifetime.clicks", goal: 1000 } },
  full_storage: { id: "full_storage", name: "Хомяк в душе", icon: "📦", desc: "Впервые упереться в лимит", group: "colony" },
  overload: { id: "overload", name: "Перегруз!", icon: "🏋️", desc: "Впервые получить «ПЕРЕГРУЗ»", group: "colony" },
  sewers_open: { id: "sewers_open", name: "Вниз по трубе", icon: "🌊", desc: "Открыть Канализацию", group: "colony" },
  cellars_open: { id: "cellars_open", name: "Сырное королевство", icon: "🧀", desc: "Открыть Подвалы", group: "colony" },
  metro_open: { id: "metro_open", name: "Под стук колёс", icon: "🚇", desc: "Открыть Метро", group: "colony" },
  terminal_open: { id: "terminal_open", name: "Вокзальная аристократия", icon: "🏛️", desc: "Открыть Вокзал", group: "colony" },
  first_capsule: { id: "first_capsule", name: "Почта для крыс", icon: "📯", desc: "Разобрать первую пневмокапсулу", group: "events" },
  first_train: { id: "first_train", name: "Чудовище из стали", icon: "🚂", desc: "Пережить первый поезд", group: "events" },
  royal_haul: { id: "royal_haul", name: "Королевский улов", icon: "🏆", desc: "Рейтинг 👑 в поезде", group: "events" },
  combo_25: { id: "combo_25", name: "Музыка колёс", icon: "🎵", desc: "Комбо ×25 в поезде", group: "events" },
  hook_perfect: { id: "hook_perfect", name: "Точный бросок", icon: "🎯", desc: "Идеальный крюк", group: "events" },
  cat_bonked: { id: "cat_bonked", name: "По усам!", icon: "🥊", desc: "Отогнать Кота", group: "events" },
  piper_broken: { id: "piper_broken", name: "Дудка сломана", icon: "🎶", desc: "Победить Крысолова", group: "events" },
  first_rail: { id: "first_rail", name: "Первая рельса", icon: "🛤️", desc: "Выковать 1 🛤️", reward: "Флажки на вагонетках", group: "colony" },
  first_migration: { id: "first_migration", name: "Исход", icon: "🧳", desc: "Первое переселение", group: "meta" },
  coronation: { id: "coronation", name: "Да здравствует Крысиный Король!", icon: "👑", desc: "Достроить Крысиный экспресс", reward: "Корона на курсоре", group: "meta" },
  starved: { id: "starved", name: "Пост", icon: "😟", desc: "Впервые попасть в голод", secret: true, group: "secret" },
  lantern_greed: { id: "lantern_greed", name: "Под фонарём", icon: "🏮", desc: "Поймать 10 предметов в луче фонаря за один поезд", secret: true, group: "secret" },
  before_noon: { id: "before_noon", name: "Ещё до обеда", icon: "🕛", desc: "Коронация до 10:00 по часам забега", secret: true, reward: "Позолоченная рамка портрета", group: "secret" },
  // ---- v2 (EN-11): meta medals. Award logic lands with EN-11; ids, names and progress goals are final.
  nomads: { id: "nomads", name: "Кочевники", icon: "🎒", desc: "3 переселения", group: "meta", progress: { stat: "migrations", goal: 3 } },
  all_london: { id: "all_london", name: "Весь Лондон наш", icon: "🗺️", desc: "Обжить шесть районов Лондона", group: "meta", progress: { stat: "district", goal: 5 } },
  treasury: { id: "treasury", name: "Казна", icon: "💰", desc: "100 👑 за всё время", group: "meta", progress: { stat: "crownsEver", goal: 100 } },
  thousand_crowns: { id: "thousand_crowns", name: "Банк Англии", icon: "🏦", desc: "1 000 👑 за всё время", group: "meta", progress: { stat: "crownsEver", goal: 1000 } },
  seal_and_tail: { id: "seal_and_tail", name: "Печать и хвост", icon: "🖋️", desc: "Подписать 6 указов", group: "meta", progress: { stat: "edicts", goal: 6 } },
  full_code: { id: "full_code", name: "Полный свод законов", icon: "⚖️", desc: "Подписать все 12 указов", group: "meta", progress: { stat: "edicts", goal: 12 } },
  long_train: { id: "long_train", name: "Длинный состав", icon: "🚋", desc: "5 вагонов Крысиного экспресса", group: "meta", progress: { stat: "wagons", goal: 5 } },
  // v3 (ENG-3): 10 lifetime (was 15) now that wagons cost ×2 per wagon (📜💍 +50%) instead of ×3
  tail_horizon: { id: "tail_horizon", name: "Хвост за горизонтом", icon: "🚄", desc: "10 вагонов Крысиного экспресса за все забеги", group: "meta", progress: { stat: "lifetime.wagons", goal: 10 } },
  again_throne: { id: "again_throne", name: "Снова на троне", icon: "🤴", desc: "Вторая коронация", group: "meta", progress: { stat: "coronations", goal: 2 } },
  naturalist: { id: "naturalist", name: "Натуралист", icon: "🔍", desc: "Повстречать всех обитателей бестиария", group: "meta", progress: { stat: "seenEvents", goal: 10 } },
  purser: { id: "purser", name: "Кошелёчник", icon: "👛", desc: "50 кошельков за всё время", group: "meta", progress: { stat: "lifetime.purses", goal: 50 } },
  honored_rail: { id: "honored_rail", name: "Почётный путеец", icon: "🎖️", desc: "100 поездов за всё время", group: "meta", progress: { stat: "lifetime.trains", goal: 100 } },
  genealogy: { id: "genealogy", name: "Родословная", icon: "🌳", desc: "10 000 рождений за всё время", group: "meta", progress: { stat: "lifetime.births", goal: 10000 } },
  // ---- v2 (EN-11): secret
  hungry_king: { id: "hungry_king", name: "Голодный король", icon: "😵", desc: "Коронация посреди голода", secret: true, group: "secret" },
  miser: { id: "miser", name: "Скряга", icon: "🪙", desc: "Переселиться, храня в казне 200 👑", secret: true, group: "secret" },
  // v3 (ENG-3): the express plan needs a Great Migration, so the crown comes in the second run at the earliest
  forever_tuesday: { id: "forever_tuesday", name: "Короткая неделя", icon: "📅", desc: "Коронация во втором забеге", secret: true, group: "secret" },
  // ---- v2 (EN-11): event feats
  clean_car_10: { id: "clean_car_10", name: "Чистая работа", icon: "🧹", desc: "Поймать все предметы вагона («Вагон чист!») — 10 вагонов за забег", group: "events", progress: { stat: "stats.cleanCars", goal: 10 } },
  no_spark: { id: "no_spark", name: "Без единой искры", icon: "⚡", desc: "Золото или выше, не задев ни одной искры", group: "events" },
  gold_streak: { id: "gold_streak", name: "Золотая серия", icon: "🥇", desc: "3 золотых улова подряд", group: "events", progress: { stat: "stats.goldStreak", goal: 3 } },
  ties_survivor: { id: "ties_survivor", name: "Живучий", icon: "🩹", desc: "Авария между шпал — и всё равно золото", group: "events" },
  dry_paws: { id: "dry_paws", name: "Сухие лапки", icon: "💧", desc: "Закрыть 3 вентиля за 4 секунды", group: "events" },
  cat_nightmare: { id: "cat_nightmare", name: "Кошмар котов", icon: "🐈", desc: "Отогнать Кота 5 раз", group: "events", progress: { stat: "lifetime.catsBeaten", goal: 5 } },
  royal_retinue: { id: "royal_retinue", name: "Королевская свита", icon: "🚆", desc: "3 королевских экспресса за забег", group: "events", progress: { stat: "stats.royalExpresses", goal: 3 } },
  full_consist: { id: "full_consist", name: "Полный состав", icon: "🚃", desc: "Поезд подземки из 11 вагонов", group: "events" },
  // ---- v3 (ENG-10): «Кунсткамера Короля», awarded by engine/curios.ts catchCurio (and housekeeping for v2 trophies)
  first_curio: { id: "first_curio", name: "Первый экспонат", icon: "🏺", desc: "Поймать первую диковину для Кунсткамеры Короля", group: "meta" },
  curio_full: { id: "curio_full", name: "Кунсткамера полна", icon: "🗝️", desc: "Собрать все 24 диковины Кунсткамеры", group: "meta", progress: { stat: "curios", goal: 24 } },
};

export const ACHIEVEMENT_ORDER = Object.keys(ACHIEVEMENTS) as AchievementId[];

/**
 * Rat Express: 10 stages, stage n costs base[r] × growth[r]^(n−1) (× 0.75 with «Чертежи экспресса»).
 * v3 (ENG-3, K3): growth per resource. 💍 and 📜 ignore the global multiplier (excludeGlobal), so their income grows
 * about linearly while stage n asked 1.55^n of them: late stages waited minutes on 💍/📜 alone. They now grow ×1.45,
 * the global-scaled 🛤️⚙️🔔 ×1.6 from a doubled base (v2: every resource 1.55, base 🛤️250 ⚙️50K 🔔5K 💍30 📜150).
 */
export const EXPRESS_BASE = { rails: 500, gears: 100000, brass: 10000, trinkets: 50, blueprints: 250 };
export type ExpressRes = keyof typeof EXPRESS_BASE;
export const EXPRESS_GROWTH: Record<ExpressRes, number> = { rails: 1.6, gears: 1.6, brass: 1.6, trinkets: 1.45, blueprints: 1.45 };
/**
 * Post-coronation wagon k (1, 2, …) costs the stage-10 price × WAGON_GROWTH^k for 🛤️⚙️🔔 and × (1 + WAGON_LINEAR·k)
 * for 💍📜, whose income does not grow with the global multiplier (v3 ENG-3; v2: × 3^k for everything).
 */
export const WAGON_GROWTH = 2;
export const WAGON_LINEAR = 0.5;
/** The express resources that ignore the global multiplier: their wagon price grows linearly. */
export const WAGON_LINEAR_RES: readonly ExpressRes[] = ["trinkets", "blueprints"];
export const EXPRESS_STAGES = [
  "Рама из вязальных спиц",
  "Колёсные пары из карманных часов",
  "Котёл из медного чайника",
  "Поршни из напёрстков",
  "Свисток из курительной трубки",
  "Вагоны из табакерок",
  "Тендер из спичечной фабрики",
  "Часовой регулятор хода",
  "Позолота и герб Крысиного Короля",
  "Отправление!",
];

/**
 * 👤/🐀 story lines per Rat Express stage (v3 ENG-11): three pairs per stage — the first express, the second, and every
 * later one (stages 6–10 and the coronation replay every run, so a crowned colony reads them again and again).
 * Pick with expressStageLine(); the row index is parallel to EXPRESS_STAGES.
 */
export const EXPRESS_STAGE_LINE_SETS: LinePair[][] = [
  [
    { human: "Миссис Пибоди опять не может найти спицы", rat: "Рама крепка, как бабушкин шарф" },
    { human: "Миссис Пибоди купила новые спицы и прячет их под подушкой", rat: "Рама собрана. Под подушками крысы тоже бывают" },
    { human: "Миссис Пибоди перешла на крючок. Крючки пока на месте", rat: "Спиц в Лондоне всё меньше, а рам у экспресса всё больше" },
  ],
  [
    { human: "Часовщик Грант продал вчера восемь часов. Найти не может ни одних", rat: "Колёса тикают. Экспресс будет ходить строго по расписанию" },
    { human: "Часовщик Грант запер витрину на два замка", rat: "Замок — тоже часовой механизм. Колёса снова тикают" },
    { human: "Часовщик Грант завёл сторожевого кота. Кот спит", rat: "Колёсные пары на месте. Кота будить не стали" },
  ],
  [
    { human: "Леди Пемберли (дом №12) лишилась медного чайника. Чай в пять отменён", rat: "Котёл кипит! Старейшины греют лапы" },
    { human: "Леди Пемберли (дом №12) снова без чайника", rat: "Котёл кипит. Старейшины уже не удивляются" },
    { human: "Леди Пемберли (дом №12) купила новый чайник. Третий за месяц", rat: "Котёл кипит по расписанию. Чай в пять теперь у нас" },
  ],
  [
    { human: "Швея уверена, что напёрстки сбежали", rat: "Поршни ходят туда-сюда. Механики ходят за ними" },
    { human: "Швея пришила напёрстки к фартуку. Фартук пропал", rat: "Поршни в фартуке — новая мода механиков" },
    { human: "Швея шьёт без напёрстка и колет пальцы. Колония шлёт ей сочувствие", rat: "Поршни притёрты, как старые друзья" },
  ],
  [
    { human: "Полковник Хэтчетт вынужденно перешёл на сигары", rat: "Свисток пахнет табаком и победой" },
    { human: "Полковник Хэтчетт снова без трубки и снова пишет в «Таймс»", rat: "Свисток свистит голосом полковника" },
    { human: "Полковник Хэтчетт бросил курить. Говорит — по своей воле", rat: "Свисток бодрый, как утреннее построение" },
  ],
  [
    { human: "Лорд Эшби обыскал все жилетные карманы: табакерки нет", rat: "Вагоны с гербами. Внутри до сих пор пахнет нюхательным табаком" },
    { human: "Лорд Эшби носит табакерку на цепочке. Цепочку уже ищут", rat: "Вагоны с гербами — по одному на каждый жилет Лорда" },
    { human: "Лорд Эшби перешёл на табак в бумажных кульках", rat: "Вагоны чихают на стыках. Это к счастью" },
  ],
  [
    { human: "Спичечная фабрика недосчиталась трёх ящиков. Мастер винит сквозняк", rat: "Тендер полон. Кочегары поклялись не курить" },
    { human: "Фабрика «Брайант и Мэй» снова пересчитывает ящики спичек", rat: "Тендер полон. Клятву кочегары помнят — почти" },
    { human: "Фабрика повесила на склад замок. Ящики ушли через замочную скважину", rat: "Тендер собирают с закрытыми глазами. Так и собрали" },
  ],
  [
    { human: "Часы на башне отстают на две секунды. Никто не знает почему", rat: "Регулятор хода тикает в такт сердцу колонии" },
    { human: "Часы на башне снова отстают. Часовщик Грант подозревает голубей", rat: "Голуби ни при чём. Регулятор тикает" },
    { human: "Часы на башне идут как вздумается. Лондон привык опаздывать", rat: "Регулятор — сердце экспресса. И колонии тоже" },
  ],
  [
    { human: "У багетчика пропало сусальное золото", rat: "Герб сияет. Каждая крыса видит в нём своё отражение" },
    { human: "Багетчик держит золото в сейфе. Сейф заметно полегчал", rat: "Позолота свежая, герб прежний: хвост и корона" },
    { human: "Багетчик перешёл на бронзовую краску. Публика не заметила", rat: "Позолоты хватит на два герба. Второй — про запас" },
  ],
  [
    { human: "Под мостовой коротко свистнуло. Прохожие пожали плечами", rat: "ОТПРАВЛЕНИЕ! Король машет хвостом из окна экспресса" },
    { human: "Под мостовой снова свистнуло. Извозчик перекрестился", rat: "ОТПРАВЛЕНИЕ! Король машет хвостом — уже со знанием дела" },
    { human: "Под мостовой свистит каждую неделю. Город привык", rat: "ОТПРАВЛЕНИЕ! Экспресс уходит точно, как часы мистера Гранта" },
  ],
];

/** The first-express lines (EN-3; parallel to EXPRESS_STAGES): the v2 panels read this; new code — expressStageLine(). */
export const EXPRESS_STAGE_LINES: LinePair[] = EXPRESS_STAGE_LINE_SETS.map((set) => set[0]);

/**
 * The 👤/🐀 pair of express stage `stage` (1..10) for a colony crowned `coronations` times before (meta.coronations
 * while the express is being built): the first express, the second, every later one (v3 ENG-11).
 */
export function expressStageLine(stage: number, coronations: number): LinePair {
  const set = EXPRESS_STAGE_LINE_SETS[Math.max(0, Math.min(EXPRESS_STAGE_LINE_SETS.length - 1, Math.floor(stage) - 1))];
  return set[Math.max(0, Math.min(set.length - 1, Math.floor(coronations)))];
}

/**
 * The coronation's 👤/🐀 line by coronation number (v3 ENG-11; narrative.coronationLine fills it in): {weekday} —
 * today's human weekday, {one} — «один/одна/одно» for it, {nth}/{Nth} — «третья»/«Третья», {weeks} — «за неделю»
 * while the colony's whole story fits into one human week (migrations < 7), else «за 2 недели», «за 5 недель».
 * Past the tenth, lines 2–10 come round again.
 */
export const CORONATION_LINES: LinePair[] = [
  { human: "Для людей это {one} {weekday}.", rat: "Для крыс — целая история." },
  { human: "Для людей — ещё {one} {weekday}.", rat: "Для крыс — {nth} коронация {weeks}." },
  { human: "Наверху {weekday}, люди ничего не заметили.", rat: "Король привыкает к короне. Корона — к Королю." },
  { human: "Газеты наверху пишут о погоде. Как всегда.", rat: "{Nth} коронация {weeks}! Летописцы точат перья." },
  { human: "Наверху {weekday}: молочник, дождь, омнибус.", rat: "Корона снова в деле. Двор уже знает, когда кричать «Ура!»." },
  { human: "Констебль зевает: {weekday}, ничего не случается.", rat: "{Nth} коронация. Старейшины сбились со счёта и начали заново." },
  { human: "Лондон пьёт чай. На календаре {weekday}.", rat: "Коронация — уже традиция: оркестр из ложек играет без репетиций." },
  { human: "Наверху {weekday} — {one} из многих.", rat: "{Nth} коронация {weeks}. Король шутит, что корона приросла." },
  { human: "Пастор читает проповедь о смирении. Внизу её не слышно.", rat: "{Nth} коронация. Корона прошла по кругу хвостов — и все целы." },
  { human: "Наверху {weekday}. Люди так ничего и не узнали.", rat: "{Nth} коронация — и ни строчки в людских газетах. Идеальное царствование." },
];

/** Great Seals (EN-9): bought once for 120 👑 each, one active at a time; swapped for free in the first minute of a run. */
export const SEALS: Record<SealId, SealDef> = {
  railway: {
    id: "railway",
    name: "Печать Железной дороги",
    icon: "🚂",
    cost: 120,
    effect: "Поезда +2 вагона, Королевский экспресс вдвое чаще, автосбор +0.15",
  },
  silence: {
    id: "silence",
    name: "Печать Тишины",
    icon: "🤐",
    cost: 120,
    // v3 (ENG-8): aimed at the late 📜/💍 bottleneck instead of the click (derive.excludedMult)
    effect: "Подозрение не растёт, Кот и Крысолов не приходят; 📜 и 💍 ×1.3",
  },
  dynasty: {
    id: "dynasty",
    name: "Печать Династии",
    icon: "🏰",
    cost: 120,
    // v3 (ENG-8): the factor reaches 📜 and 💍 too (derive.excludedMult), not only the globally scaled resources
    effect: "+10% ко всему за каждое переселение — включая 📜 и 💍",
  },
};

export const SEAL_ORDER = Object.keys(SEALS) as SealId[];
