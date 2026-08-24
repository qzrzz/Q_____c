import { fd2image_by_fft_v6 } from "../../src/core/image2fd_by_fft-v6"
import { fd2image_by_fft_v7 } from "../../src/core/image2fd_by_fft-v7"
import { fd2image_by_fft_v8 } from "../../src/core/image2fd_by_fft-v8"
import { getImageQcRects, type ImageQcRect } from "../../src/helper/getImageQcRects"
import { isSiteEnabled, loadSettings, type ExtensionSettings } from "./shared/settings"

interface ImageState {
    sourceUrl: string
    processing: boolean
    detected: boolean
    decoded: boolean
    isInViewport: boolean
    outputUrl?: string
    rects: ImageQcRect[]
    button?: HTMLButtonElement
}

interface DownloadImageResult {
    ok: boolean
    base64?: string
    contentType?: string
    error?: string
}

const states = new WeakMap<HTMLImageElement, ImageState>()
const observedImages = new Set<HTMLImageElement>()
const imageViewportStates = new WeakMap<HTMLImageElement, boolean>()
let settings: ExtensionSettings
const DEBUG_PREFIX = "[Q_____c]"

// IntersectionObserver 能感知普通页面和内部滚动容器的裁剪范围，避免固定按钮遗留在屏幕上。
const imageVisibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        const image = entry.target as HTMLImageElement
        const isInViewport = entry.isIntersecting && entry.intersectionRatio > 0
        imageViewportStates.set(image, isInViewport)
        const state = states.get(image)
        if (!state) continue
        state.isInViewport = isInViewport
        if (state.button) placeButton(image, state.button)
    }
})

/** 在网页控制台输出图片识别与解码诊断信息。 @param message 诊断说明 @param details 附加诊断数据 */
function debug(message: string, details?: unknown) {
    if (details === undefined) console.info(`${DEBUG_PREFIX} ${message}`)
    else console.info(`${DEBUG_PREFIX} ${message}`, details)
}

/** 向页面注入与宿主样式隔离的解码按钮样式。 */
function installStyles() {
    const style = document.createElement("style")
    style.textContent = `
        .q_____c-decoder-button {
            position: fixed !important; z-index: 2147483647 !important;
            width: 36px !important; height: 36px !important; padding: 0 !important;
            display: grid !important; place-items: center !important;
            border: 0 !important; border-radius: 5px !important;
            background: #202124 !important; color: #fff !important;
            box-shadow: 0 2px 10px rgb(0 0 0 / 35%) !important;
            cursor: pointer !important;
        }
        .q_____c-decoder-button:hover { background: #3c4043 !important; }
        .q_____c-decoder-button:disabled { cursor: wait !important; opacity: .8 !important; }
        .q_____c-decoder-button img { width: 22px !important; height: 22px !important; object-fit: contain !important; pointer-events: none !important; }
        .q_____c-decoder-button .q_____c-decoder-spinner { width: 19px !important; height: 19px !important; animation: q_____c-decoder-spin .75s linear infinite !important; fill: none !important; stroke: currentColor !important; stroke-linecap: round !important; stroke-width: 2.5 !important; }
        @keyframes q_____c-decoder-spin { to { transform: rotate(360deg); } }
    `
    document.documentElement.append(style)
}

/** 判断当前页面是否应该处理图片。 */
function isEnabled() {
    return isSiteEnabled(settings, location.hostname)
}

/** 获取图片当前加载的实际地址。 @param image 网页中的图片元素 */
function getImageUrl(image: HTMLImageElement): string {
    return image.currentSrc || image.src
}

/** 判断图片地址是否明显指向矢量图或其他不可读取的资源。 @param url 图片地址 */
function isUnsupportedImageUrl(url: string): boolean {
    return /\.svg(?:[?#]|$)/i.test(url)
}

/** 将后台传回的 Base64 图片恢复为浏览器可解码的 Blob。 @param base64 图片 Base64 数据 @param contentType 图片 MIME 类型 */
function base64ToBlob(base64: string, contentType: string): Blob {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: contentType || "application/octet-stream" })
}

/** 删除图片关联的按钮，并释放已替换图片的临时地址。 @param state 图片处理状态 */
function disposeState(state: ImageState) {
    state.button?.remove()
    state.button = undefined
    if (state.outputUrl) URL.revokeObjectURL(state.outputUrl)
}

/** 通过扩展后台下载跨域图片，并保留网页来源以通过图床的防盗链校验。 @param url 图片地址 */
async function downloadImage(url: string): Promise<Blob> {
    debug("请求后台读取图片", { url })
    const result = await new Promise<DownloadImageResult>((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: "q_____c-download-image", url, pageUrl: location.href },
            (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message || "后台图片请求失败"))
                return
            }
            resolve(response as DownloadImageResult)
            }
        )
    })
    if (!result.ok || !result.base64) throw new Error(result.error || "后台图片请求失败")
    const blob = base64ToBlob(result.base64, result.contentType || "")
    debug("后台图片读取成功", { url, bytes: blob.size, contentType: blob.type })
    return blob
}

