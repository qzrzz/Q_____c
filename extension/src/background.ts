interface DownloadImageMessage {
    type: "q_____c-download-image"
    url: string
    pageUrl: string
}

interface DownloadImageResult {
    ok: boolean
    buffer?: ArrayBuffer
    error?: string
}

const PIXIV_REFERRER_RULE_ID = 20_001

/**
 * 为本扩展请求的 Pixiv 图床资源补齐防盗链来源。
 * 规则仅匹配扩展自身的后台 fetch，不影响 Pixiv 页面与其他扩展的网络请求。
 */
const pixivRequestRuleReady = chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [PIXIV_REFERRER_RULE_ID],
    addRules: [
        {
            id: PIXIV_REFERRER_RULE_ID,
            priority: 1,
            action: {
                type: "modifyHeaders",
                requestHeaders: [
                    { header: "referer", operation: "set", value: "https://www.pixiv.net/" },
                ],
            },
            condition: {
                requestDomains: ["i.pximg.net", "source.pixiv.net"],
                initiatorDomains: [chrome.runtime.id],
                resourceTypes: ["xmlhttprequest"],
            },
        },
    ],
})

/** 判断消息是否为请求后台下载图片的合法消息。 @param message 扩展运行时消息 */
function isDownloadImageMessage(message: unknown): message is DownloadImageMessage {
    if (!message || typeof message !== "object") return false
    const candidate = message as Partial<DownloadImageMessage>
    return (
        candidate.type === "q_____c-download-image" &&
        typeof candidate.url === "string" &&
        typeof candidate.pageUrl === "string"
    )
}

/** 通过扩展后台下载位图，保留站点防盗链校验需要的来源与登录态。 @param url 图片地址 @param pageUrl 发起请求的网页地址 */
async function downloadImage(url: string, pageUrl: string): Promise<DownloadImageResult> {
    try {
        const parsed = new URL(url)
        if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: "不支持的图片地址" }
        const page = new URL(pageUrl)
        const canSendReferrer = /^https?:$/.test(page.protocol)
        const requestOptions: RequestInit = {
            credentials: "include",
            referrerPolicy: "strict-origin-when-cross-origin",
        }
        // Pixiv 等图床会验证来源；后台请求需显式保留当前网页的来源信息。
        if (canSendReferrer) requestOptions.referrer = page.href
        const response = await fetch(parsed, requestOptions)
        if (!response.ok) return { ok: false, error: `图片请求失败（${response.status}）` }
        const contentType = response.headers.get("content-type") || ""
        if (contentType.includes("image/svg+xml")) return { ok: false, error: "SVG 不是可解码位图" }
        return { ok: true, buffer: await response.arrayBuffer() }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "图片请求失败" }
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isDownloadImageMessage(message)) return
    void pixivRequestRuleReady
        .catch(() => {
            // 不支持动态请求规则的浏览器仍使用标准后台下载路径。
        })
        .then(() => downloadImage(message.url, message.pageUrl))
        .then(sendResponse)
    return true
})
