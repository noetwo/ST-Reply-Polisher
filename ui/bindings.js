import { saveSettingsDebounced } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { fetchModels, testApiConnection } from '../core/api.js';
import { defaultSettings, getSettings, promptDefaults } from '../core/settings.js';
import { findPairedTagNames, isOptimizableMessage, isValidTagName } from '../core/utils.js';
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

function bindExclusionTags($panel, settings) {
    const $textarea = $panel.find('#amily2_excluded_tags_text');
    const $list = $panel.find('#amily2_exclusion_tag_list');
    let scanned = [];

    const selected = () => new Set(settings.optimizationExcludedTags ?? []);
    const syncTextarea = () => $textarea.val([...selected()].sort((a, b) => a.localeCompare(b)).join('\n'));
    const render = () => {
        const chosen = selected();
        const tags = [...new Set([...scanned, ...chosen])].sort((a, b) => a.localeCompare(b));
        $list.empty();
        if (!tags.length) $list.append($('<p>').addClass('family2-note').text('点击上方按钮扫描可排除标签。'));
        for (const tag of tags) {
            const $input = $('<input>', { type: 'checkbox' }).prop('checked', chosen.has(tag));
            $list.append($('<label>').addClass('family2-wb-item').append($input, $('<span>').text(`<${tag}>`)));
            $input.on('change', () => {
                const next = selected();
                $input.prop('checked') ? next.add(tag) : next.delete(tag);
                settings.optimizationExcludedTags = [...next].sort((a, b) => a.localeCompare(b));
                syncTextarea();
                saveSettingsDebounced();
            });
        }
    };

    syncTextarea();
    render();
    $textarea.on('change', () => {
        const targetTag = String(settings.optimizationTargetTag ?? '').trim();
        settings.optimizationExcludedTags = [...new Set(String($textarea.val() ?? '')
            .split('\n')
            .map(line => line.trim().replace(/^<|>$/g, ''))
            .filter(tag => isValidTagName(tag) && tag !== targetTag))]
            .sort((a, b) => a.localeCompare(b));
        syncTextarea();
        render();
        saveSettingsDebounced();
    });

    $panel.find('#amily2_scan_exclusion_tags').on('click', () => {
        const settingsTarget = String(settings.optimizationTargetTag ?? '').trim();
        const message = [...(getContext().chat ?? [])].reverse().find(isOptimizableMessage);
        if (!message) {
            toastr.warning('当前聊天中没有可扫描的 AI 消息。', '正文优化');
            return;
        }
        scanned = findPairedTagNames(message.mes).filter(tag => tag !== settingsTarget);
        render();
        toastr[scanned.length ? 'success' : 'info'](
            scanned.length ? `发现 ${scanned.length} 个成对标签。` : '最新 AI 消息中没有可排除的成对标签。',
            '正文优化',
        );
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
    const $modelInput = $panel.find('#amily2_model');
    const $modelPicker = $panel.find('#amily2_model_picker');
    $modelPicker.on('change', () => {
        const model = String($modelPicker.val() ?? '');
        if (model) $modelInput.val(model).trigger('input');
    });

    $panel.find('#amily2_refresh_models').on('click', async function () {
        const $button = $(this).prop('disabled', true).addClass('family2-spin');
        try {
            const models = await fetchModels();
            $modelPicker.empty().append($('<option>').val('').text('选择已获取模型'));
            for (const model of models) $modelPicker.append($('<option>').val(model).text(model));
            $modelPicker.prop('disabled', false);
            if (models.includes(String($modelInput.val() ?? ''))) $modelPicker.val($modelInput.val());
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

export function bindPanel($panel) {
    const settings = getSettings();
    bindGeneric($panel, settings);
    bindExclusionTags($panel, settings);
    bindPromptEditor($panel, settings);
    bindWorldbooks($panel, settings);
    bindApiButtons($panel);
}
