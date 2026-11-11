/* IRONTRAIL v3 rules — pure data and functions, usable in browsers or Node.
 * finish(run, summary) accepts previousStars:[bool,bool,bool] (or a count).
 * recordResult(save, stageIndex, result, summary) applies rewards once per result.
 * No rule changes the single cannon charge, +32 can value or 12-point recovery.
 */
(function (global) {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(n)) ? Number(n) : lo));
  const integer = (n, lo, hi) => Math.floor(clamp(n, lo, hi));
  const KEYS = ['engine', 'tyres', 'suspension', 'tank'];
  const PAR_TIMES = Object.freeze([15, 17, 20, 22, 24, 27, 29, 32, 36, 40]);
  const UPGRADE_COSTS = Object.freeze({ engine: Object.freeze([100, 220, 380]), tyres: Object.freeze([80, 180, 320]), suspension: Object.freeze([90, 200, 350]), tank: Object.freeze([100, 210, 360]) });
  const UPGRADE_META = Object.freeze({
    engine: Object.freeze({ label: 'Engine', subtitle: 'More pull. More pace.', description: 'Increase wheel torque and top speed.', icon: 'engine' }),
    tyres: Object.freeze({ label: 'Tyres', subtitle: 'Find your grip.', description: 'More traction on rough ground.', icon: 'tyre' }),
    suspension: Object.freeze({ label: 'Suspension', subtitle: 'Land it. Hold it.', description: 'Tighter springs and stronger air control.', icon: 'suspension' }),
    tank: Object.freeze({ label: 'Fuel system', subtitle: 'Go the extra mile.', description: 'Reduce fuel burn. Cans and recovery cost stay the same.', icon: 'fuel' })
  });
  const EFFECTS = Object.freeze({
    engine: { torque: [1, 1.1, 1.2, 1.3], speed: [1, 1.04, 1.08, 1.12] },
    tyres: { grip: [1, 1.08, 1.16, 1.24] },
    suspension: { frequencyHz: [4.4, 4.6, 4.8, 5], dampingRatio: [.85, .86, .87, .88], airControl: [1, 1.15, 1.3, 1.45] },
    tank: { drain: [1, .93, .86, .79] }
  });
  const CHALLENGES = Object.freeze([
    { id: 'all-zombies', label: 'Clear every zombie', check: r => r.totalZombies > 0 && r.cleared >= r.totalZombies, progress: r => r.totalZombies > 0 ? r.cleared / r.totalZombies : 0 },
    { id: 'all-cans', label: 'Collect every fuel can', check: r => r.totalCans > 0 && r.cans >= r.totalCans, progress: r => r.totalCans > 0 ? r.cans / r.totalCans : 0 },
    { id: 'clean-run', label: 'Finish without recovery', check: r => r.recoveries === 0, progress: r => r.recoveries === 0 ? 1 : 0 },
    { id: 'fuel-60', label: 'Finish with at least 60% fuel', check: r => r.fuel >= 60, progress: r => r.fuel / 60 },
    { id: 'land-a-flip', label: 'Land a complete flip', check: r => (r.stats?.flips || 0) >= 1, progress: r => r.stats?.flips || 0 },
    { id: 'two-perfect', label: 'Make two perfect landings', check: r => (r.stats?.perfectLandings || 0) >= 2, progress: r => (r.stats?.perfectLandings || 0) / 2 },
    { id: 'big-air', label: 'Land a 1.6 second jump', check: r => (r.stats?.bigAirs || 0) >= 1, progress: r => r.stats?.bigAirs || 0 },
    { id: 'no-recovery', label: 'Finish without recovery', check: r => r.recoveries === 0, progress: r => r.recoveries === 0 ? 1 : 0 },
    { id: 'fuel-35', label: 'Finish with at least 35% fuel', check: r => r.fuel >= 35, progress: r => r.fuel / 35 },
    { id: 'boss-gap', label: 'Beat Iron Maw by at least 15 m', check: r => r.rivalGap >= 15, progress: r => r.rivalGap / 15 }
  ].map(Object.freeze));
  function createRun(stageIndex) {
    return { stageIndex: integer(stageIndex, 0, 9), score: 0, combo: 0, comboLeft: 0, comboMax: 3, maxCombo: 0, elapsed: 0,
      buckets: { zombies: 0, tricks: 0, perfect: 0, air: 0, monster: 0, fuel: 0, checkpoints: 0, rival: 0, smashes: 0, slams: 0 }, rivalScores: 0, finalized: false, result: null };
  }
  function tick(run, dt) {
    if (!run || run.finalized) return;
    const seconds = clamp(dt, 0, 60); run.elapsed += seconds;
    run.comboLeft = Math.max(0, run.comboLeft - seconds);
    if (run.comboLeft === 0) run.combo = 0;
  }
  function onEvent(run, event, ctx) {
    if (!run || run.finalized || !event) return null;
    let points = 0, label = '', kind = 'score', bucket = '';
    switch (event.type) {
      case 'zombie': {
        run.combo = run.comboLeft > 0 ? run.combo + 1 : 1; run.comboLeft = run.comboMax;
        run.maxCombo = Math.max(run.maxCombo, run.combo);
        const multiplier = Math.min(5, 1 + Math.floor((run.combo - 1) / 3));
        points = 100 * multiplier; label = multiplier > 1 ? `ZOMBIE ×${multiplier}` : 'ZOMBIE CLEARED'; bucket = 'zombies'; break;
      }
      case 'landing': {
        if (!event.upright) return null;
        const flips = integer(event.flips, 0, 20);
        const trick = flips * 350, perfect = event.perfect ? 250 : 0, air = event.bigAir ? 300 : 0;
        points = trick + perfect + air;
        if (!points) return null;
        run.buckets.tricks += trick; run.buckets.perfect += perfect; run.buckets.air += air;
        label = flips ? `${flips > 1 ? `${flips}× ` : ''}${event.dir === 'front' ? 'FRONTFLIP' : 'BACKFLIP'}${event.perfect ? ' · PERFECT' : ''}` : event.perfect ? 'PERFECT LANDING' : 'BIG AIR';
        kind = 'trick'; break;
      }
      case 'smash': {
        // Roadside props keep the chain alive between zombies; Iron Maw's smashes score nothing.
        if (event.owner === 'rival') return null;
        run.combo = run.comboLeft > 0 ? run.combo + 1 : 1; run.comboLeft = run.comboMax;
        run.maxCombo = Math.max(run.maxCombo, run.combo);
        const multiplier = Math.min(5, 1 + Math.floor((run.combo - 1) / 3));
        points = 25 * multiplier; label = multiplier > 1 ? `SMASH ×${multiplier}` : 'SMASH'; bucket = 'smashes'; break;
      }
      case 'slam': points = 500; label = 'NITRO SLAM'; bucket = 'slams'; kind = 'big'; break;
      case 'monsterHit': points = 1000; label = 'GIANT DOWN'; bucket = 'monster'; kind = 'big'; break;
      case 'fuel': points = 100; label = 'FUEL COLLECTED'; bucket = 'fuel'; break;
      case 'checkpoint': points = 150; label = 'CHECKPOINT'; bucket = 'checkpoints'; break;
      case 'collision': if (run.rivalScores >= 20) return null; run.rivalScores++; points = 50; label = 'TRADING PAINT'; bucket = 'rival'; break;
      default: return null;
    }
    if (bucket) run.buckets[bucket] += points;
    run.score += points;
    return { points, label, kind, combo: run.combo };
  }
  function normalizedStars(value) {
    if (Array.isArray(value)) return [value[0] === true || value[0] === 1, value[1] === true || value[1] === 1, value[2] === true || value[2] === 1];
    const count = integer(value, 0, 3); return [count > 0, count > 1, count > 2];
  }
  function finish(run, summary = {}) {
    if (run.result) return run.result;
    const won = !!summary.won, stageIndex = run.stageIndex;
    const time = Number.isFinite(Number(summary.time)) && Number(summary.time) >= 0 ? Number(summary.time) : Infinity;
    const challenge = CHALLENGES[stageIndex];
    const stars = [won, won && time <= PAR_TIMES[stageIndex], won && !!challenge.check(summary)];
    const previous = normalizedStars(summary.previousStars ?? run.previousStars);
    const newStars = stars.reduce((n, star, i) => n + (star && !previous[i] ? 1 : 0), 0);
    const finishBonus = won ? 500 : 0, fuelBonus = won ? Math.floor(clamp(summary.fuel, 0, 100) * 5) : 0;
    const paceBonus = won ? Math.max(0, Math.floor((PAR_TIMES[stageIndex] - time) * 30)) : 0;
    const stats = summary.stats || {}, nitroBonus = won ? Math.floor(clamp(stats.nitroBurned, 0, 100000)) * 2 : 0;
    const score = run.score + finishBonus + fuelBonus + paceBonus + nitroBonus;
    const breakdown = [
      ['Zombies & combos', run.buckets.zombies], ['Landed flips', run.buckets.tricks], ['Perfect landings', run.buckets.perfect],
      ['Big air', run.buckets.air], ['Monster stopped', run.buckets.monster], ['Fuel cans', run.buckets.fuel],
      ['Checkpoints', run.buckets.checkpoints], ['Rival impacts', run.buckets.rival], ['Roadside smashes', run.buckets.smashes],
      ['Nitro slams', run.buckets.slams], ['Stage finish', finishBonus],
      ['Fuel bonus', fuelBonus], ['Pace bonus', paceBonus], ['Nitro burn', nitroBonus]
    ].filter(row => row[1] > 0).map(row => ({ label: row[0], value: row[1] }));
    const scrap = won ? 25 + Math.floor(score / 40) + newStars * 35 : Math.floor(score / 100);
    const number = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
    const awards = [
      ['topSpeed', 'TOP SPEED', number(stats.topSpeed) ? `${Math.round(number(stats.topSpeed) * 3.6)} KM/H` : ''],
      ['maxAir', 'LONGEST AIR', number(stats.maxAir) >= 0.3 ? `${number(stats.maxAir).toFixed(1)} S` : ''],
      ['chain', 'BEST CHAIN', run.maxCombo > 1 ? `×${run.maxCombo}` : ''],
      ['smashes', 'SMASHES', number(stats.smashes) ? String(Math.floor(number(stats.smashes))) : ''],
      ['slams', 'NITRO SLAMS', number(stats.slams) ? String(Math.floor(number(stats.slams))) : ''],
      ['nitro', 'NITRO BURNED', number(stats.nitroBurned) >= 1 ? String(Math.floor(number(stats.nitroBurned))) : '']
    ].filter(row => row[2]).map(row => ({ id: row[0], label: row[1], value: row[2] }));
    run.finalized = true;
    run.result = { score, breakdown, awards, stars, newStars, challenge: { id: challenge.id, label: challenge.label, complete: stars[2] }, scrap, maxCombo: run.maxCombo };
    return run.result;
  }
  function upgradeCost(track, level) { return KEYS.includes(track) && integer(level, 0, 3) < 3 ? UPGRADE_COSTS[track][integer(level, 0, 3)] : null; }
  function upgradeInfo(track, level, table) {
    if (!KEYS.includes(track)) return null;
    const current = integer(level, 0, 3), effects = table || global.TruckPhysics?.UPGRADES || EFFECTS;
    const e = effects[track] || EFFECTS[track];
    const text = n => track === 'engine' ? `+${Math.round((e.torque[n] - 1) * 100)}% torque · +${Math.round((e.speed[n] - 1) * 100)}% speed`
      : track === 'tyres' ? `+${Math.round((e.grip[n] - 1) * 100)}% grip`
      : track === 'suspension' ? `${e.frequencyHz[n].toFixed(1)} Hz · +${Math.round((e.airControl[n] - 1) * 100)}% air control`
      : `${Math.round((1 - e.drain[n]) * 100)}% less fuel burn`;
    return { track, ...UPGRADE_META[track], level: current, maxLevel: 3, cost: upgradeCost(track, current), current: text(current), next: current < 3 ? text(current + 1) : 'Fully upgraded' };
  }
  function defaults() {
    return { version: 3, unlocked: 1, completed: [], best: {}, selected: 0, stars: {}, bestScore: {}, scrap: 0,
      upgrades: { engine: 0, tyres: 0, suspension: 0, tank: 0 },
      settings: { master: .9, music: .55, sfx: .9, quality: 'auto', shake: true, showFps: false, reducedMotion: false, haptics: true, autoNitro: false },
      totals: { runs: 0, clears: 0, zombies: 0, flips: 0, cans: 0, scrapEarned: 0, smashes: 0, slams: 0 } };
  }
  function migrate(raw) {
    const out = defaults();
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { return out; } }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    out.completed = Array.isArray(raw.completed) ? [...new Set(raw.completed.filter(n => Number.isInteger(n) && n >= 0 && n < 10))].sort((a,b) => a-b) : [];
    out.unlocked = Math.max(integer(raw.unlocked || 1, 1, 10), out.completed.length ? Math.min(10, out.completed[out.completed.length - 1] + 2) : 1);
    out.selected = integer(raw.selected, 0, out.unlocked - 1);
    for (let i = 0; i < 10; i++) {
      if (raw.best && Number.isFinite(Number(raw.best[i])) && Number(raw.best[i]) > 0) out.best[i] = Number(raw.best[i]);
      if (raw.bestScore && Number.isFinite(Number(raw.bestScore[i])) && Number(raw.bestScore[i]) >= 0) out.bestScore[i] = Math.floor(Number(raw.bestScore[i]));
      if (raw.stars && raw.stars[i] != null) out.stars[i] = normalizedStars(raw.stars[i]);
      else if (out.completed.includes(i)) out.stars[i] = [true, false, false];
    }
    out.scrap = integer(raw.scrap, 0, 10000000);
    for (const track of KEYS) out.upgrades[track] = integer(raw.upgrades?.[track], 0, 3);
    const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    for (const volume of ['master', 'music', 'sfx']) if (Number.isFinite(Number(settings[volume]))) out.settings[volume] = clamp(settings[volume], 0, 1);
    if (['auto', 'high', 'balanced', 'performance'].includes(settings.quality)) out.settings.quality = settings.quality;
    for (const key of ['shake', 'showFps', 'reducedMotion', 'haptics', 'autoNitro']) if (typeof settings[key] === 'boolean') out.settings[key] = settings[key];
    for (const key of Object.keys(out.totals)) out.totals[key] = integer(raw.totals?.[key], 0, 1000000000);
    return out;
  }
  function load(storage) { try { const s = storage || global.localStorage; return migrate(s?.getItem('irontrail-campaign-v1')); } catch (_) { return defaults(); } }
  function save(storage, data) { try { const s = storage || global.localStorage; if (!s) return false; s.setItem('irontrail-campaign-v1', JSON.stringify(migrate(data))); return true; } catch (_) { return false; } }
  function buyUpgrade(data, track) {
    if (!data || !KEYS.includes(track)) return { ok: false, reason: 'invalid' };
    const level = integer(data.upgrades?.[track], 0, 3), cost = upgradeCost(track, level);
    if (cost === null) return { ok: false, reason: 'max', cost: null, level };
    if ((Number(data.scrap) || 0) < cost) return { ok: false, reason: 'scrap', cost, level };
    data.upgrades ||= { engine: 0, tyres: 0, suspension: 0, tank: 0 }; data.scrap -= cost; data.upgrades[track] = level + 1;
    return { ok: true, track, cost, level: level + 1 };
  }
  function recordResult(data, stageIndex, result, summary = {}) {
    if (!data || !result || result._recorded) return { applied: false };
    Object.defineProperty(result, '_recorded', { value: true, enumerable: false });
    const i = integer(stageIndex, 0, 9), won = !!summary.won;
    data.scrap = Math.max(0, Number(data.scrap) || 0) + result.scrap;
    data.totals ||= defaults().totals; data.totals.runs++;
    data.totals.scrapEarned += result.scrap; data.totals.zombies += integer(summary.cleared, 0, 10000);
    data.totals.flips += integer(summary.stats?.flips, 0, 1000); data.totals.cans += integer(summary.cans, 0, 10000);
    data.totals.smashes = integer(data.totals.smashes, 0, 1000000000) + integer(summary.stats?.smashes, 0, 10000);
    data.totals.slams = integer(data.totals.slams, 0, 1000000000) + integer(summary.stats?.slams, 0, 1000);
    let newBest = false, newScoreBest = false;
    if (won) {
      data.totals.clears++; data.completed ||= []; if (!data.completed.includes(i)) data.completed.push(i);
      data.unlocked = Math.max(Number(data.unlocked) || 1, Math.min(10, i + 2));
      data.stars ||= {}; const prior = normalizedStars(data.stars[i]); data.stars[i] = prior.map((v,n) => v || result.stars[n]);
      data.best ||= {}; if (!data.best[i] || summary.time < data.best[i]) { data.best[i] = summary.time; newBest = true; }
    }
    data.bestScore ||= {}; if (!data.bestScore[i] || result.score > data.bestScore[i]) { data.bestScore[i] = result.score; newScoreBest = true; }
    return { applied: true, newBest, newScoreBest, scrap: result.scrap, stars: data.stars?.[i] || [false, false, false] };
  }
  global.IronRules = Object.freeze({ PAR_TIMES, CHALLENGES, UPGRADE_COSTS, UPGRADE_META, UPGRADES: EFFECTS,
    createRun, onEvent, tick, finish, upgradeCost, upgradeInfo, buyUpgrade,
    Save: Object.freeze({ KEY: 'irontrail-campaign-v1', defaults, load, save, migrate, recordResult }), recordResult });
})(globalThis);
