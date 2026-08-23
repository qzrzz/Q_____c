/**
 * 基于 v3 的多级 JPEG 不等强度保护频域变换。
 *
 * v4 沿用 v1/v3 的 DHT、中心频谱和缩放模型，并按频率重要性分配冗余：
 * - 中低频区域：2x2 副本；
 * - 低频区域：额外叠加 v3 的 4x4 副本；
 * - 极低频区域：再叠加 8x8 完整 JPEG 块副本。
 * JPEG 解码后使用截尾平均排除振铃异常值，并只衰减未受保护的频谱。
 */

import { type ImageDataLike } from "./image2fd_by_fft"
import {
    fd2image_by_fft_v3,
    image2fd_by_fft_v3,
    scale_fd_by_fft_v3,
} from "./image2fd_by_fft-v3"

const CHANNEL_COUNT = 4
const COLOR_CHANNEL_COUNT = 3
const MAX_PIXEL_VALUE = 255
const PIXEL_CENTER = 128
const FREQUENCY_ALPHA = 254
const FREQUENCY_COMPRESSION_EXPONENT = 0.38
const JPEG_UNPROTECTED_FREQUENCY_GAIN = 0.5

const OUTER_BLOCK_SIZE = 2
const INNER_BLOCK_SIZE = 4
const CORE_BLOCK_SIZE = 8

interface ProtectedRegion {
    x: number
    y: number
    width: number
    height: number
}

interface StorageRegion extends ProtectedRegion {
    blockSize: number
}

interface V4Layout {
    outer: ProtectedRegion
    inner: ProtectedRegion
    core: ProtectedRegion
    outerStorage: StorageRegion
    innerStorage: StorageRegion
    coreStorage: StorageRegion
}

/**
 * 校验图像尺寸与像素缓冲区。
 * @param image 图像数据
 */
function assertValidImageData(image: ImageDataLike): void {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height)) {
        throw new RangeError(`图像尺寸必须为整数，当前为 ${image.width}x${image.height}`)
    }
    if (image.width <= 0 || image.height <= 0) {
        throw new RangeError(`图像尺寸必须为正数，当前为 ${image.width}x${image.height}`)
    }
    const expectedLength = image.width * image.height * CHANNEL_COUNT
    if (image.data.length !== expectedLength) {
        throw new RangeError(
            `像素缓冲区长度必须为 ${expectedLength}，当前为 ${image.data.length}`
        )
    }
}

/**
 * 校验目标尺寸。
 * @param width 目标宽度
 * @param height 目标高度
 */
function assertValidDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new RangeError(`图像尺寸必须是正整数，当前为 ${width}x${height}`)
    }
}

/**
 * 创建以中心零频为基准的保护区域。
 * @param imageWidth 图像宽度
 * @param imageHeight 图像高度
 * @param widthDivisor 区域宽度除数
 * @param heightDivisor 区域高度除数
 */
function createCenteredRegion(
    imageWidth: number,
    imageHeight: number,
    widthDivisor: number,
    heightDivisor: number
): ProtectedRegion {
    const width = Math.floor(imageWidth / widthDivisor)
    const height = Math.floor(imageHeight / heightDivisor)
    return {
        x: Math.floor((imageWidth - width) / 2),
        y: Math.floor((imageHeight - height) / 2),
        width,
        height,
    }
}

/**
 * 创建 v4 的三级保护与互不重叠的冗余存储布局。
 * @param width 频域图宽度
 * @param height 频域图高度
 */
function createV4Layout(width: number, height: number): V4Layout | null {
    const outer = createCenteredRegion(width, height, 8, 8)
    const inner = createCenteredRegion(width, height, 16, 8)
    const core = createCenteredRegion(width, height, 64, 32)
    if (core.width === 0 || core.height === 0) return null

    const innerStorage: StorageRegion = {
        x: 0,
        y: 0,
        width: inner.width * INNER_BLOCK_SIZE,
        height: inner.height * INNER_BLOCK_SIZE,
        blockSize: INNER_BLOCK_SIZE,
    }
    const coreStorage: StorageRegion = {
        x: innerStorage.width,
        y: 0,
        width: core.width * CORE_BLOCK_SIZE,
        height: core.height * CORE_BLOCK_SIZE,
        blockSize: CORE_BLOCK_SIZE,
    }
    const outerStorage: StorageRegion = {
        x: width - outer.width * OUTER_BLOCK_SIZE,
        y: 0,
        width: outer.width * OUTER_BLOCK_SIZE,
        height: outer.height * OUTER_BLOCK_SIZE,
        blockSize: OUTER_BLOCK_SIZE,
    }

    if (
        coreStorage.x + coreStorage.width > outerStorage.x ||
        innerStorage.height > height ||
        outerStorage.x < 0
    ) {
        return null
    }
    return { outer, inner, core, outerStorage, innerStorage, coreStorage }
}

