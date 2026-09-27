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

async function renderDiff($container) {
    const snapshot = window.BodyOptimizerSnapshot;
    if (!snapshot?.original) {
        $container.empty().append($('<p>').addClass('family2-note').text('尚未捕获到优化结果。'));
        return;
    }
    if (snapshot.optimized === null) {
        $container.html(`<p>正在等待优化结果…</p><pre>${escapeHtml(normalized(snapshot.original))}</pre>`);
        return;
    }

    const original = normalized(snapshot.original);
    const optimized = normalized(snapshot.optimized);
    const DiffMatchPatch = globalThis.SillyTavern?.libs?.DiffMatchPatch ?? globalThis.diff_match_patch;
    if (typeof DiffMatchPatch !== 'function') {
        $container.html(`<h4>优化前</h4><pre>${escapeHtml(original)}</pre><h4>优化后</h4><pre>${escapeHtml(optimized)}</pre>`);
        return;
    }

    const engine = new DiffMatchPatch();
    const diff = engine.diff_main(original, optimized);
    engine.diff_cleanupSemantic(diff);
    const html = diff.map(([operation, value]) => {
        const text = escapeHtml(value);
        if (operation === -1) return `<del>${text}</del>`;
        if (operation === 1) return `<ins>${text}</ins>`;
        return `<span>${text}</span>`;
    }).join('');
    $container.html(`<pre class="family2-diff">${html}</pre>`);
}

async function showViewer() {
    if (!window.BodyOptimizerSnapshot?.original) {
        toastr.info('目前没有可供查看的优化结果。', '正文优化');
        return;
    }
    const template = $(await renderExtensionTemplateAsync(viewerPath, 'template'));
    await renderDiff(template.find('#pre-optimization-content'));
    new Popup(template, POPUP_TYPE.OK, '优化前后对比', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
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
