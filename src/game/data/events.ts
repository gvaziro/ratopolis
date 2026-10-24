import type { EventId, EventLines, LinePair, SceneEventId, TrainCarDef, TrainCarKind, TrainVariantDef, TrainVariantId } from "../types";

export const TRAIN_CARS: Record<TrainCarKind, TrainCarDef> = {
  engine: { kind: "engine", name: "Паровоз", icon: "🚂", weight: 0, items: 4, sparks: 3, drops: { coal: 0.6, gears: 0.4 }, S: 20 },
  tender: { kind: "tender", name: "Тендер", icon: "🛢️", weight: 0, items: 8, sparks: 0, drops: { coal: 1 }, S: 20 },
  third: { kind: "third", name: "3-й класс", icon: "🚃", weight: 30, items: 6, sparks: 1, drops: { crumbs: 0.5, coins: 0.3, buttons: 0.2 }, S: 30 },
  dining: { kind: "dining", name: "Вагон-ресторан", icon: "🍽️", weight: 15, items: 8, sparks: 0, drops: { crumbs: 0.5, cheese: 0.5 }, S: 30 },
  mail: { kind: "mail", name: "Почтовый", icon: "✉️", weight: 15, items: 6, sparks: 0, drops: { blueprints: 0.4, wire: 0.4, buttons: 0.2 }, S: 30 },
  first: { kind: "first", name: "1-й класс", icon: "🎩", weight: 15, items: 6, sparks: 1, drops: { coins: 0.6, cheese: 0.25, trinkets: 0.15 }, S: 45 },
  baggage: { kind: "baggage", name: "Багажный", icon: "🧳", weight: 15, items: 10, sparks: 1, drops: { gears: 0.4, brass: 0.3, wire: 0.25, trinkets: 0.05 }, S: 45 },
  royal: { kind: "royal", name: "Королевский", icon: "👑", weight: 0, items: 12, sparks: 0, drops: { coins: 0.5, trinkets: 0.5 }, S: 60 },
  capsule: { kind: "capsule", name: "Капсула", icon: "💊", weight: 0, items: 4, sparks: 0, drops: { coins: 0.4, buttons: 0.25, wire: 0.25, gears: 0.1 }, S: 12 },
  carriage: { kind: "carriage", name: "Экипаж", icon: "🐎", weight: 0, items: 8, sparks: 0, drops: { crumbs: 0.6, coins: 0.3, buttons: 0.05, wire: 0.05 }, S: 10 },
  flotsam: { kind: "flotsam", name: "Плавучий мусор", icon: "🌊", weight: 0, items: 4, sparks: 0, drops: { buttons: 1 / 3, wire: 1 / 3, gears: 1 / 3 }, S: 15 },
};

/** Cars of a metro train before platform posts and edicts (engine + tender 70% + random cars), at most 11 in all. */
export const METRO_BASE_CARS = 4;

/** Random car weights of metro trains (and the extra cars of the Royal Express). */
export const RANDOM_CAR_WEIGHTS = { third: 30, dining: 15, mail: 15, first: 15, baggage: 15 } as const;

/** Grappling hook jackpot: value of the hooked car's items × this × crew position (GDD 8.2.4, v2 EN-1). */
export const HOOK_JACKPOT = { hit: 2.5, perfect: 4, royalHit: 4, royalPerfect: 6 } as const;

/** A jackpot never pays more than this many seconds of the colony's passive market-value income (+2 💍 on top). */
export const HOOK_JACKPOT_CAP_SEC = 120;

/** Capsule drops once the cellars are open. */
export const CAPSULE_DROPS_CELLARS = { coins: 0.35, buttons: 0.2, wire: 0.2, gears: 0.15, cheese: 0.1 };

