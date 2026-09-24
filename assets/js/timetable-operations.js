(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TayunetTimetableOperations = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const labels = Object.freeze({
    k: '継走', o: '折返',
    '継送': '継走', '継走': '継走', '折返': '折返', '折返し': '折返',
    '分割': '分割', '併合': '併合', '入区': '入区', '出区': '出区',
    '引上': '引上', '据付': '据付', '滞泊': '滞泊', '車交': '車交', '特発': '特発'
  });

  function label(value) {
    const text = String(value || '').trim();
    return labels[text] || text;
  }

  function forStop(train, stop, index) {
    const stops = Array.isArray(train?.stops) ? train.stops : [];
    const first = index === 0;
    const last = index === stops.length - 1;
    const explicitType = stop?.operationInfo ?? stop?.operationType ?? '';
    const explicitTrain = stop?.operationTrainNumber ?? stop?.operationTrain ?? '';
    const explicitKid = stop?.operationKid ?? '';
    const explicitDirection = stop?.operationDirection ?? '';
    if (explicitType || explicitTrain) {
      return {
        type: label(explicitType), trainNumber: String(explicitTrain || ''), kid: String(explicitKid || ''),
        direction: ['prev', 'next'].includes(explicitDirection) ? explicitDirection : 'either'
      };
    }
    if (first && (train?.tt1 || train?.tr1)) {
      return {type: label(train.tt1), trainNumber: String(train.tr1 || ''), kid: String(train.kid1 || train.kid || ''), direction: 'prev'};
    }
    if (last && (train?.tt2 || train?.tr2)) {
      return {type: label(train.tt2), trainNumber: String(train.tr2 || ''), kid: String(train.kid2 || train.kid || ''), direction: 'next'};
    }
    return {type: '', trainNumber: '', kid: '', direction: 'either'};
  }

  return { labels, label, forStop };
});
