/**
 * 基于 v1 频谱裁剪模型的 JPEG 鲁棒频域图像变换。
 *
 * v3 保留 v1 的二维 DHT、中心频谱坐标和低频优先缩放逻辑，只替换频谱的
 * 8 位图像编码方式：
 * 1. 使用幂压缩降低 JPEG 像素误差在反解时的指数放大；
 * 2. 将最重要的中心低频系数复制到左上角的 4x4 对齐块；
 * 3. 解码时平均原始系数和冗余副本，抵消 JPEG 量化及块边界误差；
 * 4. 冗余区覆盖的最高频系数按零处理，避免副本被误认为真实频谱。
 */

import {
    createImageDataLike,
    dht2D,
    fftShift,
    idht2D,
    ifftShift,
    type ImageDataLike,
} from "./image2fd_by_fft"

const CHANNEL_COUNT = 4
const COLOR_CHANNEL_COUNT = 3
const MAX_PIXEL_VALUE = 255
const PIXEL_CENTER = 128
const PIXEL_HALF_RANGE = 127

/** PNG 路径保留该标记；经过 JPEG 后解码器会将 alpha 恢复为 255。 */
const FREQUENCY_ALPHA = 254

/** 幂压缩指数，在 8 位精度与 JPEG 扰动容忍度之间取得平衡。 */
const FREQUENCY_COMPRESSION_EXPONENT = 0.38

/** JPEG 路径中未受冗余保护频谱的保留比例，用于压低量化噪声。 */
const JPEG_UNPROTECTED_FREQUENCY_GAIN = 0.5

/** 每个受保护低频系数在冗余区占用的正方形块边长。 */
const REDUNDANCY_BLOCK_SIZE = 4

/** 受保护低频区域的横向尺寸占比。 */
const PROTECTED_WIDTH_DIVISOR = 16

/** 受保护低频区域的纵向尺寸占比。 */
const PROTECTED_HEIGHT_DIVISOR = 8

interface RedundancyLayout {
    protectedX: number
    protectedY: number
    protectedWidth: number
    protectedHeight: number
    storageWidth: number
    storageHeight: number
}

/**
 * 校验图像尺寸是否有效。
 * @param width 图像宽度
 * @param height 图像高度
 */
function assertValidDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new RangeError(`图像尺寸必须是正整数，当前为 ${width}x${height}`)
    }
}

/**
 * 校验图像缓冲区长度是否与尺寸一致。
 * @param image 图像数据
 */
function assertValidImageData(image: ImageDataLike): void {
    assertValidDimensions(image.width, image.height)
    const expectedLength = image.width * image.height * CHANNEL_COUNT
    if (image.data.length !== expectedLength) {
        throw new RangeError(
            `像素缓冲区长度必须为 ${expectedLength}，当前为 ${image.data.length}`
        )
    }
}

/**
 * 将数值限制到 8 位像素通道范围。
 * @param value 待限制的数值
 */
function clampByte(value: number): number {
    return Math.max(0, Math.min(MAX_PIXEL_VALUE, Math.round(value)))
}

/**
 * 获取当前尺寸下 DHT 系数的安全幅值上限。
 * @param width 图像宽度
 * @param height 图像高度
 */
function getFrequencyBound(width: number, height: number): number {
    return MAX_PIXEL_VALUE * width * height
}

/**
 * 计算当前尺寸的低频保护区与冗余存储区。
 * @param width 频域图宽度
 * @param height 频域图高度
 */
function createRedundancyLayout(width: number, height: number): RedundancyLayout | null {
    const protectedWidth = Math.floor(width / PROTECTED_WIDTH_DIVISOR)
    const protectedHeight = Math.floor(height / PROTECTED_HEIGHT_DIVISOR)
    if (protectedWidth === 0 || protectedHeight === 0) return null

    const storageWidth = protectedWidth * REDUNDANCY_BLOCK_SIZE
    const storageHeight = protectedHeight * REDUNDANCY_BLOCK_SIZE
    const protectedX = Math.floor((width - protectedWidth) / 2)
    const protectedY = Math.floor((height - protectedHeight) / 2)

    // 极端长宽比下若两个区域相交，则停用冗余，避免覆盖关键低频。
    const overlapsHorizontally = storageWidth > protectedX
    const overlapsVertically = storageHeight > protectedY
    if (overlapsHorizontally && overlapsVertically) return null

    return {
        protectedX,
        protectedY,
        protectedWidth,
        protectedHeight,
        storageWidth,
        storageHeight,
    }
}

/**
 * 将有符号频域系数编码为 8 位幂压缩码字。
 * @param value 频域系数
 * @param bound 当前尺寸下的频域幅值上限
 */
