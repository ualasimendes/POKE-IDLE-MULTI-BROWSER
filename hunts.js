const fs = require('fs');
const path = require('path');

let creatures = [];
let items = [];
let hunts = [];
let itemPrices = {};

const TYPE_CHART = {
  NORMAL: { ROCK: 0.5, GHOST: 0, STEEL: 0.5 },
  FIRE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 2, BUG: 2, ROCK: 0.5, DRAGON: 0.5, STEEL: 2 },
  WATER: { FIRE: 2, WATER: 0.5, GRASS: 0.5, GROUND: 2, ROCK: 2, DRAGON: 0.5 },
  ELECTRIC: { WATER: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0, FLYING: 2, DRAGON: 0.5 },
  GRASS: { FIRE: 0.5, WATER: 2, GRASS: 0.5, POISON: 0.5, GROUND: 2, FLYING: 0.5, BUG: 0.5, ROCK: 2, DRAGON: 0.5, STEEL: 0.5 },
  ICE: { FIRE: 0.5, WATER: 0.5, GRASS: 2, ICE: 0.5, GROUND: 2, FLYING: 2, DRAGON: 2, STEEL: 0.5 },
  FIGHTING: { NORMAL: 2, ICE: 2, POISON: 0.5, FLYING: 0.5, PSYCHIC: 0.5, BUG: 0.5, ROCK: 2, GHOST: 0, DARK: 2, STEEL: 2, FAIRY: 0.5 },
  POISON: { GRASS: 2, POISON: 0.5, GROUND: 0.5, ROCK: 0.5, GHOST: 0.5, STEEL: 0, FAIRY: 2 },
  GROUND: { FIRE: 2, ELECTRIC: 2, GRASS: 0.5, POISON: 2, FLYING: 0, BUG: 0.5, ROCK: 2, STEEL: 2 },
  FLYING: { ELECTRIC: 0.5, GRASS: 2, FIGHTING: 2, BUG: 2, ROCK: 0.5, STEEL: 0.5 },
  PSYCHIC: { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, STEEL: 0.5 },
  BUG: { FIRE: 0.5, GRASS: 2, FIGHTING: 0.5, POISON: 0.5, FLYING: 0.5, PSYCHIC: 2, GHOST: 0.5, DARK: 2, STEEL: 0.5, FAIRY: 0.5 },
  ROCK: { FIRE: 2, ICE: 2, FIGHTING: 0.5, GROUND: 0.5, FLYING: 2, BUG: 2, STEEL: 0.5 },
  GHOST: { NORMAL: 0, PSYCHIC: 2, GHOST: 2, DARK: 0.5 },
  DRAGON: { DRAGON: 2, STEEL: 0.5, FAIRY: 0 },
  DARK: { FIGHTING: 0.5, PSYCHIC: 2, GHOST: 2, DARK: 0.5, FAIRY: 0.5 },
  STEEL: { FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5, ICE: 2, ROCK: 2, STEEL: 0.5, FAIRY: 2 },
  FAIRY: { FIRE: 0.5, FIGHTING: 2, POISON: 0.5, DRAGON: 2, DARK: 2, STEEL: 0.5 }
};

function init() {
  try {
    const cData = JSON.parse(fs.readFileSync(path.join(__dirname, 'creatures.json'), 'utf8'));
    const iData = JSON.parse(fs.readFileSync(path.join(__dirname, 'items.json'), 'utf8'));
    const mData = JSON.parse(fs.readFileSync(path.join(__dirname, 'map-markers.json'), 'utf8'));

    creatures = cData.creatures || cData;
    items = iData.items || iData;
    hunts = mData.hunts || mData;

    for (const item of items) {
      if (item.name) {
        itemPrices[item.name.toLowerCase()] = item.npcPrice || item.sellValue || 0;
      }
    }
  } catch (e) {
    console.error("Erro ao carregar banco de dados PIWTools:", e);
  }
}

