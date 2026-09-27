import assert from 'node:assert/strict';
import { buildOptimizationMessages, defaultExecutionPrompt } from '../core/prompts.js';
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

const promptInput = {
    settings: { mainPrompt: '提示1', systemPrompt: '提示2', outputFormatPrompt: '提示3', contextMessages: 3, executionPrompt: '' },
    chat: [
        { mes: '太旧的消息', is_user: true },
        { mes: '用户消息1', is_user: true },
        { mes: 'AI消息2', is_user: false },
        { mes: '系统通知', is_system: true },
        { mes: '   ', is_user: true },
        { mes: '用户消息3', is_user: true },
        { mes: '当前目标', is_user: false },
        { mes: '主动优化旧消息时不应发送后续消息', is_user: true },
    ],
    messageId: 6,
    worldbook: '世界书测试资料',
    targetTag: 'story',
    targetText: '第一段\n\n第二段',
};
const beforeBuild = structuredClone(promptInput);
const messages = buildOptimizationMessages(promptInput);
assert.deepEqual(messages.map(message => message.role), ['system', 'system', 'system', 'system', 'user', 'assistant', 'user', 'assistant', 'user']);
assert.deepEqual(messages.slice(0, 3).map(message => message.content), ['提示1', '提示2', '提示3']);
assert(messages[3].content.includes(promptInput.worldbook));
assert.deepEqual(messages.slice(4, 7).map(message => message.content), ['用户消息1', 'AI消息2', '用户消息3']);
assert.equal(messages[7].content, '<story>第一段\n\n第二段</story>');
assert.equal(messages.at(-1).content, defaultExecutionPrompt.replaceAll('{{targetTag}}', 'story'));
assert.deepEqual(promptInput, beforeBuild);
const minimalInput = { ...promptInput, worldbook: '', settings: { contextMessages: 0, executionPrompt: '处理 <{{targetTag}}>，返回 </{{targetTag}}>。' } };
assert.deepEqual(buildOptimizationMessages(minimalInput), [
    { role: 'assistant', content: '<story>第一段\n\n第二段</story>' },
    { role: 'user', content: '处理 <story>，返回 </story>。' },
]);
assert.equal(buildOptimizationMessages({ ...minimalInput, settings: { contextMessages: 0, executionPrompt: ' \n ' } }).at(-1).content, messages.at(-1).content);

console.log('self-check passed');