/**
 * 判断坐标是否位于指定区域。
 * @param x 横坐标
 * @param y 纵坐标
 * @param region 待判断区域
 */
function containsPoint(x: number, y: number, region: ProtectedRegion): boolean {
    return (
        x >= region.x &&
        x < region.x + region.width &&
        y >= region.y &&
        y < region.y + region.height
    )
}

/**
 * 获取像素颜色通道偏移。
 * @param width 图像宽度
 * @param x 横坐标
 * @param y 纵坐标
 * @param channel 颜色通道序号
 */
function getChannelOffset(width: number, x: number, y: number, channel: number): number {
    return (y * width + x) * CHANNEL_COUNT + channel
}

/**
 * 将保护区域的码字复制到指定块存储区。
 * @param image 待写入的频域图
 * @param protectedRegion 源保护区域
 * @param storageRegion 目标冗余存储区域
 */
function writeRegionCopies(
    image: ImageDataLike,
    protectedRegion: ProtectedRegion,
    storageRegion: StorageRegion
): void {
    const { width, data } = image
    for (let py = 0; py < protectedRegion.height; py++) {
        for (let px = 0; px < protectedRegion.width; px++) {
            for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                const sourceValue =
                    data[
                        getChannelOffset(
                            width,
                            protectedRegion.x + px,
                            protectedRegion.y + py,
                            channel
                        )
                    ]
                for (let blockY = 0; blockY < storageRegion.blockSize; blockY++) {
                    for (let blockX = 0; blockX < storageRegion.blockSize; blockX++) {
                        const targetX = storageRegion.x + px * storageRegion.blockSize + blockX
                        const targetY = storageRegion.y + py * storageRegion.blockSize + blockY
                        data[getChannelOffset(width, targetX, targetY, channel)] = sourceValue
                    }
                }
            }
        }
    }
}

/**
 * 收集某个系数在指定冗余块中的全部副本。
 * @param image 输入频域图
 * @param values 待追加的码字列表
 * @param px 保护区域内横坐标
 * @param py 保护区域内纵坐标
 * @param channel 颜色通道序号
 * @param storageRegion 冗余存储区域
 */
function collectRegionCopies(
    image: ImageDataLike,
    values: number[],
    px: number,
    py: number,
    channel: number,
    storageRegion: StorageRegion
): void {
    for (let blockY = 0; blockY < storageRegion.blockSize; blockY++) {
        for (let blockX = 0; blockX < storageRegion.blockSize; blockX++) {
            const x = storageRegion.x + px * storageRegion.blockSize + blockX
            const y = storageRegion.y + py * storageRegion.blockSize + blockY
            values.push(image.data[getChannelOffset(image.width, x, y, channel)])
        }
    }
}

/**
 * 使用 10% 截尾平均聚合冗余码字，排除 JPEG 振铃产生的极端值。
 * @param values 待聚合的码字
 */
function calculateTrimmedMean(values: number[]): number {
    values.sort((a, b) => a - b)
    const trimCount = Math.floor(values.length * 0.1)
    const start = trimCount
    const end = values.length - trimCount
    let sum = 0
    for (let index = start; index < end; index++) sum += values[index]
    return sum / (end - start)
}

/**
 * 将指定区域全部重置为零频码字，避免冗余副本进入真实频谱。
 * @param image 待修改频域图
 * @param region 待清空区域
 */
function clearStorageRegion(image: ImageDataLike, region: ProtectedRegion): void {
    for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++) {
            const offset = getChannelOffset(image.width, x, y, 0)
            for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                image.data[offset + channel] = PIXEL_CENTER
            }
        }
    }
}

/**
 * 将 v3 频域图扩展为包含三级冗余的 v4 频域图。
 * @param image v3 频域图
 */
function addV4Redundancy(image: ImageDataLike): ImageDataLike {
    const layout = createV4Layout(image.width, image.height)
    if (!layout) return image

    // v3 已写入 inner 的 4x4 副本，此处增加外层和核心层副本。
    writeRegionCopies(image, layout.outer, layout.outerStorage)
    writeRegionCopies(image, layout.core, layout.coreStorage)
    return image
}

/**
 * 将 v4 频域图聚合为可交给 v3 核心解码器处理的频域图。
 * @param image v4 频域图
 */
