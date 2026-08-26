import type { ImageDataLike } from "../../../src/core/image2fd_by_fft"
import { decodeImageQcAuto, ImageQcAutoDecodeError, type ImageQcVersion } from "../../../src/helper/decodeImageQcAuto"

/**
 * 导入图片时根据已识别区域推荐一个具体版本；混用版本或无法判断时不替用户选择。
 * @param image 原始整图，保留 alpha 标记
 * @param rects 已定位的马赛克区域
 * @param password 当前恢复密码
 */
export async function detectEditorAlgorithm(
    image: ImageDataLike,
    rects: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
    password: string
): Promise<ImageQcVersion | null> {
    let version: ImageQcVersion | null = null
    for (const rect of rects) {
        const data = new Uint8ClampedArray(rect.width * rect.height * 4)
        for (let y = 0; y < rect.height; y++) {
            const start = ((rect.y + y) * image.width + rect.x) * 4
            data.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4)
        }
        try {
            const result = await decodeImageQcAuto({ width: rect.width, height: rect.height, data }, password)
            if (version && version !== result.version) return null
            version = result.version
        } catch (error) {
            // 视觉定位可能有误报，继续检查其他区域；运行环境错误不能被吞掉。
            if (!(error instanceof ImageQcAutoDecodeError)) throw error
        }
    }
    return version
}
