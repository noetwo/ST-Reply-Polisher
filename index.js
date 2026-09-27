import { eventSource, event_types } from '/script.js';
import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { cancelOptimization, onMessageReceived } from './core/optimizer.js';
import { extensionName, getSettings } from './core/settings.js';
import { bindPanel } from './ui/bindings.js';

async function initialize() {
    getSettings();
    const template = await renderExtensionTemplateAsync(`third-party/${extensionName}`, 'ui/panel');
    const $host = $('#extensions_settings2');
    if (!$host.length) throw new Error('找不到 SillyTavern 扩展设置容器。');
    const $panel = $(template);
    $host.append($panel);
    bindPanel($panel);

    eventSource.on(event_types.MESSAGE_RECEIVED, data => { void onMessageReceived(data); });
    eventSource.on(event_types.CHAT_CHANGED, cancelOptimization);
    await import('./PreOptimizationViewer/index.js');
    console.log('[正文优化] v1.1.0 已加载。');
}

initialize().catch(error => {
    console.error('[正文优化] 加载失败:', error);
    toastr.error(error?.message || '扩展加载失败，请查看控制台。', '正文优化');
});
