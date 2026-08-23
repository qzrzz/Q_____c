import { resize_image, type ImageDataLike } from "../image2fd_by_fft"
import {
    fd2image_by_fft_v8,
    image2fd_by_fft_v8,
    scale_fd_by_fft_v8,
} from "../image2fd_by_fft-v8"
import {
    calculatePSNR,
    calculateSSIM,
    transcodeBrowserLikeJpeg,
} from "./benchmarkFn"

const TEST_PASSWORD = "主人-v8-测试密码"

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
 * @param carrier 待嵌入的 v8 载体
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

test("v8 的 PNG 增强层应高质量恢复局部频谱", async () => {
    const source = createTestImage(96, 80)
    const restored = await fd2image_by_fft_v8(
        await image2fd_by_fft_v8(source, TEST_PASSWORD),
        TEST_PASSWORD
    )

    expect(calculatePSNR(restored, source)).toBeGreaterThan(34)
    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.98)
})

test("v8 使用错误密码时不应恢复出有效图像", async () => {
    const source = createTestImage(96, 80)
    const carrier = await image2fd_by_fft_v8(source, TEST_PASSWORD)
    const restored = await fd2image_by_fft_v8(carrier, "错误密码")

    expect(calculateSSIM(restored, source)).toBeLessThan(0.3)
})

test("v8 未指定或传入空密码时应统一使用默认密码 qzrzz", async () => {
    const source = createTestImage(96, 80)
    const implicitCarrier = await image2fd_by_fft_v8(source)
    const explicitCarrier = await image2fd_by_fft_v8(source, "qzrzz")

    expect(implicitCarrier.data).toEqual(explicitCarrier.data)
    const restored = await fd2image_by_fft_v8(implicitCarrier, "")
    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.98)
})

test("v8 PNG 合成导致 alpha 标记丢失后仍应恢复无损增强层", async () => {
    const source = createTestImage(96, 80)
    const carrier = await image2fd_by_fft_v8(source, TEST_PASSWORD)
    for (let offset = 3; offset < carrier.data.length; offset += 4) {
        carrier.data[offset] = 255
    }
    const restored = await fd2image_by_fft_v8(carrier, TEST_PASSWORD)

    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.98)
})

test("v8 的浏览器 4:2:0 JPEG Q70 基础层应保留可辨识结构", async () => {
    const source = createTestImage(96, 80)
    const restored = await fd2image_by_fft_v8(
        transcodeBrowserLikeJpeg(await image2fd_by_fft_v8(source, TEST_PASSWORD), 70),
        TEST_PASSWORD
    )

    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.8)
})

test("v8 载体按全图 MCU 对齐并经过浏览器 4:2:0 后应可恢复", async () => {
    const source = createTestImage(96, 80)
    const carrier = await image2fd_by_fft_v8(source, TEST_PASSWORD)
    const restored = await fd2image_by_fft_v8(
        transcodeEmbeddedCarrier(carrier, 32, 16, 70),
        TEST_PASSWORD
    )

    expect(calculatePSNR(restored, source)).toBeGreaterThan(18)
    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.8)
})

test("v8 通过专用缩放函数改变尺寸后应重新编码局部频谱并保持结构", async () => {
    const source = createTestImage(96, 80)
    const targetWidth = 47
    const targetHeight = 39
    const restored = await fd2image_by_fft_v8(
        await scale_fd_by_fft_v8(
            await image2fd_by_fft_v8(source, TEST_PASSWORD),
            targetWidth,
            targetHeight,
            TEST_PASSWORD
        ),
        TEST_PASSWORD
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(restored.width).toBe(targetWidth)
    expect(restored.height).toBe(targetHeight)
    expect(calculateSSIM(restored, reference)).toBeGreaterThan(0.93)
})

test("v8 载体被用户直接非整数缩放后应自动识别尺度并恢复", async () => {
    const source = createTestImage(96, 80)
    const targetWidth = 77
    const targetHeight = 64
    const restored = await fd2image_by_fft_v8(
        resize_image(await image2fd_by_fft_v8(source, TEST_PASSWORD), targetWidth, targetHeight),
        TEST_PASSWORD
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(restored.width).toBe(targetWidth)
    expect(restored.height).toBe(targetHeight)
    expect(calculateSSIM(restored, reference)).toBeGreaterThan(0.7)
})

test("v8 载体被用户直接放大后应自动识别尺度并恢复", async () => {
    const source = createTestImage(96, 80)
    const targetWidth = 120
    const targetHeight = 100
    const restored = await fd2image_by_fft_v8(
        resize_image(await image2fd_by_fft_v8(source, TEST_PASSWORD), targetWidth, targetHeight),
        TEST_PASSWORD
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(calculateSSIM(restored, reference)).toBeGreaterThan(0.9)
})

test("v8 直接缩放后的尺寸仍可被 8 整除时也必须根据导频恢复", async () => {
    const source = createTestImage(120, 160)
    const targetWidth = 96
    const targetHeight = 128
    const restored = await fd2image_by_fft_v8(
        resize_image(
            await image2fd_by_fft_v8(source, TEST_PASSWORD),
            targetWidth,
            targetHeight
        ),
        TEST_PASSWORD
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(calculateSSIM(restored, reference)).toBeGreaterThan(0.65)
})

test("v8 载体先被用户缩放再经浏览器 JPEG 后仍应保留结构", async () => {
    const source = createTestImage(96, 80)
    const targetWidth = 120
    const targetHeight = 100
    const carrier = resize_image(
        await image2fd_by_fft_v8(source, TEST_PASSWORD),
        targetWidth,
        targetHeight
    )
    const restored = await fd2image_by_fft_v8(
        transcodeBrowserLikeJpeg(carrier, 70),
        TEST_PASSWORD
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(calculateSSIM(restored, reference)).toBeGreaterThan(0.35)
})
