import type { Cond, JobId, ResId } from "../types";

/**
 * «Где взять»: where a resource comes from besides jobs and buildings (EN-7, resourceSources in engine/hints.ts).
 * Each row is shown once its condition holds; the engine adds job and building rows itself.
 */
export interface EventSource {
  icon: string;
  label: string;
  kind: "click" | "event";
  when: Cond;
  /** Hidden again once this holds (capsules stop when the Metro opens). */
  until?: Cond;
  /** Never comes under Печать Тишины (the Cat, the Ratcatcher). */
  noSilence?: true;
}

const metro: Cond = { zone: "metro" };
const sewers: Cond = { zone: "sewers" };
const cellars: Cond = { zone: "cellars" };
const always: Cond = { always: true };
const visitors: Cond = { flag: "vagrants" };

const CLICK = (when: Cond): EventSource => ({ icon: "👆", label: "клик по решётке", kind: "click", when });
const CARRIAGE: EventSource = { icon: "🐎", label: "Экипаж", kind: "event", when: always };
const CAPSULES: EventSource = { icon: "📯", label: "пневмокапсулы", kind: "event", when: sewers, until: metro };
const TRAINS: EventSource = { icon: "🚂", label: "поезда подземки", kind: "event", when: metro };
const SHINIES: EventSource = { icon: "✨", label: "блестяшки", kind: "event", when: visitors };
const PURSE: EventSource = { icon: "👛", label: "кошельки", kind: "event", when: visitors };
const MARKET: EventSource = { icon: "🧺", label: "лавка Бенедикта", kind: "event", when: cellars };
const FLOTSAM: EventSource = { icon: "🌊", label: "Ливень: плавучий мусор", kind: "event", when: sewers };
const CAT: EventSource = { icon: "🥊", label: "победа над Котом", kind: "event", when: cellars, noSilence: true };
const PIPER: EventSource = { icon: "🎶", label: "сломанная дудка Крысолова", kind: "event", when: metro, noSilence: true };
const EXPRESS: EventSource = { icon: "👑", label: "Королевский экспресс", kind: "event", when: { building: "express_depot", gte: 1 } };

export const EVENT_SOURCES: Partial<Record<ResId, EventSource[]>> = {
  crumbs: [CLICK(always), CARRIAGE, SHINIES, TRAINS],
  coins: [CLICK({ resEver: "crumbs", gte: 30 }), CARRIAGE, PURSE, SHINIES, CAPSULES, TRAINS, PIPER, MARKET],
  buttons: [CLICK({ rats: 6 }), CARRIAGE, SHINIES, CAPSULES, FLOTSAM, TRAINS, MARKET],
  wire: [CLICK({ rats: 6 }), CARRIAGE, SHINIES, CAPSULES, FLOTSAM, TRAINS, MARKET],
  gears: [CAPSULES, FLOTSAM, TRAINS, MARKET],
  cheese: [CLICK(cellars), CAPSULES, CAT, TRAINS, MARKET],
  blueprints: [CAT, PIPER, TRAINS],
  coal: [CLICK(metro), TRAINS, MARKET],
  brass: [TRAINS, MARKET],
  rails: [MARKET],
  trinkets: [CLICK({ zone: "terminal" }), TRAINS, EXPRESS],
};

/** Plural job names for «Где взять» rows: «Карманники (0 из 13 крыс)». */
export const JOB_PLURAL: Record<JobId, string> = {
  idle: "Бездельники",
  forager: "Собиратели",
  pickpocket: "Карманники",
  scavenger: "Барахольщики",
  mechanic: "Механики",
  cheese_thief: "Сырные воришки",
  scholar: "Книжники",
  coal_miner: "Угольщики",
  stoker: "Кочегары",
  smelter: "Плавильщики",
  smith: "Кузнецы",
  appraiser: "Оценщики",
};

/** «из механиков»: where rats are taken from (genitive plural after «из»). */
export const JOB_FROM: Record<JobId, string> = {
  idle: "из бездельников",
  forager: "из собирателей",
  pickpocket: "из карманников",
  scavenger: "из барахольщиков",
  mechanic: "из механиков",
  cheese_thief: "из сырных воришек",
  scholar: "из книжников",
  coal_miner: "из угольщиков",
  stoker: "из кочегаров",
  smelter: "из плавильщиков",
  smith: "из кузнецов",
  appraiser: "из оценщиков",
};

/** «в карманники»: where to send rats (accusative plural after «в»). */
export const JOB_TO: Record<JobId, string> = {
  idle: "в бездельники",
  forager: "в собиратели",
  pickpocket: "в карманники",
  scavenger: "в барахольщики",
  mechanic: "в механики",
  cheese_thief: "в сырные воришки",
  scholar: "в книжники",
  coal_miner: "в угольщики",
  stoker: "в кочегары",
  smelter: "в плавильщики",
  smith: "в кузнецы",
  appraiser: "в оценщики",
};
