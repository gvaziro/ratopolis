import type { EventId, EventLines, TrainCarDef, TrainCarKind } from "../types";

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
  capsulePiles: 8,
  metroFirstAfterOpen: 60,
  metroInterval: 240,
  metroJitter: 30,
  metroRumble: 8,
  metroPerCar: 2,
  metroPiles: 20,
  expressInterval: 720,
  expressRumble: 12,
  expressPerCar: 1.4,
  expressPiles: 25,
  haulCard: 8,
  shinyInterval: [25, 45],
  shinyIntervalLate: [60, 90],
  shinyLife: 5,
  interactiveGrace: 4,
} as const;
