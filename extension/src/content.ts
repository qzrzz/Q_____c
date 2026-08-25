import { fd2image_by_fft_v6 } from "../../src/core/image2fd_by_fft-v6"
import { fd2image_by_fft_v7 } from "../../src/core/image2fd_by_fft-v7"
import { fd2image_by_fft_v8 } from "../../src/core/image2fd_by_fft-v8"
import { fd2image_by_fft_v8c } from "../../src/core/image2fd_by_fft-v8c"
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
let manualRunActive = false
let decoderButtonLayer: HTMLDivElement
let placementFrame = 0
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
        if (state.button) scheduleButtonPlacement()
    }
})

// 图片的 CSS 尺寸变化不一定会触发 window.resize；单独观察以保证按钮始终与图片同一位置。
const imageResizeObserver = new ResizeObserver(() => scheduleButtonPlacement())

/** 在网页控制台输出图片识别与解码诊断信息。 @param message 诊断说明 @param details 附加诊断数据 */
function debug(message: string, details?: unknown) {
    if (details === undefined) console.info(`${DEBUG_PREFIX} ${message}`)
    else console.info(`${DEBUG_PREFIX} ${message}`, details)
}

/** 向页面注入与宿主样式隔离的解码按钮样式。 */
function installStyles() {
    // 扩展重新加载时页面 DOM 不一定会刷新，先清理由上一实例遗留的悬浮按钮，避免重复显示。
    document.querySelectorAll<HTMLButtonElement>(".q_____c-decoder-button").forEach((button) => button.remove())
    document.getElementById("q_____c-decoder-button-layer")?.remove()
    decoderButtonLayer = document.createElement("div")
    decoderButtonLayer.id = "q_____c-decoder-button-layer"
    document.body.append(decoderButtonLayer)
    const style = document.createElement("style")
    style.textContent = `
        #q_____c-decoder-button-layer {
            position: fixed !important; inset: 0 !important;
            z-index: 2147483647 !important; pointer-events: none !important;
        }
        .q_____c-decoder-button {
            position: fixed !important; z-index: 2147483647 !important;
            width: 36px !important; height: 36px !important; padding: 0 !important;
            display: grid !important; place-items: center !important;
            border: 2px solid #e12d2d !important; border-radius: 0 !important;
            background: #171313 !important; color: #fff3f1 !important;
            box-shadow: 3px 3px 0 #0c0a0a !important;
            cursor: pointer !important;
            image-rendering: pixelated !important;
            transition: transform .08s, box-shadow .08s, background .08s, border-color .08s !important;
            pointer-events: auto !important;
        }
        .q_____c-decoder-button[hidden] { display: none !important; }
        .q_____c-decoder-button:hover {
            background: #2b1010 !important;
            border-color: #ff4a3d !important;
            transform: translate(-1px, -1px) !important;
            box-shadow: 4px 4px 0 #0c0a0a !important;
        }
        .q_____c-decoder-button:active {
            transform: translate(1px, 1px) !important;
            box-shadow: 1px 1px 0 #0c0a0a !important;
        }
        .q_____c-decoder-button:disabled {
            cursor: wait !important;
            opacity: .9 !important;
            background: #0c0a0a !important;
            border-color: #7a2424 !important;
        }
        .q_____c-decoder-button img {
            width: 22px !important; height: 22px !important;
            object-fit: contain !important;
            pointer-events: none !important;
            image-rendering: pixelated !important;
            filter: drop-shadow(1px 1px 0 #5b1414) !important;
        }
        .q_____c-decoder-button .q_____c-decoder-spinner {
            width: 18px !important; height: 18px !important;
            animation: q_____c-decoder-spin .7s steps(4, end) infinite !important;
            fill: none !important;
            stroke: #ff4a3d !important;
            stroke-linecap: square !important;
            stroke-linejoin: miter !important;
            stroke-width: 2.5 !important;
        }
        @keyframes q_____c-decoder-spin { to { transform: rotate(360deg); } }
    `
    document.documentElement.append(style)
}

/** 判断当前页面是否应该处理图片。 */
function isEnabled() {
    return manualRunActive || isSiteEnabled(settings, location.hostname)
}