function getTypeEffectiveness(atkType, defType1, defType2) {
  if (!atkType || !TYPE_CHART[atkType]) return 1;
  let mult = 1;
  if (defType1 && TYPE_CHART[atkType][defType1] !== undefined) mult *= TYPE_CHART[atkType][defType1];
  if (defType2 && TYPE_CHART[atkType][defType2] !== undefined) mult *= TYPE_CHART[atkType][defType2];
  return mult;
}

function cleanName(name) {
  if (!name) return '';
  return name.replace(/^(shiny|mega|shadow|ancient)\s+/i, '')
             .toLowerCase()
             .replace(/[^a-z0-9]/g, '');
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
  return num.toString();
}

function getRecommendedHunts(pokemonName, rawLevel) {
  if (!creatures.length) init();

  if (!pokemonName) return null;

  const levelNum = typeof rawLevel === 'number' 
    ? rawLevel 
    : parseInt(String(rawLevel).replace(/\D/g, ''), 10) || 100;

  const targetClean = cleanName(pokemonName);
  let poke = creatures.find(c => cleanName(c.name) === targetClean);
  
  if (!poke) {
    poke = creatures.find(c => cleanName(c.name).includes(targetClean) || targetClean.includes(cleanName(c.name)));
  }

  if (!poke) return null;

  const atkType1 = poke.type1 || 'NORMAL';
  const atkType2 = poke.type2 || null;

  const targetCreatures = creatures.filter(c => c.huntLevel && c.experience > 0);
  const scoredHunts = [];

  for (const target of targetCreatures) {
    const diff = levelNum - target.huntLevel;
    if (diff < -60 || diff > 160) continue;

    const eff1 = getTypeEffectiveness(atkType1, target.type1, target.type2);
    const eff2 = getTypeEffectiveness(atkType2, target.type1, target.type2);
    const bestEff = Math.max(eff1, eff2);

    if (bestEff === 0) continue;

    const levelFactor = Math.max(0.2, Math.min(2.5, (levelNum / (target.huntLevel || 1))));

    let avgLootValuePerKill = 0;
    if (target.loot && Array.isArray(target.loot)) {
      for (const item of target.loot) {
        const p = itemPrices[item.name.toLowerCase()] || target.priceNpc || 100;
        const avgQty = ((item.minCount || 1) + (item.maxCount || 1)) / 2;
        const dropRate = (item.chance || 0) / 100000;
        avgLootValuePerKill += dropRate * avgQty * p;
      }
    }
    if (avgLootValuePerKill === 0) {
      avgLootValuePerKill = target.sellValue || target.priceNpc || 500;
    }

    const killsPerHour = Math.round(500 * levelFactor * Math.sqrt(bestEff));
    const estXpPerHour = Math.round(killsPerHour * target.experience * 1.5);
    const estDollarPerHour = Math.round(killsPerHour * avgLootValuePerKill);

    const huntMap = hunts.find(h => h.name.toLowerCase().includes(target.name.toLowerCase()) || (target.area && h.area === target.area));
    const huntLocationName = huntMap ? huntMap.name : target.name;

    scoredHunts.push({
      targetName: target.name,
      huntLevel: target.huntLevel,
      location: huntLocationName,
      typeEff: bestEff,
      xpPerHour: estXpPerHour,
      xpFormatted: formatNumber(estXpPerHour),
      dollarPerHour: estDollarPerHour,
      dollarFormatted: formatNumber(estDollarPerHour)
    });
  }

  if (!scoredHunts.length) return null;

  const bestXp = [...scoredHunts].sort((a, b) => b.xpPerHour - a.xpPerHour)[0];
  const bestDollar = [...scoredHunts].sort((a, b) => b.dollarPerHour - a.dollarPerHour)[0];

  return { bestXp, bestDollar };
}

init();

module.exports = { getRecommendedHunts };
