export type SiteMode = "listed" | "all" | "disabled"
export type DecodeMode = "button" | "auto"
export type AlgorithmId = "v6" | "v7" | "v8"

export interface ExtensionSettings {
    siteMode: SiteMode
    sites: string[]
    decodeMode: DecodeMode
    algorithm: AlgorithmId
    password: string
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
    siteMode: "listed",
    sites: [],
    decodeMode: "button",
    algorithm: "v8",
    password: "qzrzz",
}

/** 将输入的网址或域名规范化为可匹配的主机名。 @param value 用户输入的网站 */
export function normalizeSiteHost(value: string): string | null {
    const candidate = value.trim().toLowerCase()
    if (!candidate) return null
    try {
        const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`)
        return url.hostname.replace(/^\*\./, "").replace(/\.$/, "") || null
    } catch {
        return null
    }
}

/** 将多行网站列表转换为唯一、有效的域名集合。 @param value 用户输入的多行文本 */
export function parseSiteList(value: string): string[] {
    return [...new Set(value.split(/\r?\n|,/).map(normalizeSiteHost).filter((host): host is string => Boolean(host)))]
}

/** 判断当前主机是否应启用扩展。 @param settings 已保存的扩展设置 @param hostname 当前网页主机名 */
export function isSiteEnabled(settings: ExtensionSettings, hostname: string): boolean {
    if (settings.siteMode === "disabled") return false
    if (settings.siteMode === "all") return true
    const current = hostname.toLowerCase().replace(/\.$/, "")
    return settings.sites.some((site) => current === site || current.endsWith(`.${site}`))
}

/** 读取同步存储，并为缺失或异常字段回填安全默认值。 */
export async function loadSettings(): Promise<ExtensionSettings> {
    const stored = await new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.sync.get(null, resolve)
    })
    return {
        siteMode: ["listed", "all", "disabled"].includes(String(stored.siteMode))
            ? (stored.siteMode as SiteMode)
            : DEFAULT_SETTINGS.siteMode,
        sites: Array.isArray(stored.sites)
            ? stored.sites.map(String).map(normalizeSiteHost).filter((site): site is string => Boolean(site))
            : DEFAULT_SETTINGS.sites,
        decodeMode: ["button", "auto"].includes(String(stored.decodeMode))
            ? (stored.decodeMode as DecodeMode)
            : DEFAULT_SETTINGS.decodeMode,
        algorithm: ["v6", "v7", "v8"].includes(String(stored.algorithm))
            ? (stored.algorithm as AlgorithmId)
            : DEFAULT_SETTINGS.algorithm,
        password: typeof stored.password === "string" ? stored.password : DEFAULT_SETTINGS.password,
    }
}

/** 保存设置到浏览器同步存储。 @param settings 要保存的设置 */
export async function saveSettings(settings: ExtensionSettings): Promise<void> {
    await new Promise<void>((resolve) => chrome.storage.sync.set(settings, resolve))
}
