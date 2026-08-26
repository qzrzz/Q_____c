import type { ImageDataLike } from "../core/image2fd_by_fft"
import { fd2image_by_fft_v6, image2fd_by_fft_v6 } from "../core/image2fd_by_fft-v6"
import { fd2image_by_fft_v7, image2fd_by_fft_v7 } from "../core/image2fd_by_fft-v7"
import { fd2image_by_fft_v8, image2fd_by_fft_v8 } from "../core/image2fd_by_fft-v8"
import { fd2image_by_fft_v8c, image2fd_by_fft_v8c } from "../core/image2fd_by_fft-v8c"

export type ImageQcVersion = "v8c" | "v8" | "v7"

/** 试解结果是统计判据，不是格式校验和或密码认证。 */
export interface ImageQcDecodeCandidate {
    version: ImageQcVersion
    /** 重新编码后 2×2 亮度均值的均方根误差，越小越可信。 */
    reconstructionError: number
}

export interface ImageQcAutoDecodeResult {
    version: ImageQcVersion
    image: ImageDataLike
    candidates: ImageQcDecodeCandidate[]
    /** 完整区域的基础层重建误差，防止只有探针区域匹配。 */
    validationError: number
}

/** 自动识别不确定时携带候选误差，供调用方展示或转为手动选择。 */
export class ImageQcAutoDecodeError extends Error {
    /** 创建识别失败信息。 @param reason 失败原因 @param candidates 候选版本及误差 */
    constructor(
        public readonly reason: "unsupported" | "ambiguous",
        public readonly candidates: ImageQcDecodeCandidate[]
    ) {
        super(reason === "ambiguous"
            ? "多个算法版本的结果接近，无法确定版本，请手动选择"
            : "无法可靠解码：请检查密码、区域边界，或手动选择算法版本")
        this.name = "ImageQcAutoDecodeError"
    }
}

const VERSIONS: ImageQcVersion[] = ["v8c", "v8", "v7"]
const PROBE_SIZE = 160
const MAX_RECONSTRUCTION_ERROR = 12
const MIN_ERROR_MARGIN = 6

/**
 * 从左上角截取有界探针，不缩放、不搬移块坐标，保持密码置换与导频位置。
 * @param image 待识别的完整载体区域
 */
function createProbe(image: ImageDataLike): ImageDataLike {
    const width = Math.min(PROBE_SIZE, image.width)
    const height = Math.min(PROBE_SIZE, image.height)
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        data.set(image.data.subarray(y * image.width * 4, (y * image.width + width) * 4), y * width * 4)
    }
    return { width, height, data }
}

/** 读取基础码元的平均亮度，忽略 JPEG 容易破坏的高频和色度。 @param image 图像 @param x 码元横坐标 @param y 码元纵坐标 */
function cellLuminance(image: ImageDataLike, x: number, y: number): number {
    let sum = 0
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const offset = ((y + dy) * image.width + x + dx) * 4
        sum += 0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2]
    }
    return sum / 4
}

/**
 * 比较解码后重建的基础码元；排除边缘块，避免识别边框与探针裁切影响评分。
 * @param source 输入载体
 * @param rebuilt 同版本重新编码的载体
 */
function reconstructionError(source: ImageDataLike, rebuilt: ImageDataLike): number {
    let squaredError = 0
    let cells = 0
    for (let y = 8; y + 1 < source.height - 8; y += 2) {
        for (let x = 8; x + 1 < source.width - 8; x += 2) {
            squaredError += (cellLuminance(source, x, y) - cellLuminance(rebuilt, x, y)) ** 2
            cells++
        }
    }
    return cells === 0 ? Infinity : Math.sqrt(squaredError / cells)
}

/**
 * 按候选版本解码。自动识别不猜测缩放前尺寸，避免错误版本触发尺度归一化而伪装成功。
 * @param image 载体区域
 * @param version 候选版本
 * @param password 用户密码，遵循现有解码器的空密码默认规则
 */
async function decodeVersion(image: ImageDataLike, version: ImageQcVersion, password?: string): Promise<ImageDataLike> {
    const options = { encodedWidth: image.width, encodedHeight: image.height }
    if (version === "v8c") return fd2image_by_fft_v8c(image, password, options)
    if (version === "v8") return fd2image_by_fft_v8(image, password, options)
    return fd2image_by_fft_v7(image, options)
}

/** 同版本重新编码用于验证，而非仅把无异常的解码当作成功。 @param image 解码图像 @param version 候选版本 @param password 用户密码 */
async function encodeVersion(image: ImageDataLike, version: ImageQcVersion, password?: string): Promise<ImageDataLike> {
    if (version === "v8c") return image2fd_by_fft_v8c(image, password)
    if (version === "v8") return image2fd_by_fft_v8(image, password)
    return image2fd_by_fft_v7(image)
}

/**
 * 按 v8c、v8、v7 顺序试解，通过重编码一致性筛选版本，再解码完整区域。
 * 适用于未缩放的 PNG/JPEG 载体；旧格式没有可靠校验和，损坏、歧义或错误密码会尽量拒绝。
 * 不支持的旧版本、缩放载体和不足 32×32 的区域应由调用方提供手动解码入口。
 * @param image 已准确裁出的载体区域，保留原始 alpha，不要按猜测版本改写
 * @param password 用户输入的密码；为空或未指定时沿用 v8 的默认密码，不枚举密码
 */
export async function decodeImageQcAuto(image: ImageDataLike, password?: string): Promise<ImageQcAutoDecodeResult> {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 ||
        image.data.length !== image.width * image.height * 4) {
        throw new RangeError("图像尺寸或 RGBA 像素缓冲区长度无效")
    }
    if (image.width < 32 || image.height < 32) throw new ImageQcAutoDecodeError("unsupported", [])
    const probe = createProbe(image)
    const candidates: ImageQcDecodeCandidate[] = []
    for (const version of VERSIONS) {
        const decoded = await decodeVersion(probe, version, password)
        const rebuilt = await encodeVersion(decoded, version, password)
        candidates.push({ version, reconstructionError: reconstructionError(probe, rebuilt) })
    }
    const ranked = [...candidates].sort((a, b) => a.reconstructionError - b.reconstructionError)
    const best = ranked[0]
    if (!Number.isFinite(best.reconstructionError) || best.reconstructionError > MAX_RECONSTRUCTION_ERROR) {
        throw new ImageQcAutoDecodeError("unsupported", candidates)
    }
    if (ranked[1].reconstructionError - best.reconstructionError < MIN_ERROR_MARGIN) {
        throw new ImageQcAutoDecodeError("ambiguous", candidates)
    }
    // v6 与 v7 的基础码元相似，但 v6 还有全局块置换，误认后会输出打乱的图像。
    // 只把 v6 当作排除对照；没有足够优势时保守拒绝，不宣称已经支持自动解码 v6。
    if (best.version === "v7") {
        const legacy = await image2fd_by_fft_v6(await fd2image_by_fft_v6(probe))
        if (reconstructionError(probe, legacy) <= best.reconstructionError + 1) {
            throw new ImageQcAutoDecodeError("unsupported", candidates)
        }
    }
    const decoded = await decodeVersion(image, best.version, password)
    const validationError = reconstructionError(image, await encodeVersion(decoded, best.version, password))
    if (!Number.isFinite(validationError) || validationError > MAX_RECONSTRUCTION_ERROR) {
        throw new ImageQcAutoDecodeError("unsupported", candidates)
    }
    return { version: best.version, image: decoded, candidates, validationError }
}
