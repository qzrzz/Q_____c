import jpeg from "jpeg-js"
import { resize_image, type ImageDataLike } from "../image2fd_by_fft"
import {
    fd2image_by_fft_v5,
    image2fd_by_fft_v5,
    scale_fd_by_fft_v5,
} from "../image2fd_by_fft-v5"
import { calculatePSNR, calculateSSIM } from "./benchmarkFn"

/**
 * 创建具有渐变、颜色和边缘结构的测试图像。
 * @param width 图像宽度
 * @param height 图像高度
 */
function createTestImage(width: number, height: number): ImageDataLike {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4
            const edge = (Math.floor(x / 10) + Math.floor(y / 9)) % 2 === 0 ? 20 : -20
            data[offset] = Math.max(0, Math.min(255, x * 1.8 + edge))
            data[offset + 1] = Math.max(0, Math.min(255, y * 2.2 - edge))
            data[offset + 2] = Math.max(0, Math.min(255, (x + y) * 1.15 + edge))
            data[offset + 3] = 255
        }
    }
    return { width, height, data }
}

/**
 * 执行一次内存 JPEG 编解码。
 * @param image 待转码图像
 * @param quality JPEG 质量
 */
function transcodeJpeg(image: ImageDataLike, quality: number): ImageDataLike {
    const encoded = jpeg.encode(
        {
            width: image.width,
            height: image.height,
            data: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
        },
        quality
    )
    const decoded = jpeg.decode(encoded.data, { useTArray: true })
    return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8ClampedArray(
            decoded.data.buffer,
            decoded.data.byteOffset,
            decoded.data.byteLength
        ),
    }
}

test("v5 的 PNG 路径应恢复基础层和增强层", async () => {
    const source = createTestImage(96, 80)
    const restored = await fd2image_by_fft_v5(await image2fd_by_fft_v5(source))

    expect(calculatePSNR(restored, source)).toBeGreaterThan(25)
})

test("v5 的 JPEG Q70 基础层应保持稳定结构", async () => {
    const source = createTestImage(96, 80)
    const restored = await fd2image_by_fft_v5(
        transcodeJpeg(await image2fd_by_fft_v5(source), 70)
    )

    expect(calculatePSNR(restored, source)).toBeGreaterThan(18)
    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.55)
})

test("v5 应通过解码与重新编码支持奇数尺寸缩放", async () => {
    const source = createTestImage(96, 80)
    const targetWidth = 47
    const targetHeight = 39
    const restored = await fd2image_by_fft_v5(
        scale_fd_by_fft_v5(await image2fd_by_fft_v5(source), targetWidth, targetHeight)
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(restored.width).toBe(targetWidth)
    expect(restored.height).toBe(targetHeight)
    expect(calculateSSIM(restored, reference)).toBeGreaterThan(0.65)
})
