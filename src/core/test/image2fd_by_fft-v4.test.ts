import jpeg from "jpeg-js"
import { resize_image, type ImageDataLike } from "../image2fd_by_fft"
import {
    fd2image_by_fft_v3,
    image2fd_by_fft_v3,
    scale_fd_by_fft_v3,
} from "../image2fd_by_fft-v3"
import {
    fd2image_by_fft_v4,
    image2fd_by_fft_v4,
    scale_fd_by_fft_v4,
} from "../image2fd_by_fft-v4"
import { calculatePSNR } from "./benchmarkFn"

/**
 * 创建包含渐变和规则边缘的测试图像。
 * @param width 图像宽度
 * @param height 图像高度
 */
function createTestImage(width: number, height: number): ImageDataLike {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4
            const edge = (Math.floor(x / 12) + Math.floor(y / 10)) % 2 === 0 ? 24 : -24
            data[offset] = Math.max(0, Math.min(255, x * 1.7 + edge))
            data[offset + 1] = Math.max(0, Math.min(255, y * 2.1 - edge))
            data[offset + 2] = Math.max(0, Math.min(255, (x + y) * 1.1 + edge))
            data[offset + 3] = 255
        }
    }
    return { width, height, data }
}

/**
 * 对频域图执行内存 JPEG 编解码。
 * @param image 频域图
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

test("v4 的三级冗余在 JPEG Q70 下应达到稳定可用质量", async () => {
    const source = createTestImage(128, 96)
    const restored = await fd2image_by_fft_v4(
        transcodeJpeg(await image2fd_by_fft_v4(source), 70)
    )

    expect(calculatePSNR(restored, source)).toBeGreaterThan(18)
})

test("v4 不应显著低于同一测试图的 v3 JPEG 质量", async () => {
    const source = createTestImage(128, 96)
    const v3 = await fd2image_by_fft_v3(
        transcodeJpeg(await image2fd_by_fft_v3(source), 70)
    )
    const v4 = await fd2image_by_fft_v4(
        transcodeJpeg(await image2fd_by_fft_v4(source), 70)
    )

    expect(calculatePSNR(v4, source)).toBeGreaterThanOrEqual(
        calculatePSNR(v3, source) - 0.5
    )
})

test("v4 应支持奇数尺寸的中心频谱缩放", async () => {
    const source = createTestImage(128, 96)
    const targetWidth = 63
    const targetHeight = 47
    const restored = await fd2image_by_fft_v4(
        scale_fd_by_fft_v4(await image2fd_by_fft_v4(source), targetWidth, targetHeight)
    )
    const v3Restored = await fd2image_by_fft_v3(
        scale_fd_by_fft_v3(await image2fd_by_fft_v3(source), targetWidth, targetHeight)
    )
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(restored.width).toBe(targetWidth)
    expect(restored.height).toBe(targetHeight)
    expect(calculatePSNR(restored, reference)).toBeGreaterThanOrEqual(
        calculatePSNR(v3Restored, reference) - 0.1
    )
})
