function findLastTagIndices(text, tagName) {
    const source = String(text ?? '');
    const closeTag = `</${tagName}>`;
    const contentEnd = source.lastIndexOf(closeTag);
    if (contentEnd === -1) return null;

    const openPrefix = `<${tagName}`;
    let blockStart = source.lastIndexOf(openPrefix, contentEnd);
    while (blockStart !== -1) {
        const next = source[blockStart + openPrefix.length];
        if (next === '>' || /\s/.test(next)) break;
        blockStart = source.lastIndexOf(openPrefix, blockStart - 1);
    }
    if (blockStart === -1) return null;

    const openEnd = source.indexOf('>', blockStart);
    if (openEnd === -1 || openEnd > contentEnd) return null;
    return {
        contentStart: openEnd + 1,
        contentEnd,
    };
}

export function isValidTagName(tagName) {
    return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(String(tagName ?? ''));
}

export function isOptimizableMessage(message) {
    return Boolean(message
        && !message.is_user
        && !message.is_system
        && typeof message.mes === 'string'
        && message.mes.trim());
}

export function normalizeOpenAIBaseUrl(url) {
    return String(url ?? '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

export function extractModelIds(payload) {
    if (payload?.error === true) {
        throw new Error('模型列表接口不可用；请确认 API 支持 /models，或直接手动填写模型 ID。');
    }
    const models = [payload, payload?.data, payload?.models, payload?.data?.data, payload?.data?.models]
        .find(Array.isArray);
    if (!models) throw new Error('模型列表响应格式不受支持。');
    const ids = models
        .map(item => String(item?.id ?? item?.name ?? item?.model ?? item).trim())
        .filter(Boolean);
    if (!ids.length) throw new Error('接口没有返回任何模型；可直接手动填写模型 ID。');
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function extractOpenAIText(payload) {
    const content = payload?.choices?.[0]?.delta?.content ?? payload?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
}

export function parseOpenAISseLine(line) {
    const value = String(line ?? '').trim();
    if (!value.startsWith('data:')) return '';
    const data = value.slice(5).trim();
    if (!data || data === '[DONE]') return '';
    const payload = JSON.parse(data);
    if (payload?.error) throw new Error(`API 请求失败：${payload.error?.message || String(payload.error)}`);
    return extractOpenAIText(payload);
}

export function extractContentByTag(text, tagName) {
    const indices = findLastTagIndices(text, tagName);
    return indices ? String(text).slice(indices.contentStart, indices.contentEnd) : null;
}

export function replaceContentByTag(text, tagName, newContent) {
    const source = String(text ?? '');
    const indices = findLastTagIndices(source, tagName);
    if (!indices) return source;
    return `${source.slice(0, indices.contentStart)}${newContent}${source.slice(indices.contentEnd)}`;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findPairedTagNames(text) {
    const source = String(text ?? '');
    const opened = new Map();
    for (const match of source.matchAll(/<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*?)?>/g)) {
        if (!/\/\s*>$/.test(match[0]) && !opened.has(match[1])) opened.set(match[1], match.index);
    }
    const paired = new Set();
    for (const match of source.matchAll(/<\/([A-Za-z_][A-Za-z0-9_.:-]*)\s*>/g)) {
        if ((opened.get(match[1]) ?? Infinity) < match.index) paired.add(match[1]);
    }
    return [...paired].sort((a, b) => a.localeCompare(b));
}

export function maskExcludedTags(text, tags, nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`) {
    let masked = String(text ?? '');
    const replacements = [];
    for (const tag of Array.isArray(tags) ? tags : []) {
        if (!isValidTagName(tag)) continue;
        const name = escapeRegex(tag);
        const pattern = new RegExp(`<${name}(?:\\s[^<>]*?)?>[\\s\\S]*?<\\/${name}\\s*>`, 'g');
        masked = masked.replace(pattern, value => {
            let token = `__BODY_OPT_EXCLUDED_${nonce}_${replacements.length}__`;
            while (masked.includes(token)) token += '_';
            replacements.push({ token, value });
            return token;
        });
    }
    return { text: masked, replacements };
}

export function restoreExclusions(text, replacements) {
    let restored = String(text ?? '');
    for (const { token, value } of [...(replacements ?? [])].reverse()) {
        if (restored.split(token).length !== 2) {
            throw new Error('模型改动了排除内容占位符，本次结果已丢弃，原消息未修改。');
        }
        restored = restored.replace(token, value);
    }
    return restored;
}
