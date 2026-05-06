import type { Annotation } from '../types';

export const landingAnnotations: Annotation[] = [
  {
    id: 'score-col',
    targetSelector: '[data-cheat="score-col"]',
    body: '% of tasks the model solved (with up to 2 tries).',
    bodyPrefix: 'Score',
    side: 'top',
    rotation: 2,
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
    body: 'Confidence interval. Wider = fewer tasks tested.',
    bodyPrefix: 'CI',
    side: 'top',
    rotation: 1,
  },
  {
    id: 'cost-col',
    targetSelector: '[data-cheat="cost-col"]',
    body: 'Average dollar cost per task attempted.',
    bodyPrefix: 'Cost',
    side: 'bottom',
    rotation: -2,
  },
  {
    id: 'cost-per-pass-col',
    targetSelector: '[data-cheat="cost-per-pass-col"]',
    body: 'Cost per successful task. Lower is cheaper.',
    bodyPrefix: '$/Pass',
    side: 'bottom',
    rotation: 2,
  },
  {
    id: 'worked-example-pass',
    targetSelector: '[data-cheat="worked-example-pass"]',
    body: '{display-name} passed {passed} of {total} tasks. {p1} on first try, {p2only} on retry.',
    bodyPrefix: 'Example',
    side: 'right',
    rotation: -1.5,
    template: true,
  },
];
