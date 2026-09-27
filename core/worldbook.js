import { getContext } from '/scripts/extensions.js';
import { world_info, world_names, loadWorldInfo } from '/scripts/world-info.js';
import { getSettings } from './settings.js';

function getCharLorebookNames() {
    const context = getContext();
    const character = context.characters?.[context.characterId];
    if (!character) return [];
    const primary = character.data?.extensions?.world;
    const fileName = String(character.avatar ?? '').replace(/\.[^.]+$/, '');
    const additional = world_info.charLore?.find(item => item.name === fileName)?.extraBooks ?? [];
    return [...new Set([primary, ...additional].filter(Boolean))];
}

async function getLorebookEntries(bookName) {
    try {
        const bookData = await loadWorldInfo(bookName);
        if (!bookData || !bookData.entries) return [];
        return Object.values(bookData.entries).map(entry => ({
            disable: Boolean(entry.disable),
            content: entry.content ?? '',
        }));
    } catch (error) {
        console.error(`[正文优化] 读取世界书《${bookName}》失败:`, error);
        return [];
    }
}

/**
 * 汇总优化任务要参考的世界书内容。
 * - 来源 character：当前角色的主/附加世界书
 * - 来源 manual：面板手动勾选的世界书
 * 注入所选世界书中的全部启用条目。
 */
export async function getOptimizationWorldbookContent() {
    const settings = getSettings();
    if (!settings || !settings.modal_wbEnabled) return '';

    try {
        let bookNames = [];
        if (settings.modal_wbSource === 'manual') {
            bookNames = settings.modal_amily2_wb_selected_worldbooks || [];
        } else {
            bookNames = getCharLorebookNames();
        }

        if (bookNames.length === 0) {
            console.log('[正文优化] 未选择或未挂载任何世界书，跳过世界书参考。');
            return '';
        }

        let allEntries = [];
        for (const bookName of bookNames) {
            if (bookName) {
                const entries = await getLorebookEntries(bookName);
                if (entries?.length) allEntries.push(...entries);
            }
        }

        const enabledEntries = allEntries.filter(entry => !entry.disable);

        if (enabledEntries.length === 0) {
            console.log('[正文优化] 所选世界书中没有可用的启用条目。');
            return '';
        }

        const combinedContent = enabledEntries
            .map(entry => entry.content)
            .filter(Boolean)
            .join('\n\n---\n\n');

        console.log(`[正文优化] 已加载 ${enabledEntries.length} 条世界书条目，总长度: ${combinedContent.length}`);
        return combinedContent;
    } catch (error) {
        console.error('[正文优化] 世界书参考内容处理失败:', error);
        return '';
    }
}

/** 供面板列出全部可选世界书 */
export function listWorldBookNames() {
    try {
        return [...world_names];
    } catch {
        return [];
    }
}