function prepareForV3Decoder(image: ImageDataLike): ImageDataLike {
    const layout = createV4Layout(image.width, image.height)
    if (!layout) return image

    const output: ImageDataLike = {
        width: image.width,
        height: image.height,
        data: new Uint8ClampedArray(image.data),
    }
    const wasTranscodedByJpeg = image.data[3] === MAX_PIXEL_VALUE

    for (let py = 0; py < layout.outer.height; py++) {
        for (let px = 0; px < layout.outer.width; px++) {
            const x = layout.outer.x + px
            const y = layout.outer.y + py
            const inInner = containsPoint(x, y, layout.inner)
            const inCore = containsPoint(x, y, layout.core)

            for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                const values = [image.data[getChannelOffset(image.width, x, y, channel)]]
                collectRegionCopies(image, values, px, py, channel, layout.outerStorage)

                if (inInner) {
                    collectRegionCopies(
                        image,
                        values,
                        x - layout.inner.x,
                        y - layout.inner.y,
                        channel,
                        layout.innerStorage
                    )
                }
                if (inCore) {
                    collectRegionCopies(
                        image,
                        values,
                        x - layout.core.x,
                        y - layout.core.y,
                        channel,
                        layout.coreStorage
                    )
                }

                const aggregated = calculateTrimmedMean(values)
                output.data[getChannelOffset(output.width, x, y, channel)] = aggregated

                // v3 会再次读取 inner 的 4x4 区域，因此同步写成相同聚合值。
                if (inInner) {
                    const innerX = x - layout.inner.x
                    const innerY = y - layout.inner.y
                    for (let blockY = 0; blockY < INNER_BLOCK_SIZE; blockY++) {
                        for (let blockX = 0; blockX < INNER_BLOCK_SIZE; blockX++) {
                            const copyX =
                                layout.innerStorage.x + innerX * INNER_BLOCK_SIZE + blockX
                            const copyY =
                                layout.innerStorage.y + innerY * INNER_BLOCK_SIZE + blockY
                            output.data[
                                getChannelOffset(output.width, copyX, copyY, channel)
                            ] = aggregated
                        }
                    }
                }
            }
        }
    }

    clearStorageRegion(output, layout.outerStorage)
    clearStorageRegion(output, layout.coreStorage)

    if (wasTranscodedByJpeg) {
        const codeGain = Math.pow(
            JPEG_UNPROTECTED_FREQUENCY_GAIN,
            FREQUENCY_COMPRESSION_EXPONENT
        )
        for (let y = 0; y < output.height; y++) {
            for (let x = 0; x < output.width; x++) {
                if (containsPoint(x, y, layout.outer)) continue
                if (
                    containsPoint(x, y, layout.innerStorage) ||
                    containsPoint(x, y, layout.outerStorage) ||
                    containsPoint(x, y, layout.coreStorage)
                ) {
                    continue
                }

                const offset = getChannelOffset(output.width, x, y, 0)
                for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                    output.data[offset + channel] =
                        PIXEL_CENTER +
                        (output.data[offset + channel] - PIXEL_CENTER) * codeGain
                }
            }
        }
    }

    // 阻止 v3 再次执行固定 JPEG 衰减；v4 已完成分级恢复和选择性衰减。
    for (let pixelIndex = 0; pixelIndex < output.width * output.height; pixelIndex++) {
        output.data[pixelIndex * CHANNEL_COUNT + 3] = FREQUENCY_ALPHA
    }
    return output
}

/**
 * 将原始图像转换为三级 JPEG 鲁棒的 v4 频域图像。
 * @param imageData 原始图像像素数据
 */
export async function image2fd_by_fft_v4(imageData: ImageDataLike): Promise<ImageDataLike> {
    assertValidImageData(imageData)
    return addV4Redundancy(await image2fd_by_fft_v3(imageData))
}

/**
 * 按 v1/v3 的中心频谱裁剪模型缩放 v4 频域图像。
 * @param fdImage v4 频域图像
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
export function scale_fd_by_fft_v4(
    fdImage: ImageDataLike,
    targetWidth: number,
    targetHeight: number
): ImageDataLike {
    assertValidImageData(fdImage)
    assertValidDimensions(targetWidth, targetHeight)
    if (fdImage.width === targetWidth && fdImage.height === targetHeight) return fdImage

    const prepared = prepareForV3Decoder(fdImage)
    return addV4Redundancy(scale_fd_by_fft_v3(prepared, targetWidth, targetHeight))
}

/**
 * 将 v4 频域图像逆变换为空间域图像。
 * @param fdImageData v4 频域图像像素数据
 */
export async function fd2image_by_fft_v4(
    fdImageData: ImageDataLike
): Promise<ImageDataLike> {
    assertValidImageData(fdImageData)
    return fd2image_by_fft_v3(prepareForV3Decoder(fdImageData))
}