/** 把网页图片读取为可供识别算法使用的像素数据。 @param image 网页中的图片元素 */
async function readImageData(image: HTMLImageElement): Promise<ImageData> {
    const url = getImageUrl(image)
    let bitmap: ImageBitmap | null = null
    if (url.startsWith("data:") || url.startsWith("blob:")) {
        const canvas = document.createElement("canvas")
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext("2d", { willReadFrequently: true })!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, canvas.width, canvas.height)
    }

    bitmap = await createImageBitmap(await downloadImage(url))
    try {
        const canvas = document.createElement("canvas")
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext("2d", { willReadFrequently: true })!
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, canvas.width, canvas.height)
    } finally {
        bitmap.close()
    }
}

/** 根据设置选择算法，恢复一个被识别出的频域区域。 @param image 频域区域 @param rect 区域在整图中的位置 */
async function decodeRect(image: ImageData, rect: ImageQcRect): Promise<ImageData> {
    if (settings.algorithm === "v6") {
        const result = await fd2image_by_fft_v6(image)
        return new ImageData(new Uint8ClampedArray(result.data), result.width, result.height)
    }
    if (settings.algorithm === "v7") {
        const result = await fd2image_by_fft_v7(image, { carrierX: rect.x, carrierY: rect.y })
        return new ImageData(new Uint8ClampedArray(result.data), result.width, result.height)
    }
    const result = await fd2image_by_fft_v8(image, settings.password, {
        carrierX: rect.x,
        carrierY: rect.y,
    })
    return new ImageData(new Uint8ClampedArray(result.data), result.width, result.height)
}

/** 将已解码像素编码为 PNG，并替换原网页图片。 @param image 原图片元素 @param source 原始像素 @param rects 已识别区域 @param state 图片处理状态 */
async function replaceDecodedImage(
    image: HTMLImageElement,
    source: ImageData,
    rects: ImageQcRect[],
    state: ImageState
) {
    const canvas = document.createElement("canvas")
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext("2d")!
    context.putImageData(source, 0, 0)
    for (const rect of rects) {
        const carrier = context.getImageData(rect.x, rect.y, rect.width, rect.height)
        const decoded = await decodeRect(carrier, rect)
        context.putImageData(decoded, rect.x, rect.y)
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("无法生成 PNG"))), "image/png")
    )
    if (state.outputUrl) URL.revokeObjectURL(state.outputUrl)
    state.outputUrl = URL.createObjectURL(blob)
    image.srcset = ""
    image.src = state.outputUrl
    image.dataset.qcDecoderDecoded = "true"
}

/** 按图片位置更新悬浮解码按钮。 @param image 目标图片 @param button 与图片关联的按钮 */
function placeButton(image: HTMLImageElement, button: HTMLButtonElement) {
    const bounds = image.getBoundingClientRect()
    const visible =
        states.get(image)?.isInViewport !== false &&
        bounds.width >= 24 &&
        bounds.height >= 24 &&
        bounds.right > 0 &&
        bounds.left < innerWidth &&
        bounds.bottom > 0 &&
        bounds.top < innerHeight
    button.hidden = !visible
    if (!visible) return
    button.style.left = `${Math.max(4, Math.min(innerWidth - button.offsetWidth - 4, bounds.right - button.offsetWidth - 6))}px`
    button.style.top = `${Math.max(4, Math.min(innerHeight - button.offsetHeight - 4, bounds.bottom - button.offsetHeight - 6))}px`
}

/** 创建或更新图片上的手动解码按钮。 @param image 目标图片 @param state 图片处理状态 */
function showDecodeButton(image: HTMLImageElement, state: ImageState) {
    if (!state.button) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "q_____c-decoder-button"
        button.addEventListener("click", () => void decodeImage(image, state))
        document.documentElement.append(button)
        state.button = button
    }
    state.button.classList.remove("is-loading")
    state.button.innerHTML = `<img src="${chrome.runtime.getURL("icon-pix.png")}" alt="" />`
    state.button.ariaLabel = `解码图片中的 ${state.rects.length} 个识别区域`
    state.button.title = `解码图片中的 ${state.rects.length} 个识别区域`
    placeButton(image, state.button)
    debug("已显示解码按钮", { url: state.sourceUrl, rects: state.rects })
}

