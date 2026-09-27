import { getRequestHeaders } from '/script.js';
import { getApiKey, getSettings } from './settings.js';
import { extractModelIds, normalizeOpenAIBaseUrl } from './utils.js';

const GENERATE_URL = '/api/backends/chat-completions/generate';
const MODELS_URL = '/api/backends/chat-completions/status';

export function generateRandomSeed() {
    return `[优化种子: ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}]`;
}

function numberSetting(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

async function request(path, body, signal) {
    const timeoutSeconds = numberSetting(getSettings().requestTimeoutSeconds, 120, 5, 600);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });

    const timeout = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeoutSeconds * 1000);
    try {
        const response = await fetch(path, {
            method: 'POST',
            headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 300).replace(/\s+/g, ' ');
            throw new Error(`请求失败 (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}

function getConnection(requireModel = true) {
    const settings = getSettings();
    const reverseProxy = normalizeOpenAIBaseUrl(settings.apiUrl);
    const model = String(settings.model ?? '').trim();
    if (!reverseProxy) throw new Error('请填写 OpenAI 兼容 API 地址。');
    if (requireModel && !model) throw new Error('请填写模型名称。');
    return {
        reverseProxy,
        apiKey: getApiKey(),
        model,
        maxTokens: numberSetting(settings.maxTokens, 4096, 1, 1_000_000),
        temperature: numberSetting(settings.temperature, 1, 0, 2),
    };
}

export async function callAI(messages, { signal } = {}) {
    const connection = getConnection();
    const data = await request(GENERATE_URL, {
        chat_completion_source: 'openai',
        reverse_proxy: connection.reverseProxy,
        proxy_password: connection.apiKey,
        model: connection.model,
        messages,
        max_tokens: connection.maxTokens,
        temperature: connection.temperature,
        stream: false,
    }, signal);
    if (data?.error) {
        throw new Error(`API 请求失败：${data.error?.message || String(data.error)}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('API 响应中没有可用的文本内容。');
    }
    return content.trim();
}

export async function fetchModels() {
    const connection = getConnection(false);
    const data = await request(MODELS_URL, {
        chat_completion_source: 'openai',
        reverse_proxy: normalizeOpenAIBaseUrl(getSettings().apiUrl),
        proxy_password: connection.apiKey,
    });
    return extractModelIds(data);
}

export async function testApiConnection() {
    try {
        const reply = await callAI([{ role: 'user', content: '请只回复：连接成功' }]);
        return { ok: true, message: `连接成功：${reply.slice(0, 60)}` };
    } catch (error) {
        return { ok: false, message: error?.message || String(error) };
    }
}
