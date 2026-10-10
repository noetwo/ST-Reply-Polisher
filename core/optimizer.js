import { eventSource, event_types } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { callAI } from './api.js';
import { buildOptimizationMessages } from './prompts.js';
import { getSettings } from './settings.js';
import { extractContentByTag, isOptimizableMessage, isValidTagName, maskExcludedTags, replaceContentByTag, restoreExclusions } from './utils.js';
import { getOptimizationWorldbookContent } from './worldbook.js';

let activeController = null;
let activeProgress = null;
const toastOptions = { toastClass: 'toast body-optimizer-toast', closeButton: false, progressBar: false, escapeHtml: true };

function setSnapshot(snapshot) {
    window.BodyOptimizerSnapshot = snapshot;
}

function captureLease(context, messageId, message, targetTag) {
    return {
        chatId: context.chatId,
        characterId: context.characterId,
        groupId: context.groupId,
        messageId,
        message,
        swipeId: message.swipe_id,
        targetTag,
        original: message.mes,
        originalTarget: extractContentByTag(message.mes, targetTag),
    };
}

// 只校验目标标签内的正文：MVU 等脚本在收到消息后会改写标签外的内容（如追加状态栏占位符），这不应作废优化结果。
function assertCurrent(lease, expectedTarget = lease.originalTarget) {
    const context = getContext();
    const currentMessage = context.chat?.[lease.messageId];
    const sameChat = context.chatId === lease.chatId
        && context.characterId === lease.characterId
        && context.groupId === lease.groupId;
    if (!sameChat || currentMessage !== lease.message) {
        throw new Error('聊天或目标消息已变化，本次结果已安全丢弃。');
    }
    if (currentMessage.swipe_id !== lease.swipeId) {
        throw new Error('目标消息已切换到其他回复，本次结果已安全丢弃。');
    }
    if (extractContentByTag(currentMessage.mes, lease.targetTag) !== expectedTarget) {
        throw new Error(`目标消息的 <${lease.targetTag}> 正文已被其他脚本或编辑改动，本次结果已安全丢弃。`);
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
    toastr.clear(activeProgress.toast, { force: true });
    activeProgress = null;
}

function showProgress(controller) {
    clearProgress(activeProgress?.controller);
    const toast = toastr.info('正在处理，请稍候…', '正文优化中', {
        ...toastOptions,
        timeOut: 0,
        extendedTimeOut: 0,
        tapToDismiss: false,
        preventDuplicates: false,
    });
    const $toast = $(toast);
    $('<button>', {
        type: 'button',
        class: 'body-optimizer-stop',
        text: '停止优化',
        'aria-label': '停止正文优化',
    }).on('click', event => {
        event.stopPropagation();
        controller.abort(new DOMException('用户已停止优化', 'AbortError'));
    }).appendTo($toast.find('.toast-title').first());
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
        if (manual) toastr.warning('只能优化非空的 AI 消息。', '正文优化', toastOptions);
        return false;
    }
    activeController?.abort(new DOMException('已有更新的消息', 'AbortError'));
    clearProgress(activeController);
    const controller = new AbortController();
    activeController = controller;
    showProgress(controller);

    try {
        const result = await processOptimization(messageId, controller.signal);
        if (!result && manual) {
            toastr.warning(`该消息中没有可优化的 <${settings.optimizationTargetTag}> 内容。`, '正文优化', toastOptions);
        }
        return Boolean(result);
    } catch (error) {
        if (error?.name === 'AbortError') {
            if (error?.message === '用户已停止优化') toastr.info('已停止正文优化。', '正文优化', toastOptions);
            return false;
        }
        console.error('[正文优化] 任务失败:', error);
        if (settings.showOptimizationToast) {
            const detail = error?.message || '正文优化失败。';
            const toast = toastr.error(detail, '正文优化失败', toastOptions);
            $(toast).find('.toast-message').attr('title', detail);
        }
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

export async function processOptimization(messageId, signal) {
    const startedAt = performance.now();
    const settings = getSettings();
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message || typeof message.mes !== 'string') return null;

    const targetTag = String(settings.optimizationTargetTag ?? 'content').trim();
    if (!isValidTagName(targetTag)) throw new Error('目标标签名无效。');

    const lease = captureLease(context, messageId, message, targetTag);
    const originalTarget = lease.originalTarget;
    if (!originalTarget?.trim()) return null;

    const masked = settings.optimizationExclusionEnabled
        ? maskExcludedTags(originalTarget, settings.optimizationExcludedTags)
        : { text: originalTarget, replacements: [] };
    setSnapshot({ original: originalTarget, optimized: null });

    const worldbook = await getOptimizationWorldbookContent();
    if (signal?.aborted) throw signal.reason;
    assertCurrent(lease);

    const messages = buildOptimizationMessages({
        settings, chat: context.chat, messageId, worldbook, targetTag, targetText: masked.text,
    });

    const rawContent = await callAI(messages, { signal });
    const optimizedTarget = extractContentByTag(rawContent, targetTag);
    if (!optimizedTarget?.trim()) throw new Error(`API 回复中没有有效的 <${targetTag}> 标签。`);

    const restoredTarget = restoreExclusions(optimizedTarget, masked.replacements);
    assertCurrent(lease);
    const baseMessage = lease.message.mes;
    const finalMessage = replaceContentByTag(baseMessage, targetTag, restoredTarget);

    const applied = settings.applyOptimizedToMessage && finalMessage !== baseMessage
        ? await applyMessageContent(lease, baseMessage, finalMessage, restoredTarget)
        : false;
    const current = getContext();
    if (current.chatId === lease.chatId && current.characterId === lease.characterId && current.groupId === lease.groupId) {
        setSnapshot({ original: originalTarget, optimized: restoredTarget });
    }
    if (settings.showOptimizationToast) {
        const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
        toastr.success(`耗时 ${seconds} 秒 · ${applied ? '已写回消息' : '可查看对比'}`, '正文优化完成', toastOptions);
    }
    return { originalContent: baseMessage, optimizedContent: finalMessage, applied };
}

function writeMessage(message, content) {
    message.mes = content;
    if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id) && message.swipe_id in message.swipes) {
        message.swipes[message.swipe_id] = content;
    }
}

async function applyMessageContent(lease, baseContent, newContent, newTarget) {
    const context = assertCurrent(lease);
    writeMessage(lease.message, newContent);
    try {
        await context.saveChat();
    } catch (error) {
        if (lease.message.mes === newContent) writeMessage(lease.message, baseContent);
        throw error;
    }

    try {
        assertCurrent(lease, newTarget);
        await eventSource.emit(event_types.MESSAGE_EDITED, lease.messageId);
        await context.reloadCurrentChat();
    } catch (error) {
        console.warn('[正文优化] 消息已保存，但界面刷新失败；手动刷新聊天即可。', error);
    }
    return true;
}
