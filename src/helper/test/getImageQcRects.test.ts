import { getImageQcRects } from "../getImageQcRects"
import type { ImageDataLike } from "../../core/image2fd_by_fft"
import { image2fd_by_fft_v6 } from "../../core/image2fd_by_fft-v6"
import { image2fd_by_fft_v8c } from "../../core/image2fd_by_fft-v8c"
import jpeg from "jpeg-js"

/**
 * 创建带有一个模拟频域区域的测试图像。
 * @param width 图像宽度
 * @param height 图像高度
 * @param rect 频域区域
 */
function createFrequencyPatchImage(
    width: number,
    height: number,
    rect: { x: number; y: number; width: number; height: number }
): ImageDataLike {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4
            const inside =
                x >= rect.x &&
                x < rect.x + rect.width &&
                y >= rect.y &&
                y < rect.y + rect.height
            if (inside) {
                const variation = ((x * 7 + y * 11) % 21) - 10
                data[offset] = 128 + variation
                data[offset + 1] = 128 + variation
                data[offset + 2] = 128 + variation
            } else {
                data[offset] = (x * 5 + 40) % 256
                data[offset + 1] = (y * 7 + 90) % 256
                data[offset + 2] = (x * 3 + y * 5 + 170) % 256
            }
            data[offset + 3] = 255
        }
    }
    return { width, height, data }
}

/**
 * 创建经过低质量 JPEG 编码的真实 v6 载体测试图像。
 * @param width 图像宽度
 * @param height 图像高度
 * @param rect 频域区域
 * @param quality JPEG 质量
 */
async function createJpegCarrierImage(
    width: number,
    height: number,
    rect: { x: number; y: number; width: number; height: number },
    quality: number
): Promise<ImageDataLike> {
    const sourceData = new Uint8ClampedArray(rect.width * rect.height * 4)
    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            const offset = (y * rect.width + x) * 4
            // 低振幅渐变会生成容易被 JPEG 压低纹理的载体，用于覆盖最不利情况。
            const value = 118 + Math.round(x / 24) + Math.round(y / 24)
            sourceData[offset] = value
            sourceData[offset + 1] = value
            sourceData[offset + 2] = value
            sourceData[offset + 3] = 255
        }
    }
    const carrier = await image2fd_by_fft_v6({
        width: rect.width,
        height: rect.height,
        data: sourceData,
    })
    const image = createFrequencyPatchImage(width, height, rect)
    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            const sourceOffset = (y * rect.width + x) * 4
            const targetOffset = ((rect.y + y) * width + rect.x + x) * 4
            image.data[targetOffset] = carrier.data[sourceOffset]
            image.data[targetOffset + 1] = carrier.data[sourceOffset + 1]
            image.data[targetOffset + 2] = carrier.data[sourceOffset + 2]
        }
    }
    const encoded = jpeg.encode(image, quality)
    return jpeg.decode(encoded.data, { useTArray: true })
}

/**
 * 创建嵌入自然背景的高色度 v8c 载体测试图像。
 * @param width 图像宽度
 * @param height 图像高度
 * @param rect 频域区域
 */
async function createColorCarrierImage(
    width: number,
    height: number,
    rect: { x: number; y: number; width: number; height: number }
): Promise<ImageDataLike> {
    const source = createFrequencyPatchImage(rect.width, rect.height, {
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
    })
    const carrier = await image2fd_by_fft_v8c(source, "彩色区域识别测试")
    const image = createFrequencyPatchImage(width, height, rect)
    for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
        const sourceOffset = (y * rect.width + x) * 4
        const targetOffset = ((rect.y + y) * width + rect.x + x) * 4
        image.data[targetOffset] = carrier.data[sourceOffset]
        image.data[targetOffset + 1] = carrier.data[sourceOffset + 1]
        image.data[targetOffset + 2] = carrier.data[sourceOffset + 2]
        image.data[targetOffset + 3] = carrier.data[sourceOffset + 3]
    }
    return image
}

test("能够仅根据 RGB 视觉特征精确识别频域矩形", () => {
    const expected = { x: 37, y: 29, width: 96, height: 72 }
    const image = createFrequencyPatchImage(180, 130, expected)

    const rects = getImageQcRects(image)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toMatchObject(expected)
    expect(rects[0].confidence).toBeGreaterThan(0.9)
})

test("不会因为区域较小而直接漏掉 48 像素矩形", () => {
    const expected = { x: 21, y: 17, width: 48, height: 48 }
    const image = createFrequencyPatchImage(120, 100, expected)

    const rects = getImageQcRects(image)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toMatchObject(expected)
})

test("低质量 JPEG 不会让载体边界吸附到内部 8 像素周期", async () => {
    const expected = { x: 37, y: 29, width: 96, height: 72 }
    const image = await createJpegCarrierImage(180, 130, expected, 50)

    const rects = getImageQcRects(image)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toMatchObject(expected)
})

test("能够识别充分利用色度空间的 v8c 区域", async () => {
    const expected = { x: 37, y: 29, width: 96, height: 72 }
    const image = await createColorCarrierImage(180, 130, expected)

    const rects = getImageQcRects(image)

    expect(rects).toHaveLength(1)
    expect(rects[0]).toMatchObject(expected)
})
