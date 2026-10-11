import { renderExtensionTemplateAsync } from '/scripts/extensions.js';
import { POPUP_TYPE, Popup } from '/scripts/popup.js';
import { extensionName } from '../core/settings.js';

const viewerPath = `third-party/${extensionName}/PreOptimizationViewer`;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalized(value) {
    return String(value ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function countChars(text) {
    return text.replace(/\s/g, '').length;
}

const narrowQuery = '(max-width: 768px)';

function buildColumn(title, text, side) {
    const $column = $('<section>').addClass(`pov-column pov-column-${side}`);
    $('<header>').addClass('pov-column-header')
        .append($('<span>').text(title), $('<small>').text(`${countChars(text)} 字`))
        .appendTo($column);
    $('<div>').addClass('pov-column-body').text(text).appendTo($column);
    return $column;
}

function scrollRatio(element) {
    const range = element.scrollHeight - element.clientHeight;
    return range > 0 ? element.scrollTop / range : 0;
}

function applyScrollRatio(element, ratio) {
    element.scrollTop = ratio * (element.scrollHeight - element.clientHeight);
}

// 按比例同步两栏滚动，长短不一的原文和结果也能大致对齐到同一段。
function syncScroll($bodies) {
    let syncing = null;
    $bodies.on('scroll', function () {
        if (syncing && syncing !== this) return;
        syncing = this;
        const ratio = scrollRatio(this);
        $bodies.not(this).each(function () { applyScrollRatio(this, ratio); });
        requestAnimationFrame(() => { syncing = null; });
    });
}

function renderInlineDiff(original, optimized) {
    const DiffMatchPatch = globalThis.SillyTavern?.libs?.DiffMatchPatch ?? globalThis.diff_match_patch;
    if (typeof DiffMatchPatch !== 'function') return null;
    const engine = new DiffMatchPatch();
    const diff = engine.diff_main(original, optimized);
    engine.diff_cleanupSemantic(diff);
    const html = diff.map(([operation, value]) => {
        const text = escapeHtml(value);
        if (operation === -1) return `<del>${text}</del>`;
        if (operation === 1) return `<ins>${text}</ins>`;
        return `<span>${text}</span>`;
    }).join('');
    return $('<div>').addClass('pov-column-body family2-diff').html(html);
}

// 宽屏：并列对照 / 逐字差异；窄屏（手机）放不下两栏，改为 优化前 / 优化后 / 逐字差异 三个整屏标签。
const modes = [
    { key: 'split', label: '并列对照', wide: true },
    { key: 'before', label: '优化前', narrow: true },
    { key: 'after', label: '优化后', narrow: true },
    { key: 'inline', label: '逐字差异', wide: true, narrow: true },
];

function bindModes($area, hasInline) {
    const media = window.matchMedia(narrowQuery);
    const $toggle = $('<div>').addClass('pov-toggle').attr('role', 'tablist');
    let current = null;

    const visibleBody = () => $area.find('.pov-column-body').filter((_, element) => element.offsetParent !== null).get(0);
    const setMode = key => {
        const from = visibleBody();
        const ratio = from ? scrollRatio(from) : 0;
        current = key;
        $area.attr('data-mode', key);
        $toggle.children().each(function () {
            const active = $(this).data('mode') === key;
            $(this).toggleClass('active', active).attr('aria-selected', String(active));
        });
        const to = visibleBody();
        if (to && to !== from) applyScrollRatio(to, ratio);
    };

    const render = () => {
        const list = modes.filter(mode => (media.matches ? mode.narrow : mode.wide) && (hasInline || mode.key !== 'inline'));
        $toggle.empty().toggleClass('family2-hidden', list.length < 2);
        for (const mode of list) {
            $('<button>', { type: 'button', class: 'menu_button', role: 'tab', text: mode.label })
                .data('mode', mode.key)
                .on('click', () => setMode(mode.key))
                .appendTo($toggle);
        }
        const keys = list.map(mode => mode.key);
        if (keys.includes(current)) setMode(current);
        else if (current === 'split') setMode('after');
        else if (current === 'before' || current === 'after') setMode('split');
        else setMode(media.matches && keys.includes('after') ? 'after' : keys[0]);
    };

    const onChange = () => {
        if (!$area.get(0).isConnected) {
            media.removeEventListener('change', onChange);
            return;
        }
        render();
    };
    media.addEventListener('change', onChange);
    $area.prepend($toggle);
    render();
}

async function renderDiff($area) {
    const snapshot = window.BodyOptimizerSnapshot;
    $area.empty();
    if (!snapshot?.original) {
        $area.append($('<p>').addClass('family2-note').text('尚未捕获到优化结果。'));
        return;
    }

    const original = normalized(snapshot.original);
    const optimized = snapshot.optimized === null ? '正在等待优化结果…' : normalized(snapshot.optimized);
    const $columns = $('<div>').addClass('pov-columns')
        .append(buildColumn('优化前', original, 'before'), buildColumn('优化后', optimized, 'after'));
    syncScroll($columns.find('.pov-column-body'));

    const $inline = snapshot.optimized === null ? null : renderInlineDiff(original, optimized);
    $area.append($columns);
    if ($inline) $area.append($('<div>').addClass('pov-inline').append($inline));
    bindModes($area, Boolean($inline));
}

async function showViewer() {
    if (!window.BodyOptimizerSnapshot?.original) {
        toastr.info('目前没有可供查看的优化结果。', '正文优化');
        return;
    }
    const template = $(await renderExtensionTemplateAsync(viewerPath, 'template'));
    await renderDiff(template.find('#pre-optimization-content'));
    new Popup(template, POPUP_TYPE.TEXT, '优化前后对比', {
        okButton: '关闭',
        wide: true,
        large: true,
    }).show();
}

const menu = document.getElementById('extensionsMenu');
if (menu && !document.getElementById('body-optimization-viewer-btn')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'body-optimization-viewer-btn';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.title = '查看最近一次正文优化差异';
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-file-lines';
    const label = document.createElement('span');
    label.textContent = '查看正文优化差异';
    button.append(icon, label);
    button.addEventListener('click', showViewer);
    menu.appendChild(button);
}
