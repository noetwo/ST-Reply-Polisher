import { eventSource, event_types } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { callAI, generateRandomSeed } from './api.js';
import { getPresetPrompts } from './prompts.js';
import { getSettings } from './settings.js';
import { extractContentByTag, isOptimizableMessage, isValidTagName, maskExcludedTags, replaceContentByTag, restoreExclusions } from './utils.js';
import { getOptimizationWorldbookContent } from './worldbook.js';

let activeController = null;
let activeProgress = null;

function setSnapshot(snapshot) {
    window.BodyOptimizerSnapshot = snapshot;
}

function captureLease(context, messageId, message) {
    return {
        chatId: context.chatId,
        characterId: context.characterId,
        groupId: context.groupId,
        messageId,
        message,
        original: message.mes,
    };
}

function assertCurrent(lease, expectedContent = lease.original) {
    const context = getContext();
    const currentMessage = context.chat?.[lease.messageId];
    const sameChat = context.chatId === lease.chatId
        && context.characterId === lease.characterId
        && context.groupId === lease.groupId;
    if (!sameChat || currentMessage !== lease.message || currentMessage?.mes !== expectedContent) {
        throw new Error('聊天或目标消息已变化，本次结果已安全丢弃。');
    }
    return context;
}

function readMessageId(data, context) {
    const direct = Number(data?.mesId ?? data);
    if (Number.isInteger(direct)) return direct;
    return context.chat.indexOf(data?.message ?? data);
}

function clearProgress(controller) {
    if (!activeProgress || activeProgress.controller !== controller) return;
    toastr.clear(activeProgress.toast);
    activeProgress = null;
}

function showProgress(controller) {
    clearProgress(activeProgress?.controller);
    const toast = toastr.info('模型结果将完整接收并校验后再写回。', '正文优化中', {
        timeOut: 0,
        extendedTimeOut: 0,
        tapToDismiss: false,
        closeButton: false,
    });
    const $toast = $(toast);
    $('<button>', {
        type: 'button',
        class: 'menu_button family2-btn',
        text: '停止优化',
        'aria-label': '停止正文优化',
    }).on('click', event => {
        event.stopPropagation();
        controller.abort(new DOMException('用户已停止优化', 'AbortError'));
    }).appendTo($toast.find('.toast-message').first());
    activeProgress = { controller, toast };
}

export function cancelOptimization(reason = '聊天已变化') {
    const controller = activeController;
    controller?.abort(new DOMException(reason, 'AbortError'));
    clearProgress(controller);
    if (activeController === controller) activeController = null;
    setSnapshot(null);
}

async function runOptimization(messageId, manual = false) {
    const settings = getSettings();
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!isOptimizableMessage(message)) {
        if (manual) toastr.warning('只能优化非空的 AI 消息。', '正文优化');
        return false;
    }
    const lease = captureLease(context, messageId, message);

    activeController?.abort(new DOMException('已有更新的消息', 'AbortError'));
    clearProgress(activeController);
    const controller = new AbortController();
    activeController = controller;
    showProgress(controller);

    const configuredCount = Number(settings.contextMessages);
    const contextCount = Number.isFinite(configuredCount) ? Math.max(0, Math.min(100, Math.trunc(configuredCount))) : 2;
    const previousMessages = context.chat.slice(Math.max(0, messageId - contextCount), messageId);

    try {
        const result = await processOptimization(messageId, previousMessages, controller.signal);
        if (!result && manual) {
            toastr.warning(`该消息中没有可优化的 <${settings.optimizationTargetTag}> 内容。`, '正文优化');
        }
        return Boolean(result);
    } catch (error) {
        if (error?.name === 'AbortError') {
            if (error?.message === '用户已停止优化') toastr.info('已停止正文优化。', '正文优化');
            return false;
        }
        console.error('[正文优化] 任务失败:', error);
        if (settings.showOptimizationToast) toastr.error(error?.message || '正文优化失败。', '正文优化');
        return false;
    } finally {
        clearProgress(controller);
        if (activeController === controller) activeController = null;
    }
}

export async function onMessageReceived(data) {
    if (!getSettings().optimizationEnabled) return;
    const context = getContext();
    const messageId = readMessageId(data, context);
    await runOptimization(messageId);
}

export async function optimizeMessage(messageId) {
    return await runOptimization(messageId, true);
}

