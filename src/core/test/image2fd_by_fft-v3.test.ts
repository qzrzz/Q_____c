import jpeg from "jpeg-js"
import {
    fd2image_by_fft,
    image2fd_by_fft,
    resize_image,
    type ImageDataLike,
} from "../image2fd_by_fft"
import {
    fd2image_by_fft_v3,
    image2fd_by_fft_v3,
    scale_fd_by_fft_v3,
} from "../image2fd_by_fft-v3"
import { calculatePSNR } from "./benchmarkFn"

/**
 * 创建同时包含渐变、边缘和高频纹理的测试图像。
 * @param width 图像宽度
 * @param height 图像高度
 */
function createTestImage(width: number, height: number): ImageDataLike {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4
            const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 28 : -28
            data[offset] = Math.max(0, Math.min(255, x * 2 + checker))
            data[offset + 1] = Math.max(0, Math.min(255, y * 2 + checker))
            data[offset + 2] = Math.max(0, Math.min(255, (x + y) * 1.2 - checker))
            data[offset + 3] = 255
        }
    }
    return { width, height, data }
}

/**
 * 对频域图执行一次内存 JPEG 编解码。
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

test("v3 经过 JPEG 压缩后的还原质量应明显优于 v1", async () => {
    const source = createTestImage(96, 80)
    const v1Restored = await fd2image_by_fft(
        transcodeJpeg(await image2fd_by_fft(source), 70)
    )
    const v3Restored = await fd2image_by_fft_v3(
        transcodeJpeg(await image2fd_by_fft_v3(source), 70)
    )

    expect(calculatePSNR(v3Restored, source)).toBeGreaterThan(
        calculatePSNR(v1Restored, source) + 4
    )
})

test("v3 应保持 v1 的中心频谱缩放能力并支持奇数目标尺寸", async () => {
    const source = createTestImage(96, 80)
    const targetWidth = 47
    const targetHeight = 39
    const scaledFd = scale_fd_by_fft_v3(
        await image2fd_by_fft_v3(source),
        targetWidth,
        targetHeight
    )
    const restored = await fd2image_by_fft_v3(scaledFd)
    const reference = resize_image(source, targetWidth, targetHeight)

    expect(restored.width).toBe(targetWidth)
    expect(restored.height).toBe(targetHeight)
    expect(calculatePSNR(restored, reference)).toBeGreaterThan(20)
})

test("v3 的 PNG 往返质量应维持在可用范围", async () => {
    const source = createTestImage(96, 80)
    const restored = await fd2image_by_fft_v3(await image2fd_by_fft_v3(source))

    expect(calculatePSNR(restored, source)).toBeGreaterThan(28)
})
