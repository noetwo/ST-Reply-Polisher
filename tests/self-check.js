import assert from 'node:assert/strict';
import { extractContentByTag, maskExclusionRules, replaceContentByTag, restoreExclusions } from '../core/utils.js';

const source = '<content>A<keep>x</keep>B<keep>y</keep>C</content><contentious>不应命中</contentious>';
const original = extractContentByTag(source, 'content');
assert.equal(original, 'A<keep>x</keep>B<keep>y</keep>C');

const masked = maskExclusionRules(original, [{ start: '<keep>', end: '</keep>' }], 'test');
assert.equal(masked.replacements.length, 2);
assert(!masked.text.includes('<keep>'));

const restored = restoreExclusions(masked.text.replace('A', '优化A'), masked.replacements);
assert.equal(restored, '优化A<keep>x</keep>B<keep>y</keep>C');
assert.equal(replaceContentByTag(source, 'content', restored), `<content>${restored}</content><contentious>不应命中</contentious>`);
assert.throws(() => restoreExclusions(masked.text.replace(masked.replacements[0].token, ''), masked.replacements));
assert.throws(() => restoreExclusions(masked.text + masked.replacements[0].token, masked.replacements));

console.log('self-check passed');