/** 获取当前页面实际使用的解码方式；手动运行始终先展示确认按钮。 */
function getDecodeMode() {
    return manualRunActive ? "button" : settings.decodeMode
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

/** 回收已被动态网页移除的图片及其悬浮按钮。 */
function disposeDetachedImages() {
    for (const image of observedImages) {
        if (image.isConnected) continue
        imageVisibilityObserver.unobserve(image)
        imageResizeObserver.unobserve(image)
        const state = states.get(image)
        if (state) disposeState(state)
        observedImages.delete(image)
    }
}

/** 删除不再属于当前图片状态的遗留按钮，避免虚拟列表重建图片时按钮累积。 */
function disposeOrphanedButtons() {
    const activeButtons = new Set<HTMLButtonElement>()
    for (const image of observedImages) {
        const button = states.get(image)?.button
        if (button) activeButtons.add(button)
    }
    decoderButtonLayer.querySelectorAll<HTMLButtonElement>(".q_____c-decoder-button").forEach((button) => {
        if (!activeButtons.has(button)) button.remove()
    })
}

/** 在下一帧统一刷新所有悬浮按钮的位置与可见性，避免滚动期间产生不同步状态。 */
function scheduleButtonPlacement() {
    if (placementFrame) return
    placementFrame = requestAnimationFrame(() => {
        placementFrame = 0
        disposeDetachedImages()
        disposeOrphanedButtons()
        for (const image of observedImages) {
            const button = states.get(image)?.button
            if (button) placeButton(image, button)
        }
    })
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
    if (settings.algorithm === "v8c") {
        const result = await fd2image_by_fft_v8c(image, settings.password, {
            carrierX: rect.x,
            carrierY: rect.y,
        })
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
        image.isConnected &&
        states.get(image)?.isInViewport !== false &&
        image.getClientRects().length > 0 &&
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
    if (state.button && !state.button.isConnected) state.button = undefined
    if (!state.button) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "q_____c-decoder-button"
        button.addEventListener("click", () => void decodeImage(image, state))
        decoderButtonLayer.append(button)
        state.button = button
    }
    state.button.classList.remove("is-loading")
    state.button.innerHTML = `<img src="${chrome.runtime.getURL("icon-pix.png")}" alt="" />`
    state.button.ariaLabel = `解码图片中的 ${state.rects.length} 个识别区域`
    state.button.title = `解码图片中的 ${state.rects.length} 个识别区域`
    scheduleButtonPlacement()
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
        if (getDecodeMode() === "auto") await decodeImage(image, state)
        else showDecodeButton(image, state)
        return
    }
    state.processing = true
    debug("开始识别图片", {
        url: sourceUrl,
        naturalSize: `${image.naturalWidth} × ${image.naturalHeight}`,
        renderedSize: `${Math.round(image.getBoundingClientRect().width)} × ${Math.round(image.getBoundingClientRect().height)}`,
        decodeMode: getDecodeMode(),
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
        if (getDecodeMode() === "auto") {
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
    imageResizeObserver.observe(image)
    image.addEventListener("load", () => void inspectImage(image))
    if (image.complete) void inspectImage(image)
}

/** 扫描当前文档的所有图片。 */
function scanImages() {
    const images = [...document.querySelectorAll<HTMLImageElement>("img")]
    images.forEach(observeImage)
    return images
}

/** 启动一次仅限当前页面生命周期的手动扫描。 */
function runCurrentPage() {
    manualRunActive = true
    const images = scanImages()
    // 图片可能在扩展初始加载时已被观察，但因网站规则未命中而未进入识别；手动运行需再次触发。
    images.forEach((image) => void inspectImage(image))
    const eligibleImageCount = images.filter(
        (image) => image.naturalWidth > 300 && image.naturalHeight > 300
    ).length
    debug("已收到当前页面手动扫描请求", {
        imageCount: images.length,
        eligibleImageCount,
        decodeMode: getDecodeMode(),
    })
    return { imageCount: images.length, eligibleImageCount }
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
    new MutationObserver(() => {
        disposeDetachedImages()
        disposeOrphanedButtons()
        scanImages()
        scheduleButtonPlacement()
    }).observe(document.documentElement, { childList: true, subtree: true })
})

chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName !== "sync") return
    void loadSettings().then((loaded) => {
        settings = loaded
        debug("设置已更新", { siteMode: settings.siteMode, decodeMode: settings.decodeMode, enabled: isEnabled() })
        refreshPage()
    })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "q_____c-run-current-page") return
    try {
        const result = runCurrentPage()
        sendResponse({ ok: true, ...result })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        debug("当前页面手动扫描启动失败", { error: message })
        sendResponse({ ok: false, error: message })
    }
})

addEventListener("scroll", scheduleButtonPlacement, { capture: true, passive: true })
addEventListener("resize", scheduleButtonPlacement)
visualViewport?.addEventListener("scroll", scheduleButtonPlacement, { passive: true })
visualViewport?.addEventListener("resize", scheduleButtonPlacement, { passive: true })
