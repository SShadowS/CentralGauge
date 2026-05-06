import type { Annotation } from '../types';

/**
 * Sides alternate top/bottom across columns 3..8 so callouts stagger
 * vertically and don't pile up on a single edge. With ~200px callouts
 * and ~80-150px column widths, three above + three below leaves room
 * for the collision-push to resolve cleanly.
 */
export const landingAnnotations: Annotation[] = [
  {
    id: 'score-col',
    targetSelector: '[data-cheat="score-col"]',
    body: 'Tasks solved (with up to 2 tries). The headline rank.',
    bodyPrefix: 'Score',
    side: 'top',
    rotation: 2,
  },
  {
    id: 'avg-attempt-col',
    targetSelector: '[data-cheat="avg-attempt-col"]',
    body: 'Per-attempt mean. Failed retries pull this below Score.',
    bodyPrefix: 'Avg attempt',
    side: 'bottom',
    rotation: -1,
  },
  {
    id: 'pass-col',
    targetSelector: '[data-cheat="pass-col"]',
    body: 'Green = solved on first try. Amber = solved on retry. Grey = failed.',
    bodyPrefix: 'Pass',
    side: 'top',
    rotation: -1.5,
  },
  {
    id: 'ci-col',
    targetSelector: '[data-cheat="ci-col"]',
    body: 'Confidence band. Wider = fewer tasks tested. Trust narrow ones.',
    bodyPrefix: 'CI',
    side: 'bottom',
    rotation: 1,
  },
  {
    id: 'cost-col',
    targetSelector: '[data-cheat="cost-col"]',
    body: "Dollars per attempt, averaged across this model's runs.",
    bodyPrefix: 'Cost',
    side: 'top',
    rotation: -2,
  },
  {
    id: 'cost-per-pass-col',
    targetSelector: '[data-cheat="cost-per-pass-col"]',
    body: 'What it costs to actually solve a task. Lower = better leverage.',
    bodyPrefix: '$/Pass',
    side: 'bottom',
    rotation: 2,
  },
  {
    id: 'worked-example-pass',
    targetSelector: '[data-cheat="worked-example-pass"]',
    body: '{display-name} solved {passed} of {total}. {p1} on first try, {p2only} after retry.',
    bodyPrefix: 'Read it',
    side: 'right',
    rotation: -1.5,
    template: true,
  },
];
