import type { AchievementDef, AchievementId, EdictDef, EdictId } from "../types";

export const EDICTS: Record<EdictId, EdictDef> = {
  royal_litter: { id: "royal_litter", name: "Королевский выводок", icon: "🐀", cost: 3, effect: "Старт забега с 10 крысами и 5 гнёздами" },
  ancestral_paws: { id: "ancestral_paws", name: "Лапы предков", icon: "🐾", cost: 3, effect: "Клик ×3 навсегда" },
  golden_whiskers: { id: "golden_whiskers", name: "Золотые усы", icon: "✨", cost: 8, effect: "Кошельки вдвое чаще, их эффекты длятся ×1.5" },
  rat_memory: { id: "rat_memory", name: "Крысиная память", icon: "🧠", cost: 8, effect: "Первые 11 улучшений (от «Острых резцов» до «Охоты на ходу») сохраняются" },
  eternal_night_shift: { id: "eternal_night_shift", name: "Вечная ночная смена", icon: "🌙", cost: 6, effect: "Офлайн: эффективность +25%, лимит времени +4 ч" },
  old_tunnels: { id: "old_tunnels", name: "Старые ходы", icon: "🗺️", cost: 10, effect: "Канализация открыта с начала; экспедиция в Подвалы −75%" },
  felt_soles: { id: "felt_soles", name: "Войлочные подошвы", icon: "🥿", cost: 10, effect: "Рост подозрения ×0.5" },
  inherited_foreman: { id: "inherited_foreman", name: "Наследный прораб", icon: "👷", cost: 12, effect: "«Цепочка передачи», «Заводная крыса» и «Прораб» сохраняются" },
  timetable_in_head: { id: "timetable_in_head", name: "Расписание в голове", icon: "🕰️", cost: 15, effect: "Поезда +2 вагона, «Гул» +5 с, автосбор +0.10, риск аварии ×0.5" },
  lucky_tail: { id: "lucky_tail", name: "Счастливый хвост", icon: "🍀", cost: 20, effect: "Ценность предметов поездов и капсул ×2" },
  express_blueprints: { id: "express_blueprints", name: "Чертежи экспресса", icon: "📐", cost: 30, effect: "Этапы Крысиного экспресса сохраняются; новые на 25% дешевле" },
  kings_favor: { id: "kings_favor", name: "Милость короля", icon: "👑", cost: 40, effect: "Бонус за венец: +2% → +3% к производству" },
};

export const EDICT_ORDER = Object.keys(EDICTS) as EdictId[];

export const ACHIEVEMENTS: Record<AchievementId, AchievementDef> = {
  first_crumb: { id: "first_crumb", name: "Первая крошка", icon: "🍞", desc: "Собрать 1 🍞" },
  colony_100: { id: "colony_100", name: "Посёлок", icon: "🏘️", desc: "100 крыс" },
  colony_1000: { id: "colony_1000", name: "Мегаполис", icon: "🌆", desc: "1 000 крыс", reward: "Золотая решётка" },
  click_1000: { id: "click_1000", name: "Мозолистые лапки", icon: "🖐️", desc: "1 000 кликов" },
  full_storage: { id: "full_storage", name: "Хомяк в душе", icon: "📦", desc: "Впервые упереться в лимит" },
  overload: { id: "overload", name: "Перегруз!", icon: "🏋️", desc: "Впервые получить «ПЕРЕГРУЗ»" },
  sewers_open: { id: "sewers_open", name: "Вниз по трубе", icon: "🌊", desc: "Открыть Канализацию" },
  cellars_open: { id: "cellars_open", name: "Сырное королевство", icon: "🧀", desc: "Открыть Подвалы" },
  metro_open: { id: "metro_open", name: "Под стук колёс", icon: "🚇", desc: "Открыть Метро" },
  terminal_open: { id: "terminal_open", name: "Вокзальная аристократия", icon: "🏛️", desc: "Открыть Вокзал" },
  first_capsule: { id: "first_capsule", name: "Почта для крыс", icon: "📯", desc: "Разобрать первую пневмокапсулу" },
  first_train: { id: "first_train", name: "Чудовище из стали", icon: "🚂", desc: "Пережить первый поезд" },
  royal_haul: { id: "royal_haul", name: "Королевский улов", icon: "👑", desc: "Рейтинг 👑 в поезде" },
  combo_25: { id: "combo_25", name: "Музыка колёс", icon: "🎵", desc: "Комбо ×25 в поезде" },
  hook_perfect: { id: "hook_perfect", name: "Точный бросок", icon: "🎯", desc: "Идеальный крюк" },
  cat_bonked: { id: "cat_bonked", name: "По усам!", icon: "🥊", desc: "Отогнать Кота" },
  piper_broken: { id: "piper_broken", name: "Дудка сломана", icon: "🎶", desc: "Победить Крысолова" },
  first_rail: { id: "first_rail", name: "Первая рельса", icon: "🛤️", desc: "Выковать 1 🛤️", reward: "Флажки на вагонетках" },
  first_migration: { id: "first_migration", name: "Исход", icon: "🧳", desc: "Первое переселение" },
  coronation: { id: "coronation", name: "Да здравствует Крысиный Король!", icon: "👑", desc: "Достроить Крысиный экспресс", reward: "Корона на курсоре" },
  starved: { id: "starved", name: "Пост", icon: "😟", desc: "Впервые попасть в голод", secret: true },
  lantern_greed: { id: "lantern_greed", name: "Под фонарём", icon: "🏮", desc: "Поймать 10 предметов в луче фонаря за один поезд", secret: true },
  before_noon: { id: "before_noon", name: "Ещё до обеда", icon: "🕛", desc: "Коронация до 12:00 по часам забега", secret: true, reward: "Позолоченная рамка портрета" },
};

export const ACHIEVEMENT_ORDER = Object.keys(ACHIEVEMENTS) as AchievementId[];

/** Rat Express: 10 stages, base cost multiplied by 1.8^(n-1). */
export const EXPRESS_BASE = { rails: 50, gears: 10000, brass: 1000, trinkets: 6, blueprints: 30 };
export const EXPRESS_GROWTH = 1.8;
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