export async function processOptimization(messageId, previousMessages, signal) {
    const settings = getSettings();
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message || typeof message.mes !== 'string') return null;

    const targetTag = String(settings.optimizationTargetTag ?? 'content').trim();
    if (!isValidTagName(targetTag)) throw new Error('目标标签名无效。');

    const lease = captureLease(context, messageId, message);
    const originalTarget = extractContentByTag(lease.original, targetTag);
    if (!originalTarget?.trim()) return null;

    const masked = settings.optimizationExclusionEnabled
        ? maskExcludedTags(originalTarget, settings.optimizationExcludedTags)
        : { text: originalTarget, replacements: [] };
    setSnapshot({ original: originalTarget, optimized: null });

    const lastMessage = previousMessages.at(-1);
    const lastUserMessage = lastMessage?.is_user ? lastMessage : null;
    const historyMessages = lastUserMessage ? previousMessages.slice(0, -1) : previousMessages;
    const userName = context.name1 || '用户';
    const characterName = context.name2 || '角色';
    const history = historyMessages
        .filter(item => typeof item?.mes === 'string' && item.mes.trim())
        .map(item => `${item.is_user ? userName : characterName}: ${item.mes.trim()}`)
        .join('\n');

    const worldbook = await getOptimizationWorldbookContent();
    if (signal?.aborted) throw signal.reason;
    assertCurrent(lease);

    const fixedPrompts = await getPresetPrompts('optimization') ?? [];
    const closingPrompt = fixedPrompts.at(-1);
    const messages = [
        { role: 'system', content: generateRandomSeed() },
        ...fixedPrompts.slice(0, -1),
    ];
    if (settings.mainPrompt?.trim()) messages.push({ role: 'system', content: settings.mainPrompt.trim() });
    if (settings.systemPrompt?.trim()) messages.push({ role: 'system', content: settings.systemPrompt.trim() });
    if (settings.outputFormatPrompt?.trim()) messages.push({ role: 'system', content: settings.outputFormatPrompt.trim() });
    if (worldbook) messages.push({ role: 'user', content: `[世界书档案]:\n${worldbook}` });
    if (history) messages.push({ role: 'user', content: `[上下文参考]:\n${history}` });

    const targetBlock = `<${targetTag}>${masked.text}</${targetTag}>`;
    const interaction = lastUserMessage
        ? `${userName}（用户）最新消息：${lastUserMessage.mes}\n${characterName}（AI）最新消息，[核心处理内容]：${targetBlock}`
        : `${characterName}（AI）最新消息，[核心处理内容]：${targetBlock}`;
    messages.push({ role: 'user', content: `[目标内容]:\n${interaction}` });
    if (closingPrompt) messages.push(closingPrompt);

    const rawContent = await callAI(messages, { signal });
    const optimizedTarget = extractContentByTag(rawContent, targetTag);
    if (!optimizedTarget?.trim()) throw new Error(`API 回复中没有有效的 <${targetTag}> 标签。`);

    const restoredTarget = restoreExclusions(optimizedTarget, masked.replacements);
    assertCurrent(lease);
    const finalMessage = replaceContentByTag(lease.original, targetTag, restoredTarget);

    const applied = settings.applyOptimizedToMessage && finalMessage !== lease.original
        ? await applyMessageContent(lease, finalMessage)
        : false;
    const current = getContext();
    if (current.chatId === lease.chatId && current.characterId === lease.characterId && current.groupId === lease.groupId) {
        setSnapshot({ original: originalTarget, optimized: restoredTarget });
    }
    if (settings.showOptimizationToast) {
        toastr.success(applied ? '优化完成，已写回消息。' : '优化完成，可打开对比查看。', '正文优化');
    }
    return { originalContent: lease.original, optimizedContent: finalMessage, applied };
}

async function applyMessageContent(lease, newContent) {
    const context = assertCurrent(lease);
    lease.message.mes = newContent;
    try {
        await context.saveChat();
    } catch (error) {
        if (lease.message.mes === newContent) lease.message.mes = lease.original;
        throw error;
    }

    try {
        assertCurrent(lease, newContent);
        await eventSource.emit(event_types.MESSAGE_EDITED, lease.messageId);
        await context.reloadCurrentChat();
    } catch (error) {
        console.warn('[正文优化] 消息已保存，但界面刷新失败；手动刷新聊天即可。', error);
    }
    return true;
}
