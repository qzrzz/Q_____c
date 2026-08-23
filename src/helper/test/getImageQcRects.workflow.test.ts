import { resize_image, type ImageDataLike } from "../../core/image2fd_by_fft"
import {
    fd2image_by_fft_v6,
    image2fd_by_fft_v6,
} from "../../core/image2fd_by_fft-v6"
import {
    fd2image_by_fft_v7,
    image2fd_by_fft_v7,
} from "../../core/image2fd_by_fft-v7"
import {
    fd2image_by_fft_v8,
    image2fd_by_fft_v8,
} from "../../core/image2fd_by_fft-v8"
import {
    calculateSSIM,
    readImageFile,
    transcodeBrowserLikeJpeg,
} from "../../core/test/benchmarkFn"
import { getImageQcRects, type ImageQcRect } from "../getImageQcRects"

interface TestRect {
    x: number
    y: number
    width: number
    height: number
}

interface CarrierAlgorithm {
    name: string
    encode: (image: ImageDataLike) => Promise<ImageDataLike>
    decode: (image: ImageDataLike) => Promise<ImageDataLike>
}

interface UserWorkflow {
    name: string
    scale: number
    jpegQuality: number
    tolerance: number
    minimumSsim: number
}

interface SavedRegion extends TestRect {
    source: ImageDataLike
}

interface MatchedRegion {
    actual: ImageQcRect
    expected: SavedRegion
}

const MCU_SIZE = 16
const RECT_GAP = 32
const MIN_RECT_SIZE = 96
const V8_TEST_PASSWORD = "v8-editor-workflow"

const SAMPLE_CASES = [
    { path: "sample/截图.png", rectCount: 1, seed: 0x1357_2468 },
    { path: "sample/插画.JPG", rectCount: 2, seed: 0x2468_1357 },
    { path: "sample/照片.jpg", rectCount: 3, seed: 0x5a17_c9e3 },
] as const

const ALGORITHMS: CarrierAlgorithm[] = [
    {
        name: "v6",
        encode: image2fd_by_fft_v6,
        decode: fd2image_by_fft_v6,
    },
    {
        name: "v7",
        encode: image2fd_by_fft_v7,
        decode: fd2image_by_fft_v7,
    },
    {
        name: "v8",
        encode: (image) => image2fd_by_fft_v8(image, V8_TEST_PASSWORD),
        decode: (image) => fd2image_by_fft_v8(image, V8_TEST_PASSWORD),
    },
]

const USER_WORKFLOWS: UserWorkflow[] = [
    {
        name: "整图 JPEG Q80",
        scale: 1,
        jpegQuality: 80,
        tolerance: 2,
        minimumSsim: 0.7,
    },
    {
        name: "整图缩放 0.8x 后 JPEG Q80",
        scale: 0.8,
        jpegQuality: 80,
        tolerance: 6,
        minimumSsim: 0.3,
    },
]

/**
 * 创建可复现的伪随机数生成器。
 * @param seed 随机种子
 */
function createRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state += 0x6d2b_79f5
        let value = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
    }
}

/**
 * 获取闭区间内按指定步长对齐的随机整数。
 * @param random 随机数生成器
 * @param minimum 最小值
 * @param maximum 最大值
 * @param step 对齐步长
 */
function randomAlignedInteger(
    random: () => number,
    minimum: number,
    maximum: number,
    step: number
): number {
    const first = Math.ceil(minimum / step)
    const last = Math.floor(maximum / step)
    return (first + Math.floor(random() * (last - first + 1))) * step
}

/**
 * 判断两个矩形在增加安全间距后是否相交。
 * @param left 第一个矩形
 * @param right 第二个矩形
 * @param gap 安全间距
 */
function rectsOverlap(left: TestRect, right: TestRect, gap: number): boolean {
    return !(
        left.x + left.width + gap <= right.x ||
        right.x + right.width + gap <= left.x ||
        left.y + left.height + gap <= right.y ||
        right.y + right.height + gap <= left.y
    )
}

/**
 * 生成指定数量、互不重叠且对齐 JPEG MCU 网格的随机矩形。
 * @param width 图像宽度
 * @param height 图像高度
 * @param count 矩形数量
 * @param seed 随机种子
 */
