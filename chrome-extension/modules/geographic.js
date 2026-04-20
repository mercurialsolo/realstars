// Module 9: Geographic Clustering (weight: 0.05)

export function normalizeLocation(loc) {
  if (/china|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu/i.test(loc)) return "china";
  if (/india|mumbai|bangalore|bengaluru|delhi|hyderabad|chennai|pune/i.test(loc)) return "india";
  if (/russia|moscow|saint petersburg|novosibirsk/i.test(loc)) return "russia";
  if (/brazil|são paulo|rio|brasilia/i.test(loc)) return "brazil";
  if (/usa|united states|california|new york|san francisco|seattle|texas/i.test(loc)) return "usa";
  if (/uk|united kingdom|london|england/i.test(loc)) return "uk";
  if (/germany|berlin|munich|hamburg/i.test(loc)) return "germany";
  if (/france|paris|lyon/i.test(loc)) return "france";
  if (/japan|tokyo|osaka/i.test(loc)) return "japan";
  if (/korea|seoul/i.test(loc)) return "south korea";
  if (/vietnam|hanoi|ho chi minh/i.test(loc)) return "vietnam";
  if (/indonesia|jakarta/i.test(loc)) return "indonesia";
  if (/pakistan|karachi|lahore|islamabad/i.test(loc)) return "pakistan";
  if (/bangladesh|dhaka/i.test(loc)) return "bangladesh";
  if (/nigeria|lagos/i.test(loc)) return "nigeria";
  if (/ukraine|kyiv|kiev/i.test(loc)) return "ukraine";
  if (/turkey|istanbul|ankara/i.test(loc)) return "turkey";
  if (/iran|tehran/i.test(loc)) return "iran";
  if (/canada|toronto|vancouver|montreal/i.test(loc)) return "canada";
  if (/australia|sydney|melbourne/i.test(loc)) return "australia";
  return loc;
}

export function analyzeGeographicClustering(profiles) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length < 5) {
    return { topLocation: null, topPercent: 0, subscore: 0.5, signals: [] };
  }

  const locations = profiles
    .map((p) => p.location)
    .filter((loc) => loc && loc.trim().length > 0)
    .map((loc) => loc.trim().toLowerCase());

  if (locations.length < 3) {
    signals.push({
      signal: "Insufficient location data",
      value: `${locations.length} profiles with location`,
      severity: "ok",
      detail: "Not enough location data to detect geographic clustering.",
      category: "geographic",
    });
    return { topLocation: null, topPercent: 0, subscore: 0.5, signals };
  }

  const normalized = locations.map(normalizeLocation);

  const locationCounts = {};
  for (const loc of normalized) {
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
  }

  let topLocation = null;
  let topCount = 0;
  for (const [loc, count] of Object.entries(locationCounts)) {
    if (count > topCount) {
      topCount = count;
      topLocation = loc;
    }
  }

  const topPercent = (topCount / locations.length) * 100;

  if (topPercent > 70) {
    subscore -= 0.5;
    signals.push({
      signal: "Extreme geographic concentration",
      value: `${topPercent.toFixed(1)}% from "${topLocation}"`,
      severity: "high",
      detail: "Over 70% of profiles with a location share the same country/region.",
      category: "geographic",
    });
  } else if (topPercent > 60) {
    subscore -= 0.3;
    signals.push({
      signal: "High geographic concentration",
      value: `${topPercent.toFixed(1)}% from "${topLocation}"`,
      severity: "medium",
      detail: "Over 60% from one region suggests a potential star farm cluster.",
      category: "geographic",
    });
  } else {
    signals.push({
      signal: "Geographic diversity",
      value: `Top: ${topPercent.toFixed(1)}% "${topLocation}"`,
      severity: "ok",
      detail: "Stargazers are geographically distributed — organic signal.",
      category: "geographic",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return {
    topLocation,
    topPercent: Math.round(topPercent * 10) / 10,
    subscore,
    signals,
  };
}