function encodeFrequencyValue(value: number, bound: number): number {
    if (!Number.isFinite(value) || value === 0) return PIXEL_CENTER

    const normalizedMagnitude = Math.min(1, Math.abs(value) / bound)
    const compressed = Math.pow(normalizedMagnitude, FREQUENCY_COMPRESSION_EXPONENT)
    return clampByte(PIXEL_CENTER + Math.sign(value) * compressed * PIXEL_HALF_RANGE)
}

/**
 * 将 8 位幂压缩码字还原为有符号频域系数。
 * @param value 编码后的像素值
 * @param bound 当前尺寸下的频域幅值上限
 */
function decodeFrequencyValue(value: number, bound: number): number {
    const signedValue = (value - PIXEL_CENTER) / PIXEL_HALF_RANGE
    if (signedValue === 0) return 0

    const magnitude = Math.pow(
        Math.min(1, Math.abs(signedValue)),
        1 / FREQUENCY_COMPRESSION_EXPONENT
    )
    return Math.sign(signedValue) * magnitude * bound
}

/**
 * 将中心频谱的关键低频码字复制到 JPEG 友好的 4x4 冗余块。
 * @param image 待写入冗余信息的频域图
 * @param layout 冗余布局
 */
function writeRedundantCoefficients(
    image: ImageDataLike,
    layout: RedundancyLayout
): void {
    const { width, data } = image
    for (let py = 0; py < layout.protectedHeight; py++) {
        for (let px = 0; px < layout.protectedWidth; px++) {
            const sourceOffset =
                ((layout.protectedY + py) * width + layout.protectedX + px) * CHANNEL_COUNT

            for (let blockY = 0; blockY < REDUNDANCY_BLOCK_SIZE; blockY++) {
                for (let blockX = 0; blockX < REDUNDANCY_BLOCK_SIZE; blockX++) {
                    const targetOffset =
                        ((py * REDUNDANCY_BLOCK_SIZE + blockY) * width +
                            px * REDUNDANCY_BLOCK_SIZE +
                            blockX) *
                        CHANNEL_COUNT
                    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                        data[targetOffset + channel] = data[sourceOffset + channel]
                    }
                }
            }
        }
    }
}

/**
 * 从原始位置和冗余块平均读取受保护低频码字。
 * @param image 输入频域图
 * @param layout 冗余布局
 * @param px 保护区内横坐标
 * @param py 保护区内纵坐标
 * @param channel 颜色通道序号
 */
function readAveragedProtectedValue(
    image: ImageDataLike,
    layout: RedundancyLayout,
    px: number,
    py: number,
    channel: number
): number {
    const { width, data } = image
    const sourceOffset =
        ((layout.protectedY + py) * width + layout.protectedX + px) * CHANNEL_COUNT
    let sum = data[sourceOffset + channel]
    let count = 1

    for (let blockY = 0; blockY < REDUNDANCY_BLOCK_SIZE; blockY++) {
        for (let blockX = 0; blockX < REDUNDANCY_BLOCK_SIZE; blockX++) {
            const copyOffset =
                ((py * REDUNDANCY_BLOCK_SIZE + blockY) * width +
                    px * REDUNDANCY_BLOCK_SIZE +
                    blockX) *
                    CHANNEL_COUNT +
                channel
            sum += data[copyOffset]
            count++
        }
    }
    return sum / count
}

/**
 * 将三个中心频谱通道编码为 v3 频域图。
 * @param channels RGB 三个频谱通道
 * @param width 频谱宽度
 * @param height 频谱高度
 */
function encodeFrequencyImage(
    channels: readonly Float64Array[],
    width: number,
    height: number
): ImageDataLike {
    const output = createImageDataLike(width, height)
    const bound = getFrequencyBound(width, height)

    for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex++) {
        const offset = pixelIndex * CHANNEL_COUNT
        for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
            output.data[offset + channel] = encodeFrequencyValue(
                channels[channel][pixelIndex],
                bound
            )
        }
        output.data[offset + 3] = FREQUENCY_ALPHA
    }

    const layout = createRedundancyLayout(width, height)
    if (layout) writeRedundantCoefficients(output, layout)
    return output
}

/**
 * 从 v3 频域图恢复三个中心频谱通道。
 * @param image v3 频域图
 */