export const EVENT_LINES: Record<EventId, EventLines> = {
  carriage: {
    name: "Экипаж над решёткой",
    icon: "🐎",
    human: "Кэб проехал по луже у тротуара",
    rat: "Небесная колесница сыплет манну сквозь решётку",
  },
  capsule: {
    name: "Пневмокапсула",
    icon: "📯",
    human: "Пневмопочта доставила телеграмму в банк",
    rat: "Медные черви несутся по трубе и роняют дары",
  },
  metro_train: {
    name: "Поезд подземки",
    icon: "🚂",
    human: "Поезд 8:15 до Паддингтона, опоздание на минуту",
    rat: "Бог Грома проходит каждые четыре минуты и оставляет дары",
  },
  royal_express: {
    name: "Королевский экспресс",
    icon: "👑",
    human: "Королевский поезд в Виндзор, перрон оцеплен",
    rat: "Золотой Змей Короля. Небо платит дань",
  },
  downpour: {
    name: "Ливень",
    icon: "🌧️",
    human: "Опять льёт, возьмите зонт",
    rat: "Великие Воды идут. Закрыть шлюзы!",
  },
  cat: {
    name: "Кот Мурзифер",
    icon: "🐈‍⬛",
    human: "Кис-кис, хороший мальчик",
    rat: "Пришёл Полосатый Ужас",
  },
  ratcatcher: {
    name: "Крысолов с дудочкой",
    icon: "🎶",
    human: "Муниципальный крысолов, третий вызов за неделю",
    rat: "Дудочник зовёт наших детей",
  },
  purse: {
    name: "Оброненный кошелёк",
    icon: "👛",
    human: "Ах, мой кошелёк провалился в решётку!",
    rat: "С неба упал сундук с медью",
  },
  shiny: {
    name: "Блестяшка",
    icon: "✨",
    human: "Кто-то обронил булавку",
    rat: "Звезда упала прямо в нору",
  },
  market: {
    name: "Базарный день",
    icon: "🧺",
    human: "Свежий сыр! Пироги! Подходите!",
    rat: "Барыга Бенедикт открыл лавку у решётки",
  },
};

/** Crew position before a train: auto-collect multiplier, crash risk, hook jackpot multiplier. */
export const CREW_POSITIONS = {
  wall: { name: "У стены", icon: "🧱", auto: 0.7, crash: 0, hook: 0.5 },
  rails: { name: "У рельсов", icon: "🛤️", auto: 1.0, crash: 0.05, hook: 1.0 },
  ties: { name: "Между шпал", icon: "⚠️", auto: 1.3, crash: 0.15, hook: 1.5 },
} as const;

export const RATING_TABLE = [
  { id: "royal", min: 0.95, bonus: 0.35, name: "Королевский улов", icon: "👑" },
  { id: "gold", min: 0.85, bonus: 0.2, name: "Золото", icon: "🥇" },
  { id: "silver", min: 0.65, bonus: 0.1, name: "Серебро", icon: "🥈" },
  { id: "bronze", min: 0.4, bonus: 0, name: "Бронза", icon: "🥉" },
  { id: "none", min: 0, bonus: 0, name: "—", icon: "" },
] as const;

/** Purse outcomes (weights sum to 100). */
export const PURSE_OUTCOMES = [
  { id: "coins", weight: 45, name: "Звонкая находка", icon: "🪙" },
  { id: "feast", weight: 35, name: "Пир", icon: "🍗" },
  { id: "paw", weight: 15, name: "Шальная лапа", icon: "🐾" },
  { id: "button", weight: 5, name: "Пуговица фортуны", icon: "🔘" },
] as const;

/** Timings (seconds). */
export const EVENT_TIMING = {
  minSceneGap: 20,
  trainGuard: 40,
  /** A background event overdue this long starts even with a train under trainGuard (the train waits for it). */
  backgroundStarve: 60,
  carriageFirst: 210,
  carriageInterval: [100, 160],
  carriageIntervalCapsule: [200, 300],
  carriageIntervalMetro: [300, 420],
  carriageDuration: 6,
  purseFirst: 480,
  purseInterval: [180, 420],
  purseLife: 12,
  downpourInterval: [360, 600],
  downpourValveTime: 12,
  downpourValveHp: 6,
  marketInterval: [480, 600],
  marketLife: 60,
  catCheck: 60,
  catFirstAfterCellars: 420,
  catWarn: 6,
  catFight: 10,
  ratcatcherDelay: 10,
  ratcatcherWarn: 10,
  ratcatcherFight: 15,
  ratcatcherNotes: 24,
  capsuleFirstAfterSewers: 300,
  capsuleInterval: 150,
  capsuleJitter: 20,
  capsuleRumble: 5,
  capsulePerCar: 1.5,
  capsulePiles: 6, // v2 (EN-5): the lineman sweeps the strip; was 8
  metroFirstAfterOpen: 60,
  metroInterval: 240,
  metroJitter: 30,
  metroRumble: 8,
  metroPerCar: 2,
  metroPiles: 12, // v2 (EN-5): was 20
  expressInterval: 720,
  /** v2 (EN-6): the first Royal Express comes this soon after the first depot (later ones every expressInterval). */
  expressFirstAfterDepot: 90,
  expressRumble: 12,
  expressPerCar: 1.4,
  expressPiles: 15, // v2 (EN-5): was 25
  haulCard: 8,
  shinyInterval: [25, 45],
  shinyIntervalLate: [60, 90],
  shinyLife: 5,
  interactiveGrace: 4,
  /** v2 (EN-6): metro trains run flooded this long after a downpour ended with a valve open. */
  floodedWindow: 300,
  /** v2 (EN-5): the 'ties' crew stands right under the train: items stay catchable this much longer. */
  tiesItemLifeAdd: 0.4,
} as const;

