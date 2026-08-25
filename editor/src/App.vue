<script lang="ts">
import { defineComponent, nextTick } from "vue"
import heic2any from "heic2any"
import {
    fd2image_by_fft,
    image2fd_by_fft,
    scale_fd_by_fft,
    type ImageDataLike,
} from "../../src/core/image2fd_by_fft"
import {
    fd2image_by_fft_v5,
    image2fd_by_fft_v5,
    scale_fd_by_fft_v5,
} from "../../src/core/image2fd_by_fft-v5"
import {
    fd2image_by_fft_v6,
    image2fd_by_fft_v6,
    scale_fd_by_fft_v6,
} from "../../src/core/image2fd_by_fft-v6"
import {
    fd2image_by_fft_v7,
    image2fd_by_fft_v7,
    scale_fd_by_fft_v7,
} from "../../src/core/image2fd_by_fft-v7"
import {
    fd2image_by_fft_v8,
    image2fd_by_fft_v8,
    scale_fd_by_fft_v8,
} from "../../src/core/image2fd_by_fft-v8"
import {
    fd2image_by_fft_v8c,
    image2fd_by_fft_v8c,
    scale_fd_by_fft_v8c,
} from "../../src/core/image2fd_by_fft-v8c"
import { getImageQcRects, type ImageQcRect } from "../../src/helper/getImageQcRects"
import {
    applyLocale,
    getInitialLocale,
    translate,
    type Locale,
    type MessageKey,
} from "./i18n"

interface EditorRect {
    id: number
    x: number
    y: number
    width: number
    height: number
    confidence?: number
}

interface Point {
    x: number
    y: number
}

type ResizeCorner = "northWest" | "northEast" | "southWest" | "southEast"
type PreviewMode = "none" | "scale" | "jpeg" | "jpeg720"
type AlgorithmId = "fft" | "v5" | "v6" | "v7" | "v8" | "v8c"
type PreScaleMode = "none" | "600" | "720" | "900" | "1080" | "custom"

const JPEG_GRID_SIZE = 16
const brandIconUrl = new URL("./assets/icon-pix-128.png", import.meta.url).href
const HEIC_FILE_TYPES = new Set([
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
])

