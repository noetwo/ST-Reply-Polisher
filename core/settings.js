// 设置存取与默认值（提取自 Amily2号助手 utils/settings.js，仅保留正文优化相关键）
import { extension_settings } from '/scripts/extensions.js';
import { defaultExecutionPrompt } from './prompts.js';

const _pathParts = new URL(import.meta.url).pathname.split('/');
const _tpIdx = _pathParts.indexOf('third-party');
export const extensionName = _tpIdx >= 0 ? decodeURIComponent(_pathParts[_tpIdx + 1]) : '正文优化';

const _mainPrompt = '';

const _systemPrompt = `把上一条 assistant 消息中的正文，用下面的文风从头到尾重写。剧情不变，叙述顺序、措辞和台词都可以随意调整。

视角
- 严格保持原文的人称和视角，原文是第三人称就写第三人称。

文风：日式视觉小说／轻小说
- 通俗好读，口语化，像有人在讲故事，不是文学作品。
- 多用视角人物的内心独白串起场景，心里怎么想直接写出来，可以吐槽、嘀咕、嘴硬。
- 能直接交代心理，就不写目光、呼吸、指尖、嘴角之类的侧面反应。
- 少写外貌、环境、神态，交代清楚位置和动作就够了。
- 不要文艺腔、电影感、华丽比喻，不总结、不拔高、不点题。
- 叙述段落长短交替，一段里可以有几句话，不要把全文切成一行一句。
- 去掉"一丝、一抹、一阵、一股"这类多余的量词；只保留对剧情有用的数字，装饰性的数字改成模糊说法或删掉。

对白：重点
- 对白的问题是"像 AI"，不是"太长"。要去掉的是客服腔、论文腔：先总结再回答、讲大道理、分点论证、把情绪和动机解释得条条是道、用"我理解""换句话说""重要的是"这类连接语。
- 真人说话是接着对方往下聊的：会回应对方刚说的具体内容，会顺着话头调侃、追问、抱怨、讨价还价，会多说一句没必要的话。写对白时先想"这个人听到这句会怎么接"，而不是"最少说几个字能把信息传到"。
- 一句台词正常是一到三句话的长度。可以有半句、改口、反问，但不要把回应压成一两个字，除非原文人设就是这种性格。
- 每个人说话要有自己的习惯，按人设区分语气、用词、爱不爱多说。
- 对白用「」，独立成段；说话者明确时不加"他说""她轻声道"。连续对白之间可以夹一两句叙述或心理，不要一长串光秃秃的对白。`;

export const defaultSettings = {
    optimizationEnabled: false,
    applyOptimizedToMessage: true,
    optimizationTargetTag: 'content',
    optimizationExclusionEnabled: false,
    optimizationExcludedTags: [],
    showOptimizationToast: true,
    apiUrl: '',
    apiKey: '',
    model: '',
    maxTokens: 4096,
    temperature: 1.0,
    contextMessages: 2,
    requestTimeoutSeconds: 120,
    mainPrompt: _mainPrompt,
    systemPrompt: _systemPrompt,
    outputFormatPrompt: '',
    executionPrompt: defaultExecutionPrompt,
    modal_wbEnabled: false,
    modal_wbSource: 'character',
    modal_amily2_wb_selected_worldbooks: [],
};

const apiKeySessionKey = `${extensionName}:apiKey`;

export function getApiKey() {
    return String(getSettings().apiKey ?? '').trim();
}

export function getSettings() {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    const settings = extension_settings[extensionName];
    const sessionKey = sessionStorage.getItem(apiKeySessionKey);
    if (settings.apiKey === undefined && sessionKey) settings.apiKey = sessionKey;
    sessionStorage.removeItem(apiKeySessionKey);
    for (const key of Object.keys(defaultSettings)) {
        if (settings[key] === undefined) settings[key] = structuredClone(defaultSettings[key]);
    }
    delete settings.apiProvider;
    delete settings.__migratedFromAmily2;
    delete settings.optimizationExclusionRules;
    return settings;
}

// 提示词默认值，供"恢复默认"按钮使用
export const promptDefaults = {
    mainPrompt: _mainPrompt,
    systemPrompt: _systemPrompt,
    outputFormatPrompt: '',
    executionPrompt: defaultExecutionPrompt,
};