/* ================================================================ v2 */

/**
 * How each crew position feels in the catch phase (EN-5): hit radius multiplier, share of sparks that are present
 * at all (the engine marks the rest item.skip), and the 'ties' spark grab radius around a held pointer (px).
 */
export const POSITION_FEEL = {
  wall: { hitR: 0.85, sparkKeep: 0.5 },
  rails: { hitR: 1, sparkKeep: 1 },
  ties: { hitR: 1.3, sparkKeep: 1, sparkGrabPx: 50 },
} as const;

/** Value multiplier of an item caught inside the lantern cone (EN-5). Each such catch adds 5 suspicion. */
export const LANTERN_MULT = 2.5;

/**
 * The rare Cheddar dining car (EN-6): once the Cellars are open, each metro train has this chance that one random
 * car (not the engine) becomes a dining car with cars[k].special = "cheese" carrying `items` 🧀 at S = `S`.
 */
export const CHEESE_CAR = { chance: 0.04, items: 12, S: 50, announce: "Сырный вагон из Чеддера!" } as const;

/**
 * Metro train variants (EN-6). buildTrain picks one per metro train (never for the very first, ×3 train): gated rows
 * first (flooded is forced, rush hour p=0.6), then the weighted rest; "normal" takes whatever is left.
 * Variant lines replace the scene's line pool; {time} {dest} {n} work as in EVENT_LINE_POOLS.
 */
export const TRAIN_VARIANTS: Record<TrainVariantId, TrainVariantDef> = {
  normal: {
    id: "normal",
    name: "Обычный рейс",
    icon: "🚂",
    weight: 0,
    gate: "always",
    perCarMul: 1,
    itemLifeMul: 1,
    itemLifeAdd: 0,
    sMul: 1,
    countMul: 1,
    sparkMul: 1,
    physics: "bounce",
    tint: null,
    lines: [],
  },
  rush_hour: {
    id: "rush_hour",
    name: "Час пик",
    icon: "🎩",
    weight: 0.6,
    gate: "rushHour",
    perCarMul: 1.1,
    itemLifeMul: 1,
    itemLifeAdd: 0,
    sMul: 1,
    countMul: 1.3,
    sparkMul: 1,
    carWeights: { third: 90, dining: 15, mail: 15, first: 15, baggage: 15 },
    physics: "bounce",
    tint: "#9a6a3a",
    lines: [
      { human: "Час пик: клерки висят на подножках, котелки набекрень", rat: "Бог Грома набит людьми, как сыр дырками. Сыплется всё!" },
      { human: "{time}, все опаздывают в контору. Кто-то потерял перчатку", rat: "Утренний прилив! Карманы людей полны и дырявы" },
      { human: "Клерки штурмуют поезд на {dest}: кто-то уронил кошелёк, кто-то — бутерброд", rat: "Утренний урожай! Бутерброды и медяки — в одну кучу" },
    ],
  },
  edinburgh_mail: {
    id: "edinburgh_mail",
    name: "Почтовый на Эдинбург",
    icon: "📮",
    weight: 0.12,
    gate: "always",
    perCarMul: 1,
    itemLifeMul: 1,
    itemLifeAdd: 0,
    sMul: 1,
    countMul: 1,
    sparkMul: 1,
    forcedCars: ["mail", "mail"],
    dropOverride: { mail: { blueprints: 0.6, wire: 0.25, buttons: 0.15 } },
    physics: "flutter",
    tint: "#8e2a22",
    lines: [
      { human: "Ночной почтовый на Эдинбург: мешки писем и ни одного пассажира", rat: "Бумажный листопад! Чертежи падают прямо в лапы" },
      { human: "{time}: почта на Эдинбург, сургуч на мешках ещё тёплый", rat: "Письма летят, как осенние листья. В каждом третьем — чертёж!" },
    ],
  },
  freight: {
    id: "freight",
    name: "Товарняк",
    icon: "⛓️",
    weight: 0.1,
    gate: "always",
    perCarMul: 1.4,
    itemLifeMul: 1,
    itemLifeAdd: 0,
    sMul: 1.8,
    countMul: 0.6,
    sparkMul: 2,
    carWeights: { tender: 50, baggage: 50 },
    physics: "bounce",
    tint: "#4b4b52",
    lines: [
      { human: "Товарный состав с углём и ящиками. Пассажиров не берёт", rat: "Тяжёлый Змей! Добычи мало, зато какая — и искры как салют" },
      { human: "Товарняк №{n} гремит цепями: уголь, железо, ящики с гвоздями", rat: "Железный бык тащит тяжесть. Искры летят фейерверком — берегите усы" },
    ],
  },
  flooded: {
    id: "flooded",
    name: "Подтопленные пути",
    icon: "🌊",
    weight: 1,
    gate: "flooded",
    perCarMul: 1,
    itemLifeMul: 1,
    itemLifeAdd: 0.6,
    sMul: 1,
    countMul: 1,
    sparkMul: 1,
    physics: "float",
    tint: "#2f6f7a",
    lines: [
      { human: "После ливня поезд идёт по колено в воде. Машинист ругается", rat: "Дары плывут! Ловите, пока Великие Воды не унесли" },
      { human: "{time}: пути на {dest} залиты, состав ползёт и шипит паром", rat: "Великие Воды подхватили дары. Ловите, пока не уплыли в сток!" },
    ],
  },
};

