import { eventSource, event_types, saveSettingsDebounced } from '/script.js';
import { getContext, renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { cancelOptimization, onMessageReceived, optimizeMessage } from './core/optimizer.js';
import { extensionName, getSettings } from './core/settings.js';
import { isOptimizableMessage } from './core/utils.js';
import { bindPanel } from './ui/bindings.js';

function addManualOptimizationButtons() {
    const context = getContext();
    $('#chat .mes').each(function () {
        const messageId = Number($(this).attr('mesid'));
        if (!Number.isInteger(messageId) || !isOptimizableMessage(context.chat?.[messageId])) return;
        const $actions = $(this).find('.extraMesButtons').first();
        if (!$actions.length || $actions.find('.body_optimizer_manual').length) return;
        $actions.prepend($('<div>', {
            class: 'mes_button body_optimizer_manual fa-solid fa-wand-magic-sparkles',
            title: '主动优化此消息',
        }));
    });
}

function bindManualOptimization() {
    $(document).on('click', '.body_optimizer_manual', async function () {
        const $button = $(this);
        if ($button.data('busy')) return;
        const messageId = Number($button.closest('.mes').attr('mesid'));
        if (!Number.isInteger(messageId)) return;
        $button.data('busy', true).addClass('fa-spin');
        try {
            await optimizeMessage(messageId);
        } finally {
            $button.data('busy', false).removeClass('fa-spin');
        }
    });
    addManualOptimizationButtons();
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, addManualOptimizationButtons);
}

async function initialize() {
    getSettings();
    saveSettingsDebounced();
    const template = await renderExtensionTemplateAsync(`third-party/${extensionName}`, 'ui/panel');
    const $host = $('#extensions_settings2');
    if (!$host.length) throw new Error('找不到 SillyTavern 扩展设置容器。');
    const $panel = $(template);
    $host.append($panel);
    bindPanel($panel);
    bindManualOptimization();

    eventSource.on(event_types.MESSAGE_RECEIVED, data => { void onMessageReceived(data); });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        cancelOptimization();
        setTimeout(addManualOptimizationButtons, 0);
    });
    await import('./PreOptimizationViewer/index.js');
    console.log('[正文优化] v1.2.5 已加载。');
}

initialize().catch(error => {
    console.error('[正文优化] 加载失败:', error);
    toastr.error(error?.message || '扩展加载失败，请查看控制台。', '正文优化');
});