export default defineComponent({
    name: "App",
    data() {
        return {
            brandIconUrl,
            locale: getInitialLocale() as Locale,
            mode: "encode" as "encode" | "decode",
            algorithm: "v8" as AlgorithmId,
            password: "",
            sourceName: "",
            sourceMimeType: "",
            sourceImage: null as HTMLImageElement | null,
            originalImageData: null as ImageData | null,
            sourceImageData: null as ImageData | null,
            sourceUrl: "",
            imageWidth: 0,
            imageHeight: 0,
            preScaleMode: "none" as PreScaleMode,
            customPreScaleSize: 1080,
            rects: [] as EditorRect[],
            history: [] as EditorRect[][],
            future: [] as EditorRect[][],
            drawing: false,
            startPoint: null as Point | null,
            draftRect: null as EditorRect | null,
            rectInteraction: null as "move" | "resize" | null,
            interactionStartPoint: null as Point | null,
            interactionOriginalRect: null as EditorRect | null,
            interactionHistorySnapshot: null as EditorRect[] | null,
            interactionChanged: false,
            resizeCorner: null as ResizeCorner | null,
            resizeCorners: ["northWest", "northEast", "southWest", "southEast"] as ResizeCorner[],
            selectedId: null as number | null,
            nextRectId: 1,
            busy: false,
            maskingBusy: false,
            maskingRevision: 0,
            previewBusy: false,
            previewMode: "none" as PreviewMode,
            previewRevision: 0,
            draggingFile: false,
            importingHeic: false,
            outputUrl: "",
            outputName: "",
            errorMessage: "",
        }
    },
    computed: {
        hasImage(): boolean {
            return Boolean(this.sourceImageData)
        },
        selectedRect(): EditorRect | undefined {
            return this.rects.find((rect) => rect.id === this.selectedId)
        },
        canProcess(): boolean {
            return this.hasImage && this.rects.length > 0 && !this.busy
        },
        statusLabel(): string {
            if (!this.hasImage) return this.t("statusWaiting")
            if (this.mode === "decode")
                return this.t("statusDetected", { count: this.rects.length })
            return this.rects.length
                ? this.t("statusAdded", { count: this.rects.length })
                : this.t("statusDraw")
        },
        preScaleSummary(): string {
            if (!this.originalImageData) return this.t("setWidth")
            const target = this.getPreScaleTarget()
            if (!target) return this.t("keepOriginalSize")
            const originalWidth = this.originalImageData.width
            const originalHeight = this.originalImageData.height
            const size = this.getScaledImageSize(originalWidth, originalHeight, target)
            if (size.width === originalWidth && size.height === originalHeight) {
                return this.t("originalNoScale", {
                    width: originalWidth,
                    height: originalHeight,
                })
            }
            return this.t("outputSize", { width: size.width, height: size.height })
        },
    },
    mounted() {
        applyLocale(this.locale)
        window.addEventListener("keydown", this.onKeyDown)
        window.addEventListener("paste", this.onPaste)
    },
    beforeUnmount() {
        window.removeEventListener("keydown", this.onKeyDown)
        window.removeEventListener("paste", this.onPaste)
        this.releaseUrls()
        this.password = ""
    },
    methods: {
        /**
         * 获取当前语言对应的界面文本。
         * @param key 文本键
         * @param parameters 待写入文本模板的动态参数
         */
        t(key: MessageKey, parameters: Record<string, string | number> = {}) {
            return translate(this.locale, key, parameters)
        },

        /** 在中文与英文界面之间切换，并保存用户选择。 */
        toggleLocale() {
            this.locale = this.locale === "zh-CN" ? "en" : "zh-CN"
            applyLocale(this.locale)
        },

        /**
         * 将编码选区扩展并对齐到 JPEG 4:2:0 的 16x16 MCU 网格。
         * @param rect 待对齐选区
         */
        alignEncodeRect(rect: EditorRect): EditorRect {
            const left = Math.max(0, Math.floor(rect.x / JPEG_GRID_SIZE) * JPEG_GRID_SIZE)
            const top = Math.max(0, Math.floor(rect.y / JPEG_GRID_SIZE) * JPEG_GRID_SIZE)
            const right = Math.min(
                this.imageWidth,
                Math.ceil((rect.x + rect.width) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
            )
            const bottom = Math.min(
                this.imageHeight,
                Math.ceil((rect.y + rect.height) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
            )
            return { ...rect, x: left, y: top, width: right - left, height: bottom - top }
        },

        /**
         * 将识别边界吸附到编码时使用的全图 MCU 网格。
         * @param rect 自动识别选区
         */
        alignDetectedRect(rect: EditorRect): EditorRect {
            const left = Math.max(0, Math.round(rect.x / JPEG_GRID_SIZE) * JPEG_GRID_SIZE)
            const top = Math.max(0, Math.round(rect.y / JPEG_GRID_SIZE) * JPEG_GRID_SIZE)
            const right = Math.min(
                this.imageWidth,
                Math.round((rect.x + rect.width) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
            )
            const bottom = Math.min(
                this.imageHeight,
                Math.round((rect.y + rect.height) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
            )
            const maximumSnapDistance = 2
            const canSnap =
                Math.abs(rect.x - left) <= maximumSnapDistance &&
                Math.abs(rect.y - top) <= maximumSnapDistance &&
                Math.abs(rect.x + rect.width - right) <= maximumSnapDistance &&
                Math.abs(rect.y + rect.height - bottom) <= maximumSnapDistance
            if (!canSnap || right <= left || bottom <= top) return rect
            return {
                ...rect,
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
            }
        },

        /** 处理编辑器的删除、撤销与重做快捷键。 */
        onKeyDown(event: KeyboardEvent) {
            if (event.key === "Delete" || event.key === "Backspace") {
                if (this.selectedId !== null && this.mode === "encode") {
                    event.preventDefault()
                    this.deleteSelected()
                }
                return
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                event.preventDefault()
                if (event.shiftKey) this.redo()
                else this.undo()
            }
        },

        /** 释放浏览器创建的临时图片地址。 */
        releaseUrls() {
            if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl)
            if (this.outputUrl) URL.revokeObjectURL(this.outputUrl)
        },

        /** 切换编码或解码工作模式。 */
        async setMode(mode: "encode" | "decode") {
            if (this.mode === mode) return
            this.mode = mode
            this.closeOutput()
            this.selectedId = null
            if (this.originalImageData) {
                await this.refreshWorkingImage()
                if (mode === "decode") await this.detectRects()
            }
        },

        /** 切换当前编码与解码使用的频域算法。 */
        setAlgorithm(algorithm: AlgorithmId) {
            if (this.algorithm === algorithm) return
            this.algorithm = algorithm
            this.errorMessage = ""
            this.closeOutput()
            this.refreshPreviews()
        },

        /** 密码改变后清除旧结果，并使用新密码刷新 v8 预览。 */
        onPasswordChange() {
            this.errorMessage = ""
            this.closeOutput()
            if (this.algorithm === "v8" || this.algorithm === "v8c") this.refreshPreviews()
        },

        /**
         * 使用当前选择的算法把空间域图像转换为频域载体。
         * @param image 待编码的空间域图像
         */
        async encodeFrequency(image: ImageDataLike): Promise<ImageDataLike> {
            if (this.algorithm === "fft") return image2fd_by_fft(image)
            if (this.algorithm === "v5") return image2fd_by_fft_v5(image)
            if (this.algorithm === "v6") return image2fd_by_fft_v6(image)
            if (this.algorithm === "v7") return image2fd_by_fft_v7(image)
            if (this.algorithm === "v8") return image2fd_by_fft_v8(image, this.password)
            return image2fd_by_fft_v8c(image, this.password)
        },

        /**
         * 使用当前选择的算法把频域载体恢复为空间域图像。
         * @param image 待解码的频域图像
         * @param rect 载体在当前整图中的位置
         */
        async decodeFrequency(image: ImageDataLike, rect?: EditorRect): Promise<ImageDataLike> {
            if (this.algorithm === "fft") return fd2image_by_fft(image)
            if (this.algorithm === "v5") return fd2image_by_fft_v5(image)
            if (this.algorithm === "v6") return fd2image_by_fft_v6(image)
            if (this.algorithm === "v7") {
                return fd2image_by_fft_v7(image, {
                    carrierX: rect?.x,
                    carrierY: rect?.y,
                })
            }
            if (this.algorithm === "v8") return fd2image_by_fft_v8(image, this.password, {
                carrierX: rect?.x,
                carrierY: rect?.y,
            })
            return fd2image_by_fft_v8c(image, this.password, {
                carrierX: rect?.x,
                carrierY: rect?.y,
            })
        },

        /**
         * 使用当前算法缩放频域载体，供缩放预览使用。
         * @param image 待缩放的频域图像
         * @param width 目标宽度
         * @param height 目标高度
         */
        async scaleFrequency(
            image: ImageDataLike,
            width: number,
            height: number
        ): Promise<ImageDataLike> {
            if (this.algorithm === "fft") return scale_fd_by_fft(image, width, height)
            if (this.algorithm === "v5") return scale_fd_by_fft_v5(image, width, height)
            if (this.algorithm === "v6") return scale_fd_by_fft_v6(image, width, height)
            if (this.algorithm === "v7") return scale_fd_by_fft_v7(image, width, height)
            if (this.algorithm === "v8") {
                return scale_fd_by_fft_v8(image, width, height, this.password)
            }
            return scale_fd_by_fft_v8c(image, width, height, this.password)
        },

        /** 获取当前提前缩放设置对应的宽度。
         * @returns 宽度尺寸；不缩放或输入无效时返回 null
         */
        getPreScaleTarget(): number | null {
            if (this.preScaleMode === "none") return null
            if (this.preScaleMode === "custom") {
                return Number.isFinite(this.customPreScaleSize) && this.customPreScaleSize > 0
                    ? Math.round(this.customPreScaleSize)
                    : null
            }
            return Number(this.preScaleMode)
        },

        /** 按宽度计算等比例缩放后的图像尺寸，只缩小不放大。
         * @param width 原图宽度
         * @param height 原图高度
         * @param target 目标宽度
         */
        getScaledImageSize(
            width: number,
            height: number,
            target: number | null
        ): { width: number; height: number } {
            if (!target || width <= target) return { width, height }
            const ratio = target / width
            return {
                width: Math.max(1, Math.round(width * ratio)),
                height: Math.max(1, Math.round(height * ratio)),
            }
        },

        /** 根据原图和当前模式生成编辑器使用的像素数据。
         * 编码模式应用提前缩放，解码模式始终保留输入图片的原始尺寸。
         */
        setWorkingImageData() {
            if (!this.originalImageData) return
            const original = this.originalImageData
            const target = this.mode === "encode" ? this.getPreScaleTarget() : null
            const size = this.getScaledImageSize(original.width, original.height, target)
            if (size.width === original.width && size.height === original.height) {
                this.sourceImageData = original
                this.imageWidth = original.width
                this.imageHeight = original.height
                return
            }

            const originalCanvas = document.createElement("canvas")
            originalCanvas.width = original.width
            originalCanvas.height = original.height
            originalCanvas.getContext("2d")!.putImageData(original, 0, 0)
            const scaledCanvas = document.createElement("canvas")
            scaledCanvas.width = size.width
            scaledCanvas.height = size.height
            const scaledContext = scaledCanvas.getContext("2d")!
            scaledContext.imageSmoothingEnabled = true
            scaledContext.imageSmoothingQuality = "high"
            scaledContext.drawImage(originalCanvas, 0, 0, size.width, size.height)
            this.sourceImageData = scaledContext.getImageData(0, 0, size.width, size.height)
            this.imageWidth = size.width
            this.imageHeight = size.height
        },

        /** 应用新的图像尺寸并重置与旧坐标相关的编辑状态。 */
        async refreshWorkingImage() {
            if (!this.originalImageData) return
            this.setWorkingImageData()
            this.closeOutput()
            this.history = []
            this.future = []
            this.replaceRects([])
            await nextTick()
            this.drawSource()
        },

        /** 切换提前缩放预设，并重新建立编辑器图像。 */
        async setPreScaleMode(mode: PreScaleMode) {
            if (this.preScaleMode === mode) return
            this.preScaleMode = mode
            if (this.mode === "encode" && this.originalImageData) {
                await this.refreshWorkingImage()
            }
        },

        /** 处理提前缩放预设下拉框变化。 */
        onPreScaleModeChange(event: Event) {
            const value = (event.target as HTMLSelectElement).value
            if (!["none", "600", "720", "900", "1080", "custom"].includes(value)) return
            void this.setPreScaleMode(value as PreScaleMode)
        },

        /** 处理手动设置的宽度尺寸。 */
        onCustomPreScaleSizeChange(event: Event) {
            const input = event.target as HTMLInputElement
            const value = Math.round(Number(input.value))
            if (!Number.isFinite(value) || value < 1) {
                input.value = String(this.customPreScaleSize)
                this.errorMessage = this.t("invalidWidth")
                return
            }
            this.customPreScaleSize = value
            this.errorMessage = ""
            if (this.mode === "encode" && this.preScaleMode === "custom") {
                void this.refreshWorkingImage()
            }
        },

        /** 打开系统文件选择器。 */
        openFilePicker() {
            ;(this.$refs.fileInput as HTMLInputElement).click()
        },

        /** 处理文件选择器返回的图片。 */
        async onFileChange(event: Event) {
            const input = event.target as HTMLInputElement
            const file = input.files?.[0]
            if (file) await this.loadFile(file)
            input.value = ""
        },

        /** 处理文件拖入编辑器。 */
        async onDrop(event: DragEvent) {
            this.draggingFile = false
            const file = event.dataTransfer?.files[0]
            if (file) await this.loadFile(file)
        },

        /** 处理剪贴板粘贴图片。 @param event 剪贴板粘贴事件 */
        async onPaste(event: ClipboardEvent) {
            const clipboardData = event.clipboardData
            if (!clipboardData) return

            // 优先从 files 提取图片
            let file: File | null = null
            if (clipboardData.files && clipboardData.files.length > 0) {
                for (let i = 0; i < clipboardData.files.length; i++) {
                    const currentFile = clipboardData.files[i]
                    if (currentFile.type.startsWith("image/") || this.isHeicFile(currentFile)) {
                        file = currentFile
                        break
                    }
                }
            }

            // 若 files 中未匹配到图片，尝试从 items 中提取图片 Blob/File
            if (!file && clipboardData.items && clipboardData.items.length > 0) {
                for (let i = 0; i < clipboardData.items.length; i++) {
                    const item = clipboardData.items[i]
                    if (
                        item.kind === "file" &&
                        (item.type.startsWith("image/") || HEIC_FILE_TYPES.has(item.type.toLowerCase()))
                    ) {
                        const blobFile = item.getAsFile()
                        if (blobFile) {
                            const extension = item.type.split("/")[1] || "png"
                            const name =
                                blobFile.name && blobFile.name !== "image.png"
                                    ? blobFile.name
                                    : `clipboard-${Date.now()}.${extension}`
                            file = new File([blobFile], name, { type: blobFile.type || item.type })
                            break
                        }
                    }
                }
            }

            if (file) {
                event.preventDefault()
                await this.loadFile(file)
            }
        },

        /** 读取图片文件并初始化画布。 */
        async loadFile(file: File) {
            const isHeic = this.isHeicFile(file)
            if (!file.type.startsWith("image/") && !isHeic) {
                this.errorMessage = this.t("invalidFile")
                return
            }
            this.errorMessage = ""
            this.importingHeic = isHeic
            try {
                const sourceFile = isHeic ? await this.convertHeicToPng(file) : file
                if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl)
                this.sourceUrl = URL.createObjectURL(sourceFile)
                const image = new Image()
                image.decoding = "async"
                image.src = this.sourceUrl
                await image.decode()
                const canvas = document.createElement("canvas")
                canvas.width = image.naturalWidth
                canvas.height = image.naturalHeight
                const context = canvas.getContext("2d", { willReadFrequently: true })!
                context.drawImage(image, 0, 0)
                this.sourceImage = image
                this.originalImageData = context.getImageData(0, 0, canvas.width, canvas.height)
                this.sourceName = file.name || `clipboard-${Date.now()}.png`
                this.sourceMimeType = sourceFile.type
                await this.refreshWorkingImage()
                if (this.mode === "decode") await this.detectRects()
            } catch (error) {
                this.errorMessage = isHeic
                    ? this.t("heicImportFailed")
                    : error instanceof Error
                      ? error.message
                      : this.t("invalidFile")
            } finally {
                this.importingHeic = false
            }
        },

        /** 判断文件是否为 HEIF/HEIC 图片，兼容移动端未设置 MIME 类型的文件。 @param file 待检测的文件 */
        isHeicFile(file: File): boolean {
            return HEIC_FILE_TYPES.has(file.type.toLowerCase()) || /\.hei[cf]$/i.test(file.name)
        },

        /** 在浏览器本地将 HEIF/HEIC 文件转换为 PNG，供画布与现有算法读取。 @param file HEIF/HEIC 图片文件 */
        async convertHeicToPng(file: File): Promise<File> {
            const converted = await heic2any({ blob: file, toType: "image/png" })
            const png = Array.isArray(converted) ? converted[0] : converted
            if (!png) throw new Error("HEIF/HEIC 转换未生成图片")
            return new File([png], file.name.replace(/\.hei[cf]$/i, ".png"), {
                type: "image/png",
            })
        },

        /** 把原图绘制到主画布。 */
        drawSource() {
            const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
            if (!canvas || !this.sourceImageData) return
            this.maskingRevision++
            this.previewRevision++
            this.maskingBusy = false
            this.previewBusy = false
            canvas.width = this.imageWidth
            canvas.height = this.imageHeight
            canvas.getContext("2d")!.putImageData(this.sourceImageData, 0, 0)
            const previewCanvas = this.$refs.decodePreviewCanvas as HTMLCanvasElement | undefined
            if (previewCanvas) {
                previewCanvas.width = this.imageWidth
                previewCanvas.height = this.imageHeight
                previewCanvas.getContext("2d")!.putImageData(this.sourceImageData, 0, 0)
            }
        },

        /** 把指针坐标换算成原图像素坐标。 */
        getImagePoint(event: PointerEvent): Point {
            const canvas = this.$refs.canvas as HTMLCanvasElement
            const bounds = canvas.getBoundingClientRect()
            return {
                x: Math.round(((event.clientX - bounds.left) / bounds.width) * this.imageWidth),
                y: Math.round(((event.clientY - bounds.top) / bounds.height) * this.imageHeight),
            }
        },

        /** 开始创建新的保护矩形。 */
        onPointerDown(event: PointerEvent) {
            if (!this.hasImage || this.busy) return
            if (window.matchMedia("(max-width: 640px)").matches) return
            const target = event.target as HTMLElement
            if (target.closest(".selection-rect")) return
            ;(this.$refs.stage as HTMLElement).setPointerCapture(event.pointerId)
            this.startPoint = this.getImagePoint(event)
            this.drawing = true
            this.selectedId = null
            this.draftRect = {
                id: this.nextRectId,
                x: this.startPoint.x,
                y: this.startPoint.y,
                width: 0,
                height: 0,
            }
        },

        /** 随指针移动更新正在创建的矩形。 */
        onPointerMove(event: PointerEvent) {
            if (
                this.rectInteraction &&
                this.interactionStartPoint &&
                this.interactionOriginalRect &&
                this.selectedRect
            ) {
                this.updateRectInteraction(this.getImagePoint(event))
                return
            }
            if (!this.drawing || !this.startPoint) return
            const point = this.getImagePoint(event)
            this.draftRect = {
                id: this.nextRectId,
                x: Math.max(0, Math.min(this.startPoint.x, point.x)),
                y: Math.max(0, Math.min(this.startPoint.y, point.y)),
                width: Math.min(this.imageWidth, Math.abs(point.x - this.startPoint.x)),
                height: Math.min(this.imageHeight, Math.abs(point.y - this.startPoint.y)),
            }
        },

        /** 完成矩形创建并写入撤销历史。 */
        onPointerUp() {
            if (this.rectInteraction) {
                if (
                    this.mode === "encode" &&
                    this.interactionChanged &&
                    this.interactionHistorySnapshot
                ) {
                    if (this.selectedRect)
                        Object.assign(this.selectedRect, this.alignEncodeRect(this.selectedRect))
                    this.history.push(this.interactionHistorySnapshot)
                    if (this.history.length > 30) this.history.shift()
                    this.future = []
                }
                this.rectInteraction = null
                this.interactionStartPoint = null
                this.interactionOriginalRect = null
                this.interactionHistorySnapshot = null
                this.interactionChanged = false
                this.resizeCorner = null
                this.refreshPreviews()
                return
            }
            if (!this.drawing || !this.draftRect) return
            this.drawing = false
            const createdRect = this.draftRect.width >= 24 && this.draftRect.height >= 24
            if (createdRect) {
                if (this.mode === "encode") {
                    Object.assign(this.draftRect, this.alignEncodeRect(this.draftRect))
                    this.pushHistory()
                } else {
                    this.draftRect.confidence = undefined
                }
                this.rects.push(this.draftRect)
                this.selectedId = this.draftRect.id
                this.nextRectId++
                this.future = []
            }
            this.draftRect = null
            this.startPoint = null
            this.refreshPreviews()
        },

        /** 选中一个已有区域。 */
        selectRect(id: number) {
            this.selectedId = id
        },

        /** 在图片中央创建一个默认大小的打码区域，供移动端直接拖动调整。 */
        createRegion() {
            if (!this.hasImage || this.busy) return
            const width = Math.min(this.imageWidth, Math.max(24, Math.round(this.imageWidth * 0.32)))
            const height = Math.min(
                this.imageHeight,
                Math.max(24, Math.round(this.imageHeight * 0.32))
            )
            let rect: EditorRect = {
                id: this.nextRectId,
                x: Math.round((this.imageWidth - width) / 2),
                y: Math.round((this.imageHeight - height) / 2),
                width,
                height,
            }
            if (this.mode === "encode") {
                rect = this.alignEncodeRect(rect)
                this.pushHistory()
            }
            this.rects.push(rect)
            this.selectedId = rect.id
            this.nextRectId++
            this.future = []
            this.refreshPreviews()
        },

        /** 选中区域并开始拖动，编码模式下同时保留撤销快照。 */
        beginRectMove(rect: EditorRect, event: PointerEvent) {
            this.selectRect(rect.id)
            if (this.busy) return
            event.preventDefault()
            ;(this.$refs.stage as HTMLElement).setPointerCapture(event.pointerId)
            this.rectInteraction = "move"
            this.interactionStartPoint = this.getImagePoint(event)
            this.interactionOriginalRect = { ...rect }
            this.interactionHistorySnapshot = this.rects.map((item) => ({ ...item }))
            this.interactionChanged = false
        },

        /** 从指定角开始缩放选中区域。 */
        beginRectResize(rect: EditorRect, corner: ResizeCorner, event: PointerEvent) {
            if (this.busy) return
            event.preventDefault()
            this.selectRect(rect.id)
            ;(this.$refs.stage as HTMLElement).setPointerCapture(event.pointerId)
            this.rectInteraction = "resize"
            this.resizeCorner = corner
            this.interactionStartPoint = this.getImagePoint(event)
            this.interactionOriginalRect = { ...rect }
            this.interactionHistorySnapshot = this.rects.map((item) => ({ ...item }))
            this.interactionChanged = false
        },

        /** 根据当前指针位置更新移动或缩放中的区域。 */
        updateRectInteraction(point: Point) {
            const rect = this.selectedRect
            const original = this.interactionOriginalRect
            const start = this.interactionStartPoint
            if (!rect || !original || !start) return
            if (this.rectInteraction === "move") {
                rect.x = Math.max(
                    0,
                    Math.min(this.imageWidth - rect.width, original.x + point.x - start.x)
                )
                rect.y = Math.max(
                    0,
                    Math.min(this.imageHeight - rect.height, original.y + point.y - start.y)
                )
            } else if (this.resizeCorner) {
                let left = original.x
                let top = original.y
                let right = original.x + original.width
                let bottom = original.y + original.height
                const minimumSize = this.mode === "encode" ? JPEG_GRID_SIZE : 8
                if (this.resizeCorner.includes("West"))
                    left = Math.max(0, Math.min(point.x, right - minimumSize))
                if (this.resizeCorner.includes("East"))
                    right = Math.min(this.imageWidth, Math.max(point.x, left + minimumSize))
                if (this.resizeCorner.includes("north"))
                    top = Math.max(0, Math.min(point.y, bottom - minimumSize))
                if (this.resizeCorner.includes("south"))
                    bottom = Math.min(this.imageHeight, Math.max(point.y, top + minimumSize))
                if (this.mode === "encode") {
                    // 同时对齐 v6 的 8 像素块与 JPEG 4:2:0 的 16 像素 MCU，避免整图转码后载体串块。
                    const maxWidth = this.resizeCorner.includes("West")
                        ? right
                        : this.imageWidth - left
                    const maxHeight = this.resizeCorner.includes("north")
                        ? bottom
                        : this.imageHeight - top
                    const width = Math.max(
                        JPEG_GRID_SIZE,
                        Math.min(
                            Math.floor(maxWidth / JPEG_GRID_SIZE) * JPEG_GRID_SIZE,
                            Math.round((right - left) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
                        )
                    )
                    const height = Math.max(
                        JPEG_GRID_SIZE,
                        Math.min(
                            Math.floor(maxHeight / JPEG_GRID_SIZE) * JPEG_GRID_SIZE,
                            Math.round((bottom - top) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
                        )
                    )
                    if (this.resizeCorner.includes("West")) left = right - width
                    else right = left + width
                    if (this.resizeCorner.includes("north")) top = bottom - height
                    else bottom = top + height
                }
                rect.x = left
                rect.y = top
                rect.width = right - left
                rect.height = bottom - top
            }
            rect.confidence = undefined
            this.interactionChanged = true
        },

        /** 通过数值输入精确修改解码区域的坐标或尺寸。 */
        updateRectField(field: "x" | "y" | "width" | "height", event: Event) {
            const rect = this.selectedRect
            let value = Math.round(Number((event.target as HTMLInputElement).value))
            if (!rect || !Number.isFinite(value)) return
            if (this.mode === "encode" && (field === "width" || field === "height")) {
                value = Math.max(
                    JPEG_GRID_SIZE,
                    Math.round(value / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
                )
            }
            if (this.mode === "encode") {
                this.pushHistory()
                this.future = []
            }
            if (field === "x") rect.x = Math.max(0, Math.min(this.imageWidth - rect.width, value))
            if (field === "y") rect.y = Math.max(0, Math.min(this.imageHeight - rect.height, value))
            if (field === "width") {
                const maximum =
                    this.mode === "encode"
                        ? Math.floor((this.imageWidth - rect.x) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
                        : this.imageWidth - rect.x
                rect.width = Math.max(
                    this.mode === "encode" ? JPEG_GRID_SIZE : 8,
                    Math.min(maximum, value)
                )
            }
            if (field === "height") {
                const maximum =
                    this.mode === "encode"
                        ? Math.floor((this.imageHeight - rect.y) / JPEG_GRID_SIZE) * JPEG_GRID_SIZE
                        : this.imageHeight - rect.y
                rect.height = Math.max(
                    this.mode === "encode" ? JPEG_GRID_SIZE : 8,
                    Math.min(maximum, value)
                )
            }
            rect.confidence = undefined
            if (this.mode === "encode") Object.assign(rect, this.alignEncodeRect(rect))
            this.refreshPreviews()
        },

        /** 删除当前选中的保护区域。 */
        deleteSelected() {
            if (this.selectedId === null) return
            this.pushHistory()
            this.rects = this.rects.filter((rect) => rect.id !== this.selectedId)
            this.selectedId = null
            this.future = []
            this.refreshPreviews()
        },

        /** 记录编辑前的矩形快照。 */
        pushHistory() {
            this.history.push(this.rects.map((rect) => ({ ...rect })))
            if (this.history.length > 30) this.history.shift()
        },

        /** 撤销最近一次区域编辑。 */
        undo() {
            const previous = this.history.pop()
            if (!previous) return
            this.future.push(this.rects.map((rect) => ({ ...rect })))
            this.rects = previous
            this.selectedId = null
            this.refreshPreviews()
        },

        /** 重做最近一次撤销。 */
        redo() {
            const next = this.future.pop()
            if (!next) return
            this.history.push(this.rects.map((rect) => ({ ...rect })))
            this.rects = next
            this.selectedId = null
            this.refreshPreviews()
        },

        /** 用新列表替换全部矩形。 */
        replaceRects(rects: EditorRect[]) {
            this.rects = rects
            this.selectedId = null
            this.nextRectId = Math.max(1, ...rects.map((rect) => rect.id + 1))
        },

        /** 使用纯视觉算法识别频域马赛克区域。 */
        async detectRects() {
            if (!this.sourceImageData) return
            this.busy = true
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            const detected = getImageQcRects(this.sourceImageData)
            this.replaceRects(
                detected.map((rect: ImageQcRect, index: number) =>
                    this.alignDetectedRect({ ...rect, id: index + 1 })
                )
            )
            this.busy = false
            void this.refreshDecodePreview()
        },

        /** 创建包含原图像素的离屏画布。 */
        createSourceCanvas(): HTMLCanvasElement {
            const canvas = document.createElement("canvas")
            canvas.width = this.imageWidth
            canvas.height = this.imageHeight
            canvas.getContext("2d")!.putImageData(this.sourceImageData!, 0, 0)
            return canvas
        },

        /** 同时刷新左侧打码结果和右侧恢复结果。 */
        refreshPreviews() {
            void this.refreshMaskingPreview()
            void this.refreshDecodePreview()
        },

        /**
         * 根据当前选区与算法创建完整的打码结果画布。
         * 原始像素始终从源图读取，防止重叠选区被重复编码。
         */
        async createEncodedCanvas(): Promise<HTMLCanvasElement> {
            const sourceCanvas = this.createSourceCanvas()
            const sourceContext = sourceCanvas.getContext("2d")!
            const outputCanvas = this.createSourceCanvas()
            const outputContext = outputCanvas.getContext("2d")!
            for (const currentRect of this.rects) {
                const rect = this.alignEncodeRect(currentRect)
                const source = sourceContext.getImageData(rect.x, rect.y, rect.width, rect.height)
                const encoded = await this.encodeFrequency(source)
                // 编辑预览与最终文件均隐藏算法层标记，保证两者显示完全一致。
                for (let offset = 3; offset < encoded.data.length; offset += 4) {
                    encoded.data[offset] = 255
                }
                outputContext.putImageData(
                    new ImageData(
                        new Uint8ClampedArray(encoded.data),
                        encoded.width,
                        encoded.height
                    ),
                    rect.x,
                    rect.y
                )
            }
            return outputCanvas
        },

        /** 实时重新计算并绘制左侧频域打码结果。 */
        async refreshMaskingPreview() {
            if (this.mode !== "encode" || !this.sourceImageData) return
            const revision = ++this.maskingRevision
            this.maskingBusy = true
            await nextTick()
            try {
                const output = await this.createEncodedCanvas()
                if (revision !== this.maskingRevision) return
                const canvas = this.$refs.canvas as HTMLCanvasElement | undefined
                if (!canvas) return
                canvas.width = this.imageWidth
                canvas.height = this.imageHeight
                canvas.getContext("2d")!.drawImage(output, 0, 0)
            } catch (error) {
                if (revision === this.maskingRevision) {
                    this.errorMessage =
                        error instanceof Error ? error.message : this.t("maskingPreviewFailed")
                }
            } finally {
                if (revision === this.maskingRevision) this.maskingBusy = false
            }
        },

        /** 切换解码预览的图像处理方式。 */
        setPreviewMode(mode: PreviewMode) {
            if (this.previewMode === mode) return
            this.previewMode = mode
            void this.refreshDecodePreview()
        },

        /**
         * 使用浏览器 JPEG 编码器重新压缩频域图像，可选地先缩放到目标宽度。
         * @param image 待压缩的频域图像
         * @param targetWidth JPEG 图像目标宽度
         */
        async transcodeFrequencyJpeg(image: ImageData, targetWidth?: number): Promise<ImageData> {
            const sourceCanvas = document.createElement("canvas")
            sourceCanvas.width = image.width
            sourceCanvas.height = image.height
            sourceCanvas.getContext("2d")!.putImageData(image, 0, 0)
            const size = targetWidth
                ? {
                      width: targetWidth,
                      height: Math.max(1, Math.round((image.height * targetWidth) / image.width)),
                  }
                : { width: image.width, height: image.height }
            const canvas = document.createElement("canvas")
            canvas.width = size.width
            canvas.height = size.height
            const context = canvas.getContext("2d")!
            context.imageSmoothingEnabled = true
            context.imageSmoothingQuality = "high"
            context.drawImage(sourceCanvas, 0, 0, size.width, size.height)
            const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                    (value) =>
                        value ? resolve(value) : reject(new Error(this.t("jpegPreviewFailed"))),
                    "image/jpeg",
                    0.8
                )
            )
            const bitmap = await createImageBitmap(blob)
            const decodedCanvas = document.createElement("canvas")
            decodedCanvas.width = size.width
            decodedCanvas.height = size.height
            decodedCanvas.getContext("2d")!.drawImage(bitmap, 0, 0)
            bitmap.close()
            return decodedCanvas.getContext("2d")!.getImageData(0, 0, size.width, size.height)
        },

        /**
         * 按真实工作流合成整图、执行 JPEG 转码，再裁出并恢复所有载体区域。
         */
        async createWholeImageJpegPreview(targetWidth?: number): Promise<HTMLCanvasElement> {
            const carrierCanvas = await this.createEncodedCanvas()
            const carrierContext = carrierCanvas.getContext("2d")!

            const transcoded = await this.transcodeFrequencyJpeg(
                carrierContext.getImageData(0, 0, carrierCanvas.width, carrierCanvas.height),
                targetWidth
            )
            const transcodedCanvas = document.createElement("canvas")
            transcodedCanvas.width = transcoded.width
            transcodedCanvas.height = transcoded.height
            const transcodedContext = transcodedCanvas.getContext("2d")!
            transcodedContext.putImageData(transcoded, 0, 0)

            const restoredCanvas = this.createSourceCanvas()
            const restoredContext = restoredCanvas.getContext("2d")!
            const scaleX = transcoded.width / carrierCanvas.width
            const scaleY = transcoded.height / carrierCanvas.height
            for (const rect of this.rects) {
                const left = Math.max(
                    0,
                    Math.min(transcoded.width - 1, Math.round(rect.x * scaleX))
                )
                const top = Math.max(
                    0,
                    Math.min(transcoded.height - 1, Math.round(rect.y * scaleY))
                )
                const right = Math.max(
                    left + 1,
                    Math.min(transcoded.width, Math.round((rect.x + rect.width) * scaleX))
                )
                const bottom = Math.max(
                    top + 1,
                    Math.min(transcoded.height, Math.round((rect.y + rect.height) * scaleY))
                )
                const previewRect: EditorRect = {
                    ...rect,
                    x: left,
                    y: top,
                    width: right - left,
                    height: bottom - top,
                }
                const frequency = transcodedContext.getImageData(
                    previewRect.x,
                    previewRect.y,
                    previewRect.width,
                    previewRect.height
                )
                const decoded = await this.decodeFrequency(frequency, previewRect)
                const decodedImage = new ImageData(
                    new Uint8ClampedArray(decoded.data),
                    decoded.width,
                    decoded.height
                )
                if (decoded.width === rect.width && decoded.height === rect.height) {
                    restoredContext.putImageData(decodedImage, rect.x, rect.y)
                } else {
                    const patch = document.createElement("canvas")
                    patch.width = decoded.width
                    patch.height = decoded.height
                    patch.getContext("2d")!.putImageData(decodedImage, 0, 0)
                    restoredContext.drawImage(patch, rect.x, rect.y, rect.width, rect.height)
                }
            }
            return restoredCanvas
        },

        /**
         * 生成右侧恢复预览。
         * 编码模式先创建频域载体再恢复；解码模式直接恢复左侧选区中的频域数据。
         */
        async refreshDecodePreview() {
            if (!this.sourceImageData) return
            const revision = ++this.previewRevision
            this.previewBusy = true
            await nextTick()
            const previewCanvas = this.$refs.decodePreviewCanvas as HTMLCanvasElement | undefined
            if (!previewCanvas) {
                this.previewBusy = false
                return
            }
            const output = this.createSourceCanvas()
            const outputContext = output.getContext("2d")!
            try {
                if (
                    this.mode === "encode" &&
                    (this.previewMode === "jpeg" || this.previewMode === "jpeg720")
                ) {
                    const jpegPreview = await this.createWholeImageJpegPreview(
                        this.previewMode === "jpeg720" ? 720 : undefined
                    )
                    if (revision !== this.previewRevision) return
                    previewCanvas.width = this.imageWidth
                    previewCanvas.height = this.imageHeight
                    previewCanvas.getContext("2d")!.drawImage(jpegPreview, 0, 0)
                    return
                }
                for (const rect of this.rects) {
                    const source = outputContext.getImageData(
                        rect.x,
                        rect.y,
                        rect.width,
                        rect.height
                    )
                    let frequency: ImageDataLike = source
                    if (this.mode === "encode") frequency = await this.encodeFrequency(source)
                    if (this.mode === "encode" && this.previewMode === "scale") {
                        frequency = await this.scaleFrequency(
                            frequency,
                            Math.max(8, Math.round(rect.width * 0.8)),
                            Math.max(8, Math.round(rect.height * 0.8))
                        )
                    }
                    const decoded = await this.decodeFrequency(frequency, rect)
                    const decodedImage = new ImageData(
                        new Uint8ClampedArray(decoded.data),
                        decoded.width,
                        decoded.height
                    )
                    if (decoded.width === rect.width && decoded.height === rect.height) {
                        outputContext.putImageData(decodedImage, rect.x, rect.y)
                    } else {
                        const patch = document.createElement("canvas")
                        patch.width = decoded.width
                        patch.height = decoded.height
                        patch.getContext("2d")!.putImageData(decodedImage, 0, 0)
                        outputContext.drawImage(patch, rect.x, rect.y, rect.width, rect.height)
                    }
                }
                if (revision !== this.previewRevision) return
                previewCanvas.width = this.imageWidth
                previewCanvas.height = this.imageHeight
                previewCanvas.getContext("2d")!.drawImage(output, 0, 0)
            } catch (error) {
                if (revision === this.previewRevision) {
                    this.errorMessage =
                        error instanceof Error ? error.message : this.t("decodePreviewFailed")
                }
            } finally {
                if (revision === this.previewRevision) this.previewBusy = false
            }
        },

        /** 将选区转换成频域图并生成无附带标记的 PNG。 */
        async generateEncoded() {
            if (!this.sourceImageData || this.rects.length === 0) return
            this.busy = true
            this.errorMessage = ""
            try {
                const canvas = await this.createEncodedCanvas()
                await this.setOutput(
                    canvas,
                    `qmosaic-${this.sourceName.replace(/\.[^.]+$/, "")}.png`
                )
            } catch (error) {
                this.errorMessage =
                    error instanceof Error ? error.message : this.t("generateFailed")
            } finally {
                this.busy = false
            }
        },

        /** 将识别到的频域区域逆转回空域图像。 */
        async generateDecoded() {
            if (!this.sourceImageData || this.rects.length === 0) return
            this.busy = true
            this.errorMessage = ""
            try {
                const canvas = this.createSourceCanvas()
                const context = canvas.getContext("2d")!
                for (const rect of this.rects) {
                    const frequency = context.getImageData(rect.x, rect.y, rect.width, rect.height)
                    // PNG 恢复所选版本的完整层标记；有损格式使用无标记的可靠基础层。
                    const frequencyAlpha =
                        this.sourceMimeType === "image/png"
                            ? this.algorithm === "v5"
                                ? 253
                                : ["v6", "v7", "v8", "v8c"].includes(this.algorithm)
                                  ? 252
                                  : 255
                            : 255
                    for (let offset = 3; offset < frequency.data.length; offset += 4) {
                        frequency.data[offset] = frequencyAlpha
                    }
                    const decoded = await this.decodeFrequency(frequency, rect)
                    context.putImageData(
                        new ImageData(
                            new Uint8ClampedArray(decoded.data),
                            decoded.width,
                            decoded.height
                        ),
                        rect.x,
                        rect.y
                    )
                }
                await this.setOutput(
                    canvas,
                    `qmosaic-restored-${this.sourceName.replace(/\.[^.]+$/, "")}.png`
                )
            } catch (error) {
                this.errorMessage =
                    error instanceof Error ? error.message : this.t("restoreFailed")
            } finally {
                this.busy = false
            }
        },

        /** 将离屏画布转为结果预览地址。 */
        async setOutput(canvas: HTMLCanvasElement, name: string) {
            const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                    (value) => value ? resolve(value) : reject(new Error(this.t("exportFailed"))),
                    "image/png"
                )
            )
            if (this.outputUrl) URL.revokeObjectURL(this.outputUrl)
            this.outputUrl = URL.createObjectURL(blob)
            this.outputName = name
        },

        /** 下载当前生成结果。 */
        downloadOutput() {
            if (!this.outputUrl) return
            const anchor = document.createElement("a")
            anchor.href = this.outputUrl
            anchor.download = this.outputName
            anchor.click()
        },

        /** 关闭结果预览。 */
        closeOutput() {
            if (this.outputUrl) URL.revokeObjectURL(this.outputUrl)
            this.outputUrl = ""
        },

        /** 把图像坐标转换为百分比定位样式。 */
        rectStyle(rect: EditorRect) {
            return {
                left: `${(rect.x / this.imageWidth) * 100}%`,
                top: `${(rect.y / this.imageHeight) * 100}%`,
                width: `${(rect.width / this.imageWidth) * 100}%`,
                height: `${(rect.height / this.imageHeight) * 100}%`,
            }
        },
    },
})
</script>

<template>
    <div class="app-shell">
        <header class="topbar">
            <div class="brand" aria-label="Qmosaic">
                <img class="brand-icon" :src="brandIconUrl" alt="" aria-hidden="true" />
                <div><strong>Q_____c</strong><small>{{ t("brandSubtitle") }}</small></div>
            </div>
            <div class="mode-switch" role="tablist" :aria-label="t('workMode')">
                <button :class="{ active: mode === 'encode' }" @click="setMode('encode')">
                    {{ t("encode") }}
                </button>
                <button :class="{ active: mode === 'decode' }" @click="setMode('decode')">
                    {{ t("decode") }}
                </button>
            </div>
            <div class="topbar-settings">
                <div class="algorithm-picker" role="group" :aria-label="t('algorithmVersion')">
                    <span>{{ t("algorithm") }}</span>
                    <button :class="{ active: algorithm === 'fft' }" @click="setAlgorithm('fft')">
                        v1
                    </button>
                    <button :class="{ active: algorithm === 'v5' }" @click="setAlgorithm('v5')">
                        v5
                    </button>
                    <button :class="{ active: algorithm === 'v6' }" @click="setAlgorithm('v6')">
                        v6
                    </button>
                    <button :class="{ active: algorithm === 'v7' }" @click="setAlgorithm('v7')">
                        v7
                    </button>
                    <button :class="{ active: algorithm === 'v8' }" @click="setAlgorithm('v8')">
                        v8
                    </button>
                    <button
                        :class="{ active: algorithm === 'v8c' }"
                        @click="setAlgorithm('v8c')"
                    >
                        v8c
                    </button>
                </div>
                <button
                    class="language-switch"
                    type="button"
                    :aria-label="t('languageSwitch')"
                    :title="t('languageSwitch')"
                    @click="toggleLocale"
                >
                    {{ locale === "zh-CN" ? "EN" : "中文" }}
                </button>
            </div>
            <span class="system-status"><i></i>LOCAL / READY</span>
        </header>

        <main>
            <section
                class="workspace-card"
                :class="{ 'is-dragging': draggingFile }"
                :aria-busy="busy"
                @dragover.prevent="draggingFile = true"
                @dragleave.prevent="draggingFile = false"
                @drop.prevent="onDrop"
            >
                <div class="workspace-toolbar">
                    <div class="file-summary">
                        <template v-if="hasImage">
                            <strong>{{ sourceName }}</strong>
                            <span>{{ imageWidth }} × {{ imageHeight }} px</span>
                        </template>
                        <template v-else
                            ><strong>{{ t("newTask") }}</strong
                            ><span>{{ statusLabel }}</span></template
                        >
                    </div>
                    <div
                        v-if="selectedRect"
                        class="toolbar-coordinates"
                        :aria-label="t('selectionCoordinates')"
                    >
                        <label
                            ><small>X</small
                            ><input
                                type="number"
                                :aria-label="t('selectionX')"
                                :value="selectedRect.x"
                                min="0"
                                :max="imageWidth - selectedRect.width"
                                @change="updateRectField('x', $event)"
                        /></label>
                        <label
                            ><small>Y</small
                            ><input
                                type="number"
                                :aria-label="t('selectionY')"
                                :value="selectedRect.y"
                                min="0"
                                :max="imageHeight - selectedRect.height"
                                @change="updateRectField('y', $event)"
                        /></label>
                        <label
                            ><small>{{ t("width") }}</small
                            ><input
                                type="number"
                                :aria-label="t('selectionWidth')"
                                :value="selectedRect.width"
                                :min="mode === 'encode' ? 16 : 8"
                                :max="imageWidth - selectedRect.x"
                                :step="mode === 'encode' ? 16 : 1"
                                @change="updateRectField('width', $event)"
                        /></label>
                        <label
                            ><small>{{ t("height") }}</small
                            ><input
                                type="number"
                                :aria-label="t('selectionHeight')"
                                :value="selectedRect.height"
                                :min="mode === 'encode' ? 16 : 8"
                                :max="imageHeight - selectedRect.y"
                                :step="mode === 'encode' ? 16 : 1"
                                @change="updateRectField('height', $event)"
                        /></label>
                        <em>px</em>
                    </div>
                    <div class="toolbar-actions">
                        <div
                            v-if="mode === 'encode'"
                            class="toolbar-pre-scale"
                            :title="preScaleSummary"
                        >
                            <label class="pre-scale-field">
                                <span>{{ t("preScale") }}</span>
                                <select
                                    :value="preScaleMode"
                                    :aria-label="t('preScaleSize')"
                                    :disabled="busy"
                                    @change="onPreScaleModeChange"
                                >
                                    <option value="none">{{ t("noPreScale") }}</option>
                                    <option value="600">600</option>
                                    <option value="720">720 - X</option>
                                    <option value="900">900 - Pixiv</option>
                                    <option value="1080">1080 - RedNote</option>
                                    <option value="2000">2000 - Bilibili</option>
                                    <option value="custom">{{ t("customSize") }}</option>
                                </select>
                                <input
                                    v-if="preScaleMode === 'custom'"
                                    type="number"
                                    min="1"
                                    step="1"
                                    :value="customPreScaleSize"
                                    :aria-label="t('customWidth')"
                                    :disabled="busy"
                                    @change="onCustomPreScaleSizeChange"
                                />
                                <small>{{ t("widthLabel") }}</small>
                            </label>
                        </div>
                        <template v-if="mode === 'encode' && hasImage">
                            <button
                                class="icon-button"
                                :disabled="!history.length"
                                :title="t('undo')"
                                @click="undo"
                            >
                                <svg viewBox="0 0 24 24">
                                    <path d="m9 7-4 4 4 4M5 11h8a6 6 0 0 1 6 6" />
                                </svg>
                            </button>
                            <button
                                class="icon-button"
                                :disabled="!future.length"
                                :title="t('redo')"
                                @click="redo"
                            >
                                <svg viewBox="0 0 24 24">
                                    <path d="m15 7 4 4-4 4m4-4h-8a6 6 0 0 0-6 6" />
                                </svg>
                            </button>
                            <span class="divider"></span>
                            <button
                                class="icon-button danger"
                                :disabled="selectedId === null"
                                :title="t('deleteSelection')"
                                @click="deleteSelected"
                            >
                                <svg viewBox="0 0 24 24">
                                    <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                                </svg>
                            </button>
                        </template>
                        <button class="change-file" @click="openFilePicker">
                            {{ hasImage ? t("changeImage") : t("selectImage") }}
                        </button>
                    </div>
                </div>

                <div v-if="!hasImage" class="drop-zone" @click="openFilePicker">
                    <div class="drop-pixel-icon" aria-hidden="true"><span>+</span></div>
                    <span class="drop-command">~/image$ import --local</span>
                    <h2>{{ t("dropImage") }}</h2>
                    <p>{{ t("fileSupport") }}</p>
                    <button>[ {{ t("selectImage") }} ]</button>
                </div>

                <div v-else class="editor-area">
                    <div class="canvas-wrap">
                        <div class="workspace-grid">
                            <section class="workspace-pane masking-pane">
                                <header class="pane-header">
                                    <div>
                                        <strong>{{
                                            mode === "encode"
                                                ? t("maskingEditor")
                                                : t("frequencyImage")
                                        }}</strong
                                        ><small>{{
                                            mode === "encode"
                                                ? maskingBusy
                                                    ? t("updatingMask")
                                                    : t("maskingHint")
                                                : t("calibrationHint")
                                        }}</small>
                                    </div>
                                </header>
                                <div class="mobile-region-creator">
                                    <button @click="createRegion">
                                        + {{ t("createMosaicRegion") }}
                                    </button>
                                    <small>{{ t("createRegionHint") }}</small>
                                </div>
                                <div class="pane-canvas-body">
                                    <div
                                        ref="stage"
                                        class="canvas-stage crosshair"
                                        @pointerdown="onPointerDown"
                                        @pointermove="onPointerMove"
                                        @pointerup="onPointerUp"
                                        @pointercancel="onPointerUp"
                                    >
                                        <canvas ref="canvas"></canvas>
                                        <span v-if="maskingBusy" class="preview-loading"
                                            ><i class="spinner"></i>{{ t("updating") }}</span
                                        >
                                        <button
                                            v-for="rect in rects"
                                            :key="rect.id"
                                            class="selection-rect"
                                            :class="{
                                                selected: selectedId === rect.id,
                                                detected: mode === 'decode',
                                            }"
                                            :style="rectStyle(rect)"
                                            @pointerdown="beginRectMove(rect, $event)"
                                        >
                                            <span class="rect-label">{{
                                                mode === "decode"
                                                    ? rect.confidence === undefined
                                                        ? t("manualAdjustment")
                                                        : `${Math.round(rect.confidence * 100)}%`
                                                    : t("region", { id: rect.id })
                                            }}</span>
                                            <i
                                                v-if="selectedId === rect.id"
                                                v-for="corner in resizeCorners"
                                                :key="corner"
                                                :class="corner"
                                                @pointerdown.stop="
                                                    beginRectResize(rect, corner, $event)
                                                "
                                            ></i>
                                        </button>
                                        <div
                                            v-if="draftRect"
                                            class="selection-rect draft"
                                            :class="{ detected: mode === 'decode' }"
                                            :style="rectStyle(draftRect)"
                                        ></div>
                                    </div>
                                </div>
                            </section>
                            <section class="workspace-pane preview-pane">
                                <header class="pane-header">
                                    <div>
                                        <strong>{{
                                            mode === "encode"
                                                ? t("decodePreview")
                                                : t("restoredResult")
                                        }}</strong
                                        ><small>{{
                                            mode === "encode"
                                                ? t("restoredHint")
                                                : rects.length
                                                  ? t("restoredRegions", {
                                                        count: rects.length,
                                                    })
                                                  : t("waitingForRegions")
                                        }}</small>
                                    </div>
                                    <div
                                        v-if="mode === 'encode'"
                                        class="preview-options"
                                        role="group"
                                        :aria-label="t('previewProcessing')"
                                    >
                                        <button
                                            :class="{ active: previewMode === 'none' }"
                                            @click="setPreviewMode('none')"
                                        >
                                            {{ t("noProcessing") }}
                                        </button>
                                        <button
                                            :class="{ active: previewMode === 'scale' }"
                                            @click="setPreviewMode('scale')"
                                        >
                                            {{ t("scalePreview") }}
                                        </button>
                                        <button
                                            :class="{ active: previewMode === 'jpeg' }"
                                            @click="setPreviewMode('jpeg')"
                                        >
                                            {{ t("jpegTranscode") }}
                                        </button>
                                        <button
                                            :class="{ active: previewMode === 'jpeg720' }"
                                            @click="setPreviewMode('jpeg720')"
                                        >
                                            {{ t("jpeg720") }}
                                        </button>
                                    </div>
                                </header>
                                <div class="pane-canvas-body preview-body">
                                    <div class="preview-stage">
                                        <canvas ref="decodePreviewCanvas"></canvas>
                                        <span v-if="previewBusy" class="preview-loading"
                                            ><i class="spinner"></i>{{ t("simulating") }}</span
                                        >
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                    <div v-if="mode === 'decode' && selectedRect" class="rect-inspector">
                        <strong>{{ t("preciseAdjustment") }}</strong>
                        <label
                            >X
                            <input
                                type="number"
                                :value="selectedRect.x"
                                min="0"
                                :max="imageWidth - selectedRect.width"
                                @change="updateRectField('x', $event)"
                        /></label>
                        <label
                            >Y
                            <input
                                type="number"
                                :value="selectedRect.y"
                                min="0"
                                :max="imageHeight - selectedRect.height"
                                @change="updateRectField('y', $event)"
                        /></label>
                        <label
                            >{{ t("width") }}
                            <input
                                type="number"
                                :value="selectedRect.width"
                                min="8"
                                :max="imageWidth - selectedRect.x"
                                @change="updateRectField('width', $event)"
                        /></label>
                        <label
                            >{{ t("height") }}
                            <input
                                type="number"
                                :value="selectedRect.height"
                                min="8"
                                :max="imageHeight - selectedRect.y"
                                @change="updateRectField('height', $event)"
                        /></label>
                        <span>{{ t("moveResizeHint") }}</span>
                    </div>
                    <div class="editor-status">
                        <span><i></i>{{ statusLabel }}</span>
                        <span v-if="mode === 'encode'" class="tip"
                            ><kbd>{{ t("dragEmpty") }}</kbd> {{ t("createSelection") }}
                            <kbd>{{ t("dragSelection") }}</kbd> {{ t("move") }}
                            <kbd>Delete</kbd> {{ t("delete") }}</span
                        >
                        <div v-else class="decode-actions">
                            <span class="manual-hint">{{ t("addRegionHint") }}</span>
                            <button
                                class="remove-rect"
                                :disabled="selectedId === null"
                                @click="deleteSelected"
                            >
                                {{ t("removeFalsePositive") }}
                            </button>
                            <button class="rescan" :disabled="busy" @click="detectRects">
                                {{ t("rescan") }}
                            </button>
                        </div>
                    </div>
                </div>

                <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>
                <div class="workspace-footer">
                    <div class="footer-security">
                        <span>{{ t("localOnly") }}</span>
                        <label v-if="algorithm === 'v8' || algorithm === 'v8c'" class="password-field">
                            <span>{{
                                mode === "encode" ? t("setPassword") : t("restorePassword")
                            }}</span>
                            <input
                                v-model="password"
                                :autocomplete="
                                    mode === 'encode' ? 'new-password' : 'current-password'
                                "
                                :placeholder="t('passwordPlaceholder')"
                                spellcheck="false"
                                @change="onPasswordChange"
                            />
                        </label>
                    </div>
                    <button
                        class="primary-action"
                        :disabled="!canProcess"
                        @click="mode === 'encode' ? generateEncoded() : generateDecoded()"
                    >
                        <span v-if="busy" class="spinner"></span>
                        {{
                            busy
                                ? t("processing")
                                : mode === "encode"
                                  ? t("generateMosaic")
                                  : t("generateRestored")
                        }}
                    </button>
                </div>
            </section>
        </main>

        <footer class="site-footer">
            <div class="site-footer-inner">
                <div class="footer-sections">
                    <section>
                        <h2>{{ t("footerFeaturesTitle") }}</h2>
                        <ul class="footer-feature-list">
                            <li>
                                <strong>{{ t("featureReversibleName") }}</strong>
                                <span>{{ t("featureReversibleDescription") }}</span>
                            </li>
                            <li>
                                <strong>{{ t("featureDetectionName") }}</strong>
                                <span>{{ t("featureDetectionDescription") }}</span>
                            </li>
                            <li>
                                <strong>{{ t("featurePasswordName") }}</strong>
                                <span>{{ t("featurePasswordDescription") }}</span>
                            </li>
                            <li>
                                <strong>{{ t("featureRobustnessName") }}</strong>
                                <span>{{ t("featureRobustnessDescription") }}</span>
                            </li>
                            <li>
                                <strong>{{ t("featureLocalName") }}</strong>
                                <span>{{ t("featureLocalDescription") }}</span>
                            </li>
                            <li>
                                <strong>{{ t("featurePlatformName") }}</strong>
                                <span>{{ t("featurePlatformDescription") }}</span>
                            </li>
                            <li>
                                <strong>{{ t("featureOpenSourceName") }}</strong>
                                <span>{{ t("featureOpenSourceDescription") }}</span>
                            </li>
                        </ul>
                    </section>
                    <section>
                        <h2>{{ t("footerTipsTitle") }}</h2>
                        <ul class="footer-tip-list">
                            <li>{{ t("tipResize") }}</li>
                            <li>{{ t("tipSocial") }}</li>
                            <li>{{ t("tipVersion") }}</li>
                        </ul>
                    </section>
                </div>
                <div class="footer-meta">
                    <p>
                        <span>{{ t("projectLandingPage") }}</span>
                        <a
                            href="https://qzrzz.com/Q_____c/"
                            target="_blank"
                            rel="noopener noreferrer"
                            >qzrzz.com/Q_____c/</a
                        >
                    </p>
                    <p>
                        <span>{{ t("projectRepository") }}</span>
                        <a
                            href="https://github.com/qzrzz/Q_____c"
                            target="_blank"
                            rel="noopener noreferrer"
                            >github.com/qzrzz/Q_____c</a
                        >
                    </p>
                    <p>
                        <a
                            href="https://github.com/qzrzz/Q_____c/releases"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ t("browserExtension") }}</a
                        >
                    </p>
                    <p>
                        <span>{{ t("authorNotice") }}</span>
                        <a
                            href="https://qzrzz.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                            >(C) Qzrzz.com</a
                        >
                    </p>
                </div>
            </div>
        </footer>

        <div v-if="busy || importingHeic" class="processing-overlay" role="status" aria-live="assertive">
            <div class="processing-panel">
                <span class="pixel-loader" aria-hidden="true">
                    <i></i><i></i><i></i><i></i>
                </span>
                <div>
                    <strong>{{
                        importingHeic
                            ? t("convertingHeic")
                            : mode === "encode"
                              ? t("encodingImage")
                              : t("decodingImage")
                    }}</strong>
                    <small>{{ t("processingHint") }}</small>
                </div>
            </div>
        </div>

        <input
            ref="fileInput"
            class="visually-hidden"
            type="file"
            accept="image/*,.heic,.heif,image/heic,image/heif"
            @change="onFileChange"
        />

        <div v-if="outputUrl" class="result-modal" @click.self="closeOutput">
            <div class="result-panel">
                <button class="modal-close" :aria-label="t('close')" @click="closeOutput">
                    ×
                </button>
                <div>
                    <span class="result-kicker">{{ t("complete") }}</span>
                    <h2>{{
                        mode === "encode" ? t("mosaicGenerated") : t("imageRestored")
                    }}</h2>
                    <p>{{ t("browserOnly") }}</p>
                </div>
                <img :src="outputUrl" :alt="t('resultPreview')" />
                <button class="download-button" @click="downloadOutput">
                    <svg viewBox="0 0 24 24"><path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14" /></svg
                    >{{ t("downloadPng") }}
                </button>
            </div>
        </div>
    </div>
</template>