function decodeFrequencyChannels(image: ImageDataLike): Float64Array[] {
    const { width, height, data } = image
    const bound = getFrequencyBound(width, height)
    const layout = createRedundancyLayout(width, height)
    const wasTranscodedByJpeg = data[3] === MAX_PIXEL_VALUE
    const channels = Array.from(
        { length: COLOR_CHANNEL_COUNT },
        () => new Float64Array(width * height)
    )

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixelIndex = y * width + x
            const inStorage = layout && x < layout.storageWidth && y < layout.storageHeight
            const isProtected =
                layout &&
                x >= layout.protectedX &&
                x < layout.protectedX + layout.protectedWidth &&
                y >= layout.protectedY &&
                y < layout.protectedY + layout.protectedHeight
            for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                if (inStorage) {
                    channels[channel][pixelIndex] = 0
                    continue
                }

                const decoded = decodeFrequencyValue(
                    data[pixelIndex * CHANNEL_COUNT + channel],
                    bound
                )
                channels[channel][pixelIndex] =
                    wasTranscodedByJpeg && layout && !isProtected
                        ? decoded * JPEG_UNPROTECTED_FREQUENCY_GAIN
                        : decoded
            }
        }
    }

    if (layout) {
        for (let py = 0; py < layout.protectedHeight; py++) {
            for (let px = 0; px < layout.protectedWidth; px++) {
                const pixelIndex =
                    (layout.protectedY + py) * width + layout.protectedX + px
                for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                    const averaged = readAveragedProtectedValue(
                        image,
                        layout,
                        px,
                        py,
                        channel
                    )
                    channels[channel][pixelIndex] = decodeFrequencyValue(averaged, bound)
                }
            }
        }
    }
    return channels
}

/**
 * 将目标中心频谱坐标映射到源频谱坐标。
 * @param index 目标坐标
 * @param sourceSize 源尺寸
 * @param targetSize 目标尺寸
 */
function mapCenteredFrequencyIndex(
    index: number,
    sourceSize: number,
    targetSize: number
): number {
    return Math.floor(sourceSize / 2) + index - Math.floor(targetSize / 2)
}

/**
 * 按 v1 的低频优先规则裁剪或补零中心频谱。
 * @param source 源频谱
 * @param sourceWidth 源宽度
 * @param sourceHeight 源高度
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
function resizeCenteredFrequency(
    source: Float64Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
): Float64Array {
    const target = new Float64Array(targetWidth * targetHeight)
    const scale = (targetWidth * targetHeight) / (sourceWidth * sourceHeight)

    for (let y = 0; y < targetHeight; y++) {
        const sourceY = mapCenteredFrequencyIndex(y, sourceHeight, targetHeight)
        if (sourceY < 0 || sourceY >= sourceHeight) continue

        for (let x = 0; x < targetWidth; x++) {
            const sourceX = mapCenteredFrequencyIndex(x, sourceWidth, targetWidth)
            if (sourceX < 0 || sourceX >= sourceWidth) continue
            target[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX] * scale
        }
    }
    return target
}

/**
 * 将原始图像转换为 JPEG 鲁棒的 v3 频域图像。
 * @param imageData 原始图像像素数据
 */
export async function image2fd_by_fft_v3(imageData: ImageDataLike): Promise<ImageDataLike> {
    assertValidImageData(imageData)
    const { width, height, data } = imageData
    const channels: Float64Array[] = []

    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const spatial = new Float64Array(width * height)
        for (let pixelIndex = 0; pixelIndex < spatial.length; pixelIndex++) {
            spatial[pixelIndex] = data[pixelIndex * CHANNEL_COUNT + channel]
        }
        channels.push(fftShift(dht2D(spatial, width, height), width, height))
    }
    return encodeFrequencyImage(channels, width, height)
}

/**
 * 按 v1 的中心低频裁剪规则缩放 v3 频域图像。
 * @param fdImage v3 频域图像
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
export function scale_fd_by_fft_v3(
    fdImage: ImageDataLike,
    targetWidth: number,
    targetHeight: number
): ImageDataLike {
    assertValidImageData(fdImage)
    assertValidDimensions(targetWidth, targetHeight)
    if (fdImage.width === targetWidth && fdImage.height === targetHeight) return fdImage

    const sourceChannels = decodeFrequencyChannels(fdImage)
    const targetChannels = sourceChannels.map((source) =>
        resizeCenteredFrequency(
            source,
            fdImage.width,
            fdImage.height,
            targetWidth,
            targetHeight
        )
    )
    return encodeFrequencyImage(targetChannels, targetWidth, targetHeight)
}

/**
 * 将 v3 频域图像逆变换为空间域图像。
 * @param fdImageData v3 频域图像像素数据
 */
export async function fd2image_by_fft_v3(
    fdImageData: ImageDataLike
): Promise<ImageDataLike> {
    assertValidImageData(fdImageData)
    const { width, height } = fdImageData
    const output = createImageDataLike(width, height)
    const channels = decodeFrequencyChannels(fdImageData)

    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const restored = idht2D(ifftShift(channels[channel], width, height), width, height)
        for (let pixelIndex = 0; pixelIndex < restored.length; pixelIndex++) {
            output.data[pixelIndex * CHANNEL_COUNT + channel] = clampByte(restored[pixelIndex])
        }
    }

    for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex++) {
        output.data[pixelIndex * CHANNEL_COUNT + 3] = MAX_PIXEL_VALUE
    }
    return output
}