function createRandomRects(
    width: number,
    height: number,
    count: number,
    seed: number
): TestRect[] {
    const random = createRandom(seed)
    const maximumWidth = Math.max(
        MIN_RECT_SIZE,
        Math.floor(Math.min(320, width * 0.36) / MCU_SIZE) * MCU_SIZE
    )
    const maximumHeight = Math.max(
        MIN_RECT_SIZE,
        Math.floor(Math.min(320, height * 0.36) / MCU_SIZE) * MCU_SIZE
    )
    const rects: TestRect[] = []
    for (let attempt = 0; attempt < 1000 && rects.length < count; attempt++) {
        const rectWidth = randomAlignedInteger(
            random,
            MIN_RECT_SIZE,
            maximumWidth,
            MCU_SIZE
        )
        const rectHeight = randomAlignedInteger(
            random,
            MIN_RECT_SIZE,
            maximumHeight,
            MCU_SIZE
        )
        const rect: TestRect = {
            x: randomAlignedInteger(random, 0, width - rectWidth, MCU_SIZE),
            y: randomAlignedInteger(random, 0, height - rectHeight, MCU_SIZE),
            width: rectWidth,
            height: rectHeight,
        }
        if (rects.every((existing) => !rectsOverlap(existing, rect, RECT_GAP))) {
            rects.push(rect)
        }
    }
    if (rects.length !== count) {
        throw new Error(`无法在 ${width}x${height} 图像中生成 ${count} 个互不重叠的矩形`)
    }
    return rects
}

/**
 * 裁剪图像中的指定矩形。
 * @param image 输入图像
 * @param rect 裁剪区域
 */
function cropImage(image: ImageDataLike, rect: TestRect): ImageDataLike {
    const data = new Uint8ClampedArray(rect.width * rect.height * 4)
    for (let y = 0; y < rect.height; y++) {
        const sourceOffset = ((rect.y + y) * image.width + rect.x) * 4
        const targetOffset = y * rect.width * 4
        data.set(
            image.data.subarray(sourceOffset, sourceOffset + rect.width * 4),
            targetOffset
        )
    }
    return { width: rect.width, height: rect.height, data }
}

/**
 * 将一张图像覆盖到目标图像的指定位置。
 * @param target 目标图像
 * @param source 覆盖图像
 * @param x 横坐标
 * @param y 纵坐标
 */
function pasteImage(
    target: ImageDataLike,
    source: ImageDataLike,
    x: number,
    y: number
): void {
    for (let row = 0; row < source.height; row++) {
        const sourceOffset = row * source.width * 4
        const targetOffset = ((y + row) * target.width + x) * 4
        target.data.set(
            source.data.subarray(sourceOffset, sourceOffset + source.width * 4),
            targetOffset
        )
    }
}

/**
 * 模拟用户直接缩放并保存整张已打码图片的真实流程。
 * @param image 原始整图
 * @param regions 已保存的原始区域
 * @param algorithm 载体算法
 * @param workflow 用户处理流程
 */
async function applyUserWorkflow(
    image: ImageDataLike,
    regions: SavedRegion[],
    algorithm: CarrierAlgorithm,
    workflow: UserWorkflow
): Promise<ImageDataLike> {
    const encoded = {
        width: image.width,
        height: image.height,
        data: new Uint8ClampedArray(image.data),
    }
    for (let index = 0; index < regions.length; index++) {
        const carrier = await algorithm.encode(regions[index].source)
        pasteImage(encoded, carrier, regions[index].x, regions[index].y)
    }
    const output = workflow.scale === 1
        ? encoded
        : resize_image(
              encoded,
              Math.round(image.width * workflow.scale),
              Math.round(image.height * workflow.scale)
          )
    return transcodeBrowserLikeJpeg(output, workflow.jpegQuality)
}

/**
 * 根据整图的实际缩放尺寸换算期望矩形。
 * @param rect 原始矩形
 * @param sourceWidth 原图宽度
 * @param sourceHeight 原图高度
 * @param targetWidth 处理后宽度
 * @param targetHeight 处理后高度
 */
