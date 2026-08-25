import { type ImageDataLike } from "../image2fd_by_fft"
import {
    fd2image_by_fft_v8c,
    image2fd_by_fft_v8c,
} from "../image2fd_by_fft-v8c"
import { calculateSSIM, transcodeBrowserLikeJpeg } from "./benchmarkFn"

const TEST_PASSWORD = "主人-v8c-测试密码"

/** 创建包含渐变、边缘和色彩变化的测试图像。 @param width 宽度 @param height 高度 */
function createColorTestImage(width: number, height: number): ImageDataLike {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4
        const tile = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 24 : -24
        data[offset] = Math.max(0, Math.min(255, x * 2.1 + tile))
        data[offset + 1] = Math.max(0, Math.min(255, y * 2.5 - tile))
        data[offset + 2] = Math.max(0, Math.min(255, (width - x + y) * 1.4 + tile))
        data[offset + 3] = 255
    }
    return { width, height, data }
}

/** 计算载体 RGB 的平均饱和度。 @param image 输入图像 */
function calculateAverageSaturation(image: ImageDataLike): number {
    let saturation = 0
    for (let offset = 0; offset < image.data.length; offset += 4) {
        saturation += Math.max(
            image.data[offset], image.data[offset + 1], image.data[offset + 2]
        ) - Math.min(image.data[offset], image.data[offset + 1], image.data[offset + 2])
    }
    return saturation / (image.width * image.height)
}

test("v8c 应生成明显有颜色且可高质量逆向的 PNG 载体", async () => {
    const source = createColorTestImage(96, 80)
    const carrier = await image2fd_by_fft_v8c(source, TEST_PASSWORD)
    const restored = await fd2image_by_fft_v8c(carrier, TEST_PASSWORD)

    expect(calculateAverageSaturation(carrier)).toBeGreaterThan(30)
    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.96)
})

test("v8c PNG 合成丢失 alpha 标记后仍应恢复增强层", async () => {
    const source = createColorTestImage(96, 80)
    const carrier = await image2fd_by_fft_v8c(source, TEST_PASSWORD)
    for (let offset = 3; offset < carrier.data.length; offset += 4) carrier.data[offset] = 255
    const restored = await fd2image_by_fft_v8c(carrier, TEST_PASSWORD)

    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.96)
})

test("v8c 使用错误密码时不应恢复有效图像", async () => {
    const source = createColorTestImage(96, 80)
    const carrier = await image2fd_by_fft_v8c(source, TEST_PASSWORD)
    const restored = await fd2image_by_fft_v8c(carrier, "错误密码")

    expect(calculateSSIM(restored, source)).toBeLessThan(0.3)
})

test("v8c 经高质量 JPEG 后应保留可辨识结构", async () => {
    const source = createColorTestImage(96, 80)
    const carrier = await image2fd_by_fft_v8c(source, TEST_PASSWORD)
    const restored = await fd2image_by_fft_v8c(
        transcodeBrowserLikeJpeg(carrier, 90),
        TEST_PASSWORD
    )

    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.4)
})

test("v8c 经 JPEG Q70 后仍应依靠亮度基础层恢复结构", async () => {
    const source = createColorTestImage(96, 80)
    const restored = await fd2image_by_fft_v8c(
        transcodeBrowserLikeJpeg(await image2fd_by_fft_v8c(source, TEST_PASSWORD), 70),
        TEST_PASSWORD
    )

    expect(calculateSSIM(restored, source)).toBeGreaterThan(0.3)
})