export const TRAIN_VARIANT_ORDER = Object.keys(TRAIN_VARIANTS) as TrainVariantId[];

/**
 * Fresh 👤/🐀 line pairs per scene event (EN-6). Templates: {time} → hh:mm of the human clock,
 * {dest} → a London destination, {n} → the train number. EVENT_LINES[id] stays the v1 single pair.
 * v2: EN-6 grows every pool to 6–8 pairs; the first pair always matches EVENT_LINES.
 */
export const EVENT_LINE_POOLS: Record<SceneEventId, LinePair[]> = {
  carriage: [
    { human: EVENT_LINES.carriage.human, rat: EVENT_LINES.carriage.rat },
    { human: "Кэбмен уронил кулёк с пирожками и уехал, не оглянувшись", rat: "Колесница щедра сегодня: пирожки — с неба!" },
    { human: "Омнибус свернул к Холборну, пассажиры трясут зонтами", rat: "Небесный короб сыплет крошки и пуговицы" },
    { human: "{time}: двуколка доктора спешит к роженице на Флит-стрит", rat: "Колесница торопится. Ловите, пока не умчалась!" },
    { human: "Пивной фургон подпрыгнул на булыжнике. Бочонок цел, кружки — нет", rat: "Небо гремит бочками и роняет сокровища" },
    { human: "Леди в ландо уронила перчатку. Лакей сделал вид, что не заметил", rat: "Перчатка великанши! Из неё выйдет отличный спальный мешок" },
  ],
  capsule: [
    { human: EVENT_LINES.capsule.human, rat: EVENT_LINES.capsule.rat },
    { human: "{time}: телеграмма в банк — «Курс стабилен»", rat: "Медный червь несёт весточку и роняет медяки" },
    { human: "Почтмейстер жалуется: капсулы приходят полупустыми", rat: "Дань пневмопочты собрана, почтмейстер ничего не заметил" },
    { human: "Капсула №{n}: биржевой маклер ждёт котировки к {time}", rat: "Червь шипит и плюётся монетками. Добрый червь" },
    { human: "Клерк ругает трубу: опять засорилась у Чипсайда", rat: "Засор — это мы. И мы этим гордимся" },
    { human: "Срочное письмо из адмиралтейства. Сургуч чуть надкусан", rat: "Сургуч горчит, зато пахнет морем и тайной" },
  ],
  metro_train: [
    { human: EVENT_LINES.metro_train.human, rat: EVENT_LINES.metro_train.rat },
    { human: "Поезд №{n} до станции {dest}, {time}. Опять дымит", rat: "Бог Грома идёт на {dest}. Дары — нам!" },
    { human: "{time}: состав на {dest} задержан на две минуты", rat: "Бог Грома медлит. Кланяйтесь и подставляйте лапы" },
    { human: "Кондуктор торопит пассажиров: «{dest}, двери закрываются!»", rat: "Громовой Змей ревёт. Держите усы по ветру!" },
    { human: "Пассажир третьего класса уснул и проспал {dest}", rat: "Спящий великан — щедрый великан. Карманы у него дырявые" },
    { human: "{time}, поезд №{n}: машинист обещает сэкономить уголь", rat: "Экономный Бог Грома всё равно сыплет угольки. Нам хватит" },
    { human: "Дама с корзиной клубники протискивается в вагон на {dest}", rat: "Ягодный дождь! Старейшины велят не толкаться" },
  ],
  royal_express: [
    { human: EVENT_LINES.royal_express.human, rat: EVENT_LINES.royal_express.rat },
    { human: "Королевский поезд: перрон оцеплен, оркестр фальшивит", rat: "Золотой Змей Короля! Небо платит дань золотом" },
    { human: "{time}: Её Величество следует в Виндзор. Гвардейцы не моргают", rat: "Гвардейцы не моргают — и не смотрят под ноги. Вперёд!" },
    { human: "Лакеи грузят сундуки с гербами. Один подозрительно звенит", rat: "Звенящий сундук! Кто-то сегодня станет баронетом" },
    { human: "Начальник вокзала надел парадный мундир. Пуговицы держатся на честном слове", rat: "Пуговицы с мундира — прямо в казну колонии" },
    { human: "Королевский повар везёт пирог с почками. Целиком. Пока что", rat: "Корона пахнет пирогом. Значит, мы на верном пути" },
  ],
  downpour: [
    { human: EVENT_LINES.downpour.human, rat: EVENT_LINES.downpour.rat },
    { human: "Ливень над Сити. Зонтики продают втридорога", rat: "Небо прохудилось! Шлюзы — на замок!" },
    { human: "{time}: дворник ругает водостоки, водостоки молчат", rat: "Великие Воды ревут в трубах. Все к вентилям!" },
    { human: "Темза поднялась на дюйм. Газеты пишут о конце света", rat: "Конец света отменяется, если закрыть три вентиля" },
    { human: "Лужа на Стрэнде размером с озеро. Мальчишки пускают кораблики", rat: "Кораблики плывут к нам! Капитанов не обижать" },
    { human: "Джентльмен вывернул зонт ветром и сделал вид, что так задумано", rat: "Вода идёт стеной. Крутите вентили, как будто от этого зависят хвосты" },
  ],
  cat: [
    { human: EVENT_LINES.cat.human, rat: EVENT_LINES.cat.rat },
    { human: "Кухарка выпустила кота «погулять в подвал»", rat: "Мурзифер вышел на охоту. Хвосты — поджать!" },
    { human: "Кот леди Пемберли опять отказался от паштета", rat: "Голодный Ужас ищет закуску. Закуска — это мы" },
    { human: "{time}: дворецкий уверен, что кот ловит мышей. Кот уверен в другом", rat: "Полосатый Ужас точит когти о бочку хереса" },
    { human: "Кот вернулся с прогулки с паутиной на усах", rat: "Он был в наших коридорах. Он вернётся" },
    { human: "Мурзифер получил новый бархатный ошейник с бубенчиком", rat: "Звенит бубенчик — звенят наши нервы" },
  ],
  ratcatcher: [
    { human: EVENT_LINES.ratcatcher.human, rat: EVENT_LINES.ratcatcher.rat },
    { human: "Муниципалитет прислал дудочника. Опять", rat: "Дудочка поёт. Затычки в уши — живо!" },
    { human: "{time}: крысолов в котелке достал из футляра дудку", rat: "Песня Дудочника липкая, как патока. Не слушать!" },
    { human: "Крысолов берёт шиллинг за визит и два — за «особо наглых»", rat: "Мы особо наглые. Это комплимент" },
    { human: "Санитарный инспектор подписал наряд на «полную очистку подвалов»", rat: "Бумага пахнет бедой. Готовьте беруши из пробок" },
    { human: "Дудочник фальшивит на верхнем «ля». Соседи жалуются", rat: "Фальшивая нота — наш шанс. Бейте по ней!" },
  ],
};

/** London destinations for the {dest} template (EN-6). */
export const LINE_DESTS = ["Паддингтон", "Хаммерсмит", "Фаррингдон", "Кингс-Кросс", "Виктория"];