/** 执行识别；在自动模式下立即恢复，在手动模式下显示按钮。 @param image 网页图片 */
async function inspectImage(image: HTMLImageElement) {
    if (!isEnabled() || image.dataset.qcDecoderDecoded === "true") return
    const sourceUrl = getImageUrl(image)
    if (!sourceUrl || !image.complete || !image.naturalWidth || !image.naturalHeight) return
    if (isUnsupportedImageUrl(sourceUrl)) return
    // 仅处理足够大的原图，排除头像、导航图标和缩略图，避免无意义的网络与识别开销。
    if (image.naturalWidth <= 300 || image.naturalHeight <= 300) return
    let state = states.get(image)
    if (state?.outputUrl === sourceUrl) return
    if (!state || state.sourceUrl !== sourceUrl) {
        if (state) disposeState(state)
        state = {
            sourceUrl,
            processing: false,
            detected: false,
            decoded: false,
            isInViewport: imageViewportStates.get(image) ?? true,
            rects: [],
        }
        states.set(image, state)
    }
    if (state.processing || state.decoded) return
    if (state.detected) {
        if (settings.decodeMode === "auto") await decodeImage(image, state)
        else showDecodeButton(image, state)
        return
    }
    state.processing = true
    debug("开始识别图片", {
        url: sourceUrl,
        naturalSize: `${image.naturalWidth} × ${image.naturalHeight}`,
        renderedSize: `${Math.round(image.getBoundingClientRect().width)} × ${Math.round(image.getBoundingClientRect().height)}`,
        decodeMode: settings.decodeMode,
        algorithm: settings.algorithm,
    })
    try {
        const source = await readImageData(image)
        // 过大的图片会显著阻塞页面；用户仍可在编辑器中处理原图。
        if (source.width * source.height > 24_000_000) {
            debug("跳过超大图片", { url: sourceUrl, width: source.width, height: source.height })
            return
        }
        state.rects = getImageQcRects(source)
        state.detected = true
        debug("图片识别完成", { url: sourceUrl, rectCount: state.rects.length, rects: state.rects })
        if (!state.rects.length) return
        if (settings.decodeMode === "auto") {
            // 识别阶段已结束，释放占用标记后才能进入同一图片的解码流程。
            state.processing = false
            debug("自动解码已触发", { url: sourceUrl })
            await decodeImage(image, state, source)
        }
        else showDecodeButton(image, state)
    } catch (error) {
        debug("图片识别失败", {
            url: sourceUrl,
            error: error instanceof Error ? error.message : String(error),
        })
    } finally {
        state.processing = false
    }
}

/** 解码并替换一张网页图片。 @param image 目标图片 @param state 图片处理状态 @param cachedSource 已读取的原始像素 */
async function decodeImage(image: HTMLImageElement, state: ImageState, cachedSource?: ImageData) {
    if (!isEnabled() || state.processing || state.decoded) return
    state.processing = true
    if (state.button) {
        state.button.disabled = true
        state.button.classList.add("is-loading")
        state.button.innerHTML = `<svg class="q_____c-decoder-spinner" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.35-5.65"></path></svg>`
        state.button.ariaLabel = "正在解码图片"
    }
    try {
        const source = cachedSource ?? await readImageData(image)
        await replaceDecodedImage(image, source, state.rects, state)
        state.decoded = true
        state.button?.remove()
        state.button = undefined
        debug("图片解码并替换成功", { url: state.sourceUrl, rectCount: state.rects.length })
    } catch (error) {
        debug("图片解码失败", {
            url: state.sourceUrl,
            error: error instanceof Error ? error.message : String(error),
        })
        if (state.button) {
            state.button.disabled = false
            state.button.classList.remove("is-loading")
            state.button.innerHTML = `<img src="${chrome.runtime.getURL("icon-pix.png")}" alt="" />`
            state.button.ariaLabel = "解码失败，点击重试"
            state.button.title = "解码失败，点击重试"
        }
    } finally {
        state.processing = false
    }
}

/** 观察图片加载与页面动态插入，并安排识别。 @param image 网页图片 */
function observeImage(image: HTMLImageElement) {
    if (observedImages.has(image)) return
    observedImages.add(image)
    imageVisibilityObserver.observe(image)
    image.addEventListener("load", () => void inspectImage(image))
    if (image.complete) void inspectImage(image)
}

/** 扫描当前文档的所有图片。 */
function scanImages() {
    document.querySelectorAll<HTMLImageElement>("img").forEach(observeImage)
}

/** 移除按钮并按新设置重新扫描页面。 */
function refreshPage() {
    for (const image of observedImages) {
        const state = states.get(image)
        if (!isEnabled()) state?.button?.remove()
        else void inspectImage(image)
    }
}

installStyles()
void loadSettings().then((loaded) => {
    settings = loaded
    debug("扩展已启用", {
        hostname: location.hostname,
        siteMode: settings.siteMode,
        decodeMode: settings.decodeMode,
        algorithm: settings.algorithm,
        enabled: isEnabled(),
    })
    scanImages()
    new MutationObserver(scanImages).observe(document.documentElement, { childList: true, subtree: true })
})

chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== "sync") return
    void loadSettings().then((loaded) => {
        settings = loaded
        debug("设置已更新", { siteMode: settings.siteMode, decodeMode: settings.decodeMode, enabled: isEnabled() })
        refreshPage()
    })
})

addEventListener("scroll", () => {
    for (const image of observedImages) {
        const button = states.get(image)?.button
        if (button) placeButton(image, button)
    }
}, { capture: true, passive: true })
addEventListener("resize", () => {
    for (const image of observedImages) {
        const button = states.get(image)?.button
        if (button) placeButton(image, button)
    }
})