function scaleExpectedRect(
    rect: TestRect,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
): TestRect {
    const scaleX = targetWidth / sourceWidth
    const scaleY = targetHeight / sourceHeight
    const left = Math.round(rect.x * scaleX)
    const top = Math.round(rect.y * scaleY)
    const right = Math.round((rect.x + rect.width) * scaleX)
    const bottom = Math.round((rect.y + rect.height) * scaleY)
    return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 按从上到下、从左到右的顺序排列矩形。
 * @param rects 待排序矩形
 */
function sortRects<T extends TestRect>(rects: T[]): T[] {
    return [...rects].sort((left, right) => left.y - right.y || left.x - right.x)
}

/**
 * 校验识别矩形数量和四条边位置。
 * @param actual 实际识别结果
 * @param expected 期望矩形
 * @param tolerance 边界容差
 */
function expectRectsToMatch(
    actual: ImageQcRect[],
    expected: SavedRegion[],
    tolerance: number
): MatchedRegion[] {
    const sortedActual = sortRects(actual)
    const sortedExpected = sortRects(expected)
    expect(sortedActual, `识别结果：${JSON.stringify(sortedActual)}`).toHaveLength(
        sortedExpected.length
    )
    for (let index = 0; index < sortedExpected.length; index++) {
        const actualRect = sortedActual[index]
        const expectedRect = sortedExpected[index]
        const context = `第 ${index + 1} 个矩形，期望 ${JSON.stringify(expectedRect)}，实际 ${JSON.stringify(actualRect)}`
        expect(
            Math.abs(actualRect.x - expectedRect.x),
            `${context}，左边界`
        ).toBeLessThanOrEqual(tolerance)
        expect(
            Math.abs(actualRect.y - expectedRect.y),
            `${context}，顶边界`
        ).toBeLessThanOrEqual(tolerance)
        expect(
            Math.abs(actualRect.x + actualRect.width - expectedRect.x - expectedRect.width),
            `${context}，右边界`
        ).toBeLessThanOrEqual(tolerance)
        expect(
            Math.abs(actualRect.y + actualRect.height - expectedRect.y - expectedRect.height),
            `${context}，底边界`
        ).toBeLessThanOrEqual(tolerance)
    }
    return sortedActual.map((actualRect, index) => ({
        actual: actualRect,
        expected: sortedExpected[index],
    }))
}

for (const sampleCase of SAMPLE_CASES) {
    for (const algorithm of ALGORITHMS) {
        for (const workflow of USER_WORKFLOWS) {
            const workflowTest = workflow.scale === 1 ? test : test.fails
            const limitation = workflow.scale === 1
                ? "能识别并正确解码"
                : "记录整图直接缩放后有损转码的已知失败"
            workflowTest(`${sampleCase.path} 使用 ${algorithm.name} 写入 ${sampleCase.rectCount} 个随机区域，${workflow.name} 后${limitation}`, async () => {
                const source = readImageFile(sampleCase.path).image
                const expectedBeforeProcessing = createRandomRects(
                    source.width,
                    source.height,
                    sampleCase.rectCount,
                    sampleCase.seed
                )
                const savedRegions = expectedBeforeProcessing.map((rect) => ({
                    ...rect,
                    source: cropImage(source, rect),
                }))
                const processed = await applyUserWorkflow(
                    source,
                    savedRegions,
                    algorithm,
                    workflow
                )
                const expected = savedRegions.map((region) => ({
                    ...scaleExpectedRect(
                        region,
                        source.width,
                        source.height,
                        processed.width,
                        processed.height
                    ),
                    source: region.source,
                }))

                const matched = expectRectsToMatch(
                    getImageQcRects(processed),
                    expected,
                    workflow.tolerance
                )
                for (const region of matched) {
                    const carrier = cropImage(processed, region.actual)
                    const position = {
                        carrierX: region.actual.x,
                        carrierY: region.actual.y,
                    }
                    const decoded = algorithm.name === "v7"
                        ? await fd2image_by_fft_v7(carrier, position)
                        : algorithm.name === "v8"
                          ? await fd2image_by_fft_v8(
                                carrier,
                                V8_TEST_PASSWORD,
                                position
                            )
                          : await algorithm.decode(carrier)
                    const reference = resize_image(
                        region.expected.source,
                        decoded.width,
                        decoded.height
                    )
                    const ssim = calculateSSIM(decoded, reference)
                    expect(
                        ssim,
                        `${sampleCase.path} ${algorithm.name} ${workflow.name} 解码区域 ${JSON.stringify(region.actual)} 的 SSIM`
                    ).toBeGreaterThanOrEqual(workflow.minimumSsim)
                }
            })
        }
    }
}
