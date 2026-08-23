import { resize_image, type ImageDataLike } from "../image2fd_by_fft"
import {
    fd2image_by_fft_v6,
    image2fd_by_fft_v6,
    scale_fd_by_fft_v6,
} from "../image2fd_by_fft-v6"
import {
    calculatePSNR,
    calculateSSIM,
    transcodeBrowserLikeJpeg,
} from "./benchmarkFn"

/**
 * 创建包含局部边缘、渐变和颜色变化的测试图像。
 * @param width 图像宽度
 * @param height 图像高度
 */
function createTestImage(width: number, height: number): ImageDataLike {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4
            const tile = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 18 : -18
            data[offset] = Math.max(0, Math.min(255, x * 1.9 + tile))
            data[offset + 1] = Math.max(0, Math.min(255, y * 2.2 - tile))
            data[offset + 2] = Math.max(0, Math.min(255, (x + y) * 1.1 + tile))
            data[offset + 3] = 255
        }
    }
    return { width, height, data }
}

/**
 * 把载体嵌入整图后执行 JPEG 转码，再按原位置裁回载体区域。
 * @param carrier 待嵌入的 v6 载体
 * @param left 载体在整图中的横坐标
 * @param top 载体在整图中的纵坐标
 * @param quality JPEG 质量
 */
function transcodeEmbeddedCarrier(
    carrier: ImageDataLike,
    left: number,
    top: number,
    quality: number
): ImageDataLike {
    const canvasWidth = 160
    const canvasHeight = 128
    const canvasData = new Uint8ClampedArray(canvasWidth * canvasHeight * 4)
    for (let pixel = 0; pixel < canvasWidth * canvasHeight; pixel++) {
        const offset = pixel * 4
        canvasData[offset] = 226
        canvasData[offset + 1] = 218
        canvasData[offset + 2] = 204
        canvasData[offset + 3] = 255
    }
    for (let y = 0; y < carrier.height; y++) {
        for (let x = 0; x < carrier.width; x++) {
            const sourceOffset = (y * carrier.width + x) * 4
            const targetOffset = ((top + y) * canvasWidth + left + x) * 4
            canvasData.set(carrier.data.subarray(sourceOffset, sourceOffset + 4), targetOffset)
        }
    }

    const transcoded = transcodeBrowserLikeJpeg(
        { width: canvasWidth, height: canvasHeight, data: canvasData },
        quality
    )
    const croppedData = new Uint8ClampedArray(carrier.width * carrier.height * 4)
    for (let y = 0; y < carrier.height; y++) {
        const sourceOffset = ((top + y) * canvasWidth + left) * 4
        const targetOffset = y * carrier.width * 4
        croppedData.set(
            transcoded.data.subarray(sourceOffset, sourceOffset + carrier.width * 4),
            targetOffset
        )
    }
    return { width: carrier.width, height: carrier.height, data: croppedData }
}

test("v6 的 PNG 增强层应高质量恢复局部频谱", async () => {
    const source = createTestImage(96, 80)
    const restored = await fd2image_by_fft_v6(await image2fd_by_fft_v6(source))

    expect(calculatePSNR(restored, source)).toBeGreaterThan(34)
    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.99)
})

test("v6 的浏览器 4:2:0 JPEG Q70 基础层应保留可辨识结构", async () => {
    const source = createTestImage(96, 80)
    const restored = await fd2image_by_fft_v6(
        transcodeBrowserLikeJpeg(await image2fd_by_fft_v6(source), 70)
    )

    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.8)
})

test("v6 载体按全图 MCU 对齐并经过浏览器 4:2:0 后应可恢复", async () => {
    const source = createTestImage(96, 80)
    const carrier = await image2fd_by_fft_v6(source)
    const restored = await fd2image_by_fft_v6(
        transcodeEmbeddedCarrier(carrier, 32, 16, 70)
    )

    expect(calculatePSNR(restored, source)).toBeGreaterThan(18)
    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.8)
})

test("v6 通过专用缩放函数改变尺寸后应重新编码局部频谱并保持结构", async () => {
    const source = createTestImage(96, 80)
    const targetWidth = 47
    const targetHeight = 39
    const restored = await fd2image_by_fft_v6(
        await scale_fd_by_fft_v6(
            await image2fd_by_fft_v6(source),
            targetWidth,
            targetHeight
        )
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(restored.width).toBe(targetWidth)
    expect(restored.height).toBe(targetHeight)
    expect(calculateSSIM(restored, reference)).toBeGreaterThan(0.95)
})
