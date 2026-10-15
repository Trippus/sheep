// Regression tests for reported bugs in the rules engine. One test per bug, named after
// its report in bugs/: test('BUG-001: …', …). See bugs/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../js/sheep.js';
import { LEVELS } from '../../js/levels.js';

// Example of the shape (not a real bug):
// test('BUG-001: level 37 cannot be finished after closing the blue pen', () => {
//   const L = S.parseLevel(LEVELS[36]);
//   ...
//   assert.ok(S.search(L, S.startState(L)));
// });

test('regression suite loads', () => assert.ok(LEVELS.length && S.startState(S.parseLevel(LEVELS[0]))));
