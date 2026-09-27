import assert from 'node:assert/strict';
import { extractContentByTag, extractModelIds, extractOpenAIText, findPairedTagNames, isOptimizableMessage, maskExcludedTags, normalizeOpenAIBaseUrl, parseOpenAISseLine, replaceContentByTag, restoreExclusions } from '../core/utils.js';

const source = '<content>A<keep>x</keep>B<keep>y</keep>C</content><contentious>不应命中</contentious>';
const original = extractContentByTag(source, 'content');
assert.equal(original, 'A<keep>x</keep>B<keep>y</keep>C');

assert.deepEqual(findPairedTagNames('<content><keep id="1">x</keep><empty/></content><broken>'), ['content', 'keep']);

const masked = maskExcludedTags('A<keep id="1">x</keep>B<keep>y</keep>C', ['keep'], 'test');
assert.equal(masked.replacements.length, 2);
assert(!masked.text.includes('<keep>'));

const restored = restoreExclusions(masked.text.replace('A', '优化A'), masked.replacements);
assert.equal(restored, '优化A<keep id="1">x</keep>B<keep>y</keep>C');
assert.equal(replaceContentByTag(source, 'content', restored), `<content>${restored}</content><contentious>不应命中</contentious>`);
const repeated = '<content>旧正文</content><meta>保留</meta><content>新正文</content>';
assert.equal(extractContentByTag(repeated, 'content'), '新正文');
assert.equal(replaceContentByTag(repeated, 'content', '优化正文'), '<content>旧正文</content><meta>保留</meta><content>优化正文</content>');
const nested = maskExcludedTags('<z><a>嵌套</a></z>', ['a', 'z'], 'nested');
assert.equal(restoreExclusions(nested.text, nested.replacements), '<z><a>嵌套</a></z>');
assert.throws(() => restoreExclusions(masked.text.replace(masked.replacements[0].token, ''), masked.replacements));
assert.throws(() => restoreExclusions(masked.text + masked.replacements[0].token, masked.replacements));
assert.equal(isOptimizableMessage({ mes: '<content>正文</content>' }), true);
assert.equal(isOptimizableMessage({ mes: '正文', is_user: true }), false);
assert.equal(isOptimizableMessage({ mes: '正文', is_system: true }), false);
assert.equal(isOptimizableMessage({ mes: '   ' }), false);
assert.equal(normalizeOpenAIBaseUrl('https://example.com/v1/chat/completions/'), 'https://example.com/v1');
assert.deepEqual(extractModelIds({ data: [{ id: 'model-b' }, { id: 'model-a' }] }), ['model-a', 'model-b']);
assert.deepEqual(extractModelIds({ data: { data: [{ id: 'nested-model' }] } }), ['nested-model']);
assert.throws(() => extractModelIds({ error: true, data: { data: [] } }), /模型列表接口不可用/);
assert.equal(parseOpenAISseLine('data: {"choices":[{"delta":{"content":"正文"}}]}'), '正文');
assert.equal(parseOpenAISseLine('data: [DONE]'), '');
assert.equal(extractOpenAIText({ choices: [{ message: { content: '完整正文' } }] }), '完整正文');
assert.throws(() => parseOpenAISseLine('data: {"error":{"message":"失败"}}'), /失败/);

console.log('self-check passed');
