import { saveSettingsDebounced } from '/script.js';
import { fetchModels, testApiConnection } from '../core/api.js';
import { hasRetryableFailure, RETRY_STATE_EVENT, retryLastFailure } from '../core/optimizer.js';
import { defaultSettings, getApiKey, getSettings, promptDefaults, setApiKey } from '../core/settings.js';
import { listWorldBookNames } from '../core/worldbook.js';

const numberLimits = {
    maxTokens: [1, 1_000_000],
    temperature: [0, 2],
    contextMessages: [0, 100],
    requestTimeoutSeconds: [5, 600],
};

function snakeToCamel(value) {
    return value.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function bindGeneric($panel, settings) {
    $panel.find('[id^=amily2_]').each(function () {
        const $element = $(this);
        const key = snakeToCamel(this.id.replace(/^amily2_/, ''));
        if (!(key in defaultSettings)) return;

        if ($element.is(':checkbox')) $element.prop('checked', Boolean(settings[key]));
        else $element.val(settings[key] ?? '');

        const eventName = this.type === 'number' || $element.is(':checkbox') || $element.is('select') ? 'change' : 'input';
        $element.on(eventName, () => {
            if ($element.is(':checkbox')) {
                settings[key] = $element.prop('checked');
            } else if (this.type === 'number') {
                const parsed = Number($element.val());
                const [min, max] = numberLimits[key] ?? [-Infinity, Infinity];
                settings[key] = Number.isFinite(parsed)
                    ? Math.min(max, Math.max(min, parsed))
                    : defaultSettings[key];
                $element.val(settings[key]);
            } else {
                settings[key] = String($element.val() ?? '');
            }
            saveSettingsDebounced();
        });
    });
}

function bindApiKey($panel) {
    const $input = $panel.find('#amily2_api_key');
    $input.val(getApiKey());
    $input.on('input', () => setApiKey($input.val()));
}

function bindExclusionRules($panel, settings) {
    const $textarea = $panel.find('#amily2_exclusion_rules_text');
    $textarea.val((settings.optimizationExclusionRules ?? [])
        .filter(rule => rule?.start && rule?.end)
        .map(rule => `${rule.start}|||${rule.end}`)
        .join('\n'));
    $textarea.on('change', () => {
        settings.optimizationExclusionRules = String($textarea.val() ?? '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const separator = line.indexOf('|||');
                if (separator === -1) return null;
                const start = line.slice(0, separator).trim();
                const end = line.slice(separator + 3).trim();
                return start && end ? { start, end } : null;
            })
            .filter(Boolean);
        saveSettingsDebounced();
    });
}

function bindPromptEditor($panel, settings) {
    const $selector = $panel.find('#amily2_prompt_selector');
    const $editor = $panel.find('#amily2_unified_editor');
    const updateEditor = () => $editor.val(settings[$selector.val()] ?? '');
    updateEditor();
    $selector.on('change', updateEditor);
    $editor.on('input', () => {
        settings[$selector.val()] = String($editor.val() ?? '');
        saveSettingsDebounced();
    });
    $panel.find('#amily2_restore_prompt').on('click', () => {
        const key = $selector.val();
        settings[key] = structuredClone(promptDefaults[key]);
        updateEditor();
        saveSettingsDebounced();
        toastr.success('已恢复默认提示词。', '正文优化');
    });
}

function bindWorldbooks($panel, settings) {
    const $enabled = $panel.find('#amily2_wb_enabled');
    const $source = $panel.find('#amily2_wb_source');
    const $list = $panel.find('#amily2_wb_books_list');
    $enabled.prop('checked', Boolean(settings.modal_wbEnabled));
    $source.val(settings.modal_wbSource ?? 'character');

    const render = () => {
        const selected = new Set(settings.modal_amily2_wb_selected_worldbooks ?? []);
        $list.empty();
        const names = listWorldBookNames();
        if (!names.length) $list.append($('<p>').addClass('family2-note').text('暂未发现世界书。'));
        for (const name of names) {
            const $input = $('<input>', { type: 'checkbox' })
                .attr('data-family2-book', name)
                .prop('checked', selected.has(name));
            $list.append($('<label>').addClass('family2-wb-item').append($input, $('<span>').text(name)));
        }
        $list.find('input[type=checkbox]').on('change', () => {
            settings.modal_amily2_wb_selected_worldbooks = $list.find('input[type=checkbox]:checked')
                .map(function () { return $(this).attr('data-family2-book'); })
                .get();
            saveSettingsDebounced();
        });
    };
    const syncVisibility = () => $list.toggleClass('family2-hidden', settings.modal_wbSource !== 'manual');

    $enabled.on('change', () => {
        settings.modal_wbEnabled = $enabled.prop('checked');
        saveSettingsDebounced();
    });
    $source.on('change', () => {
        settings.modal_wbSource = String($source.val());
        saveSettingsDebounced();
        syncVisibility();
    });
    render();
    syncVisibility();
}

function bindApiButtons($panel) {
    $panel.find('#amily2_refresh_models').on('click', async function () {
        const $button = $(this).prop('disabled', true).addClass('family2-spin');
        try {
            const models = await fetchModels();
            const $list = $panel.find('#amily2_model_list').empty();
            for (const model of models) $list.append($('<option>').val(model));
            toastr.success(`已拉取 ${models.length} 个模型。`, '正文优化');
        } catch (error) {
            toastr.error(error?.message || '模型列表拉取失败。', '正文优化');
        } finally {
            $button.prop('disabled', false).removeClass('family2-spin');
        }
    });

    $panel.find('#amily2_test_api').on('click', async function () {
        const $button = $(this);
        const original = $button.text();
        $button.prop('disabled', true).text('测试中…');
        const result = await testApiConnection();
        $button.prop('disabled', false).text(original);
        toastr[result.ok ? 'success' : 'error'](result.message, '正文优化');
    });
}

function bindRetryButton($panel) {
    const $button = $panel.find('#amily2_retry_failed');
    const label = $button.text();
    const sync = () => $button.prop('disabled', !hasRetryableFailure());
    document.addEventListener(RETRY_STATE_EVENT, sync);
    $button.on('click', async () => {
        $button.prop('disabled', true).text('重试中…');
        await retryLastFailure();
        $button.text(label);
        sync();
    });
    sync();
}

export function bindPanel($panel) {
    const settings = getSettings();
    bindGeneric($panel, settings);
    bindApiKey($panel);
    bindExclusionRules($panel, settings);
    bindPromptEditor($panel, settings);
    bindWorldbooks($panel, settings);
    bindApiButtons($panel);
    bindRetryButton($panel);
}
