// Module 12: Weighted Composite Score

import { MODULE_WEIGHTS } from "./constants.js";

export function computeCompositeScore(subscores) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [module, weight] of Object.entries(MODULE_WEIGHTS)) {
    if (subscores[module] !== undefined && subscores[module] !== null) {
      weightedSum += weight * subscores[module];
      totalWeight += weight;
    }
  }

  const rawScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 50;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let grade, label;
  if (score >= 80) {
    grade = "A";
    label = "Likely Organic";
  } else if (score >= 60) {
    grade = "B";
    label = "Mostly Organic";
  } else if (score >= 40) {
    grade = "C";
    label = "Some Suspicious Signals";
  } else if (score >= 20) {
    grade = "D";
    label = "Likely Manipulated";
  } else {
    grade = "F";
    label = "Highly Suspicious";
  }

  return { score, grade, label };
}
