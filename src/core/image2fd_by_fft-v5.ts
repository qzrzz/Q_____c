/**
 * 分层载体式频域图像编码。
 *
 * v5 从编码层重新设计，不再把单个频谱系数直接映射成单个易受损像素：
 * - 每个 4x4 载体块的均值保存一个低频基础层系数，可抵抗 JPEG 量化；
 * - 三个零均值正交纹理保存三个中频增强层系数；
 * - PNG 路径恢复基础层和增强层；
 * - JPEG 会丢失 alpha 标记，解码器据此只恢复可靠的块均值基础层。
 *
 * 这种设计用确定性的低通损失替代随机高频噪声，使 JPEG 后的还原结果
 * 保持稳定结构，不再出现 v1-v4 中明显的全屏彩色频谱噪声。
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

/** JPEG 编码会丢弃该 alpha 标记并在解码时恢复为 255。 */
const LAYERED_FREQUENCY_ALPHA = 253

/** 载体块边长；4x4 块在 JPEG 8x8 单元内仍能保持稳定均值。 */
const CARRIER_BLOCK_SIZE = 4

/** 每个载体块保存的增强层系数数量。 */
const ENHANCEMENT_COUNT_PER_BLOCK = 3

/** 增强层纹理幅度，兼顾 PNG 精度与 JPEG 基础层均值稳定性。 */
const ENHANCEMENT_STRENGTH = 0.25

/** 频谱系数的幂压缩指数。 */
const FREQUENCY_COMPRESSION_EXPONENT = 0.38

interface CarrierLayout {
    blockColumns: number
    blockRows: number
    basePositions: Uint32Array
    enhancementPositions: Uint32Array
}

/**
 * 计算从完整保留到截止值的余弦软过渡增益。
 * @param radius 归一化半径
 * @param passRadius 完整保留半径
 * @param stopRadius 完全截止半径
 * @param stopGain 截止处保留增益
 */
function calculateCosineGain(
    radius: number,
    passRadius: number,
    stopRadius: number,
    stopGain: number
): number {
    if (radius <= passRadius) return 1
    if (radius >= stopRadius) return stopGain
    const progress = (radius - passRadius) / (stopRadius - passRadius)
    const blend = (1 + Math.cos(Math.PI * progress)) / 2
    return stopGain + (1 - stopGain) * blend
}

/**
 * 对 JPEG 基础层执行亮度/色度分离的径向软截止。
 * @param channels RGB 三个中心频谱通道
 * @param width 频谱宽度
 * @param height 频谱高度
 * @param baseWidth 基础层频谱宽度
 * @param baseHeight 基础层频谱高度
 */
function stabilizeJpegSpectrum(
    channels: Float64Array[],
    width: number,
    height: number,
    baseWidth: number,
    baseHeight: number
): void {
    const centerX = Math.floor(width / 2)
    const centerY = Math.floor(height / 2)
    const radiusX = Math.max(1, baseWidth / 2)
    const radiusY = Math.max(1, baseHeight / 2)

    for (let y = 0; y < height; y++) {
        const dy = (y - centerY) / radiusY
        for (let x = 0; x < width; x++) {
            const dx = (x - centerX) / radiusX
            const radius = Math.hypot(dx, dy) / Math.SQRT2
            const index = y * width + x
            const red = channels[0][index]
            const green = channels[1][index]
            const blue = channels[2][index]

            const luminance = 0.299 * red + 0.587 * green + 0.114 * blue
            const chromaBlue = -0.168736 * red - 0.331264 * green + 0.5 * blue
            const chromaRed = 0.5 * red - 0.418688 * green - 0.081312 * blue
            const luminanceGain = calculateCosineGain(radius, 0.68, 1, 0.2)
            const chromaGain = calculateCosineGain(radius, 0.35, 0.9, 0)
            const filteredLuminance = luminance * luminanceGain
            const filteredChromaBlue = chromaBlue * chromaGain
            const filteredChromaRed = chromaRed * chromaGain

            channels[0][index] = filteredLuminance + 1.402 * filteredChromaRed
            channels[1][index] =
                filteredLuminance -
                0.344136 * filteredChromaBlue -
                0.714136 * filteredChromaRed
            channels[2][index] = filteredLuminance + 1.772 * filteredChromaBlue
        }
    }
}

/**
 * 校验图像尺寸。
 * @param width 图像宽度
 * @param height 图像高度
 */
function assertValidDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new RangeError(`图像尺寸必须是正整数，当前为 ${width}x${height}`)
    }
}

/**
 * 校验图像像素缓冲区。
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
 * 将数值限制到 8 位通道范围。
 * @param value 待限制的数值
 */
function clampByte(value: number): number {
    return Math.max(0, Math.min(MAX_PIXEL_VALUE, Math.round(value)))
}

/**
 * 获取当前尺寸的频谱安全幅值上限。
 * @param width 图像宽度
 * @param height 图像高度
 */
function getFrequencyBound(width: number, height: number): number {
    return MAX_PIXEL_VALUE * width * height
}

/**
 * 将频谱系数编码为幂压缩码字。
 * @param value 频谱系数
 * @param bound 频谱安全幅值上限
 */
function encodeFrequencyValue(value: number, bound: number): number {
    if (!Number.isFinite(value) || value === 0) return PIXEL_CENTER
    const magnitude = Math.min(1, Math.abs(value) / bound)
    return clampByte(
        PIXEL_CENTER +
            Math.sign(value) *
                Math.pow(magnitude, FREQUENCY_COMPRESSION_EXPONENT) *
                PIXEL_HALF_RANGE
    )
}

/**
 * 将幂压缩码字还原为频谱系数。
 * @param value 频谱码字
 * @param bound 频谱安全幅值上限
 */
function decodeFrequencyValue(value: number, bound: number): number {
    const signedValue = (value - PIXEL_CENTER) / PIXEL_HALF_RANGE
    if (signedValue === 0) return 0
    return (
        Math.sign(signedValue) *
        Math.pow(
            Math.min(1, Math.abs(signedValue)),
            1 / FREQUENCY_COMPRESSION_EXPONENT
        ) *
        bound
    )
}

/**
 * 创建中心矩形内的行优先频谱位置。
 * @param imageWidth 图像宽度
 * @param imageHeight 图像高度
 * @param regionWidth 区域宽度
 * @param regionHeight 区域高度
 */
function createCenteredPositions(
    imageWidth: number,
    imageHeight: number,
    regionWidth: number,
    regionHeight: number
): Uint32Array {
    const startX = Math.floor((imageWidth - regionWidth) / 2)
    const startY = Math.floor((imageHeight - regionHeight) / 2)
    const positions = new Uint32Array(regionWidth * regionHeight)
    let positionIndex = 0
    for (let y = 0; y < regionHeight; y++) {
        for (let x = 0; x < regionWidth; x++) {
            positions[positionIndex++] = (startY + y) * imageWidth + startX + x
        }
    }
    return positions
}

/**
 * 创建基础层与增强层的频谱映射布局。
 * @param width 频域图宽度
 * @param height 频域图高度
 */
function createCarrierLayout(width: number, height: number): CarrierLayout {
    const blockColumns = Math.floor(width / CARRIER_BLOCK_SIZE)
    const blockRows = Math.floor(height / CARRIER_BLOCK_SIZE)
    const baseWidth = blockColumns
    const baseHeight = blockRows
    const enhancementWidth = Math.floor(width / 2)
    const enhancementHeight = Math.floor(height / 2)
    const basePositions = createCenteredPositions(width, height, baseWidth, baseHeight)
    const expandedPositions = createCenteredPositions(
        width,
        height,
        enhancementWidth,
        enhancementHeight
    )

    const baseStartX = Math.floor((width - baseWidth) / 2)
    const baseStartY = Math.floor((height - baseHeight) / 2)
    const baseEndX = baseStartX + baseWidth
    const baseEndY = baseStartY + baseHeight
    const enhancement: number[] = []
    const maximumEnhancementCount =
        basePositions.length * ENHANCEMENT_COUNT_PER_BLOCK

    for (const position of expandedPositions) {
        const x = position % width
        const y = Math.floor(position / width)
        const isInBase =
            x >= baseStartX && x < baseEndX && y >= baseStartY && y < baseEndY
        if (!isInBase && enhancement.length < maximumEnhancementCount) {
            enhancement.push(position)
        }
    }

    return {
        blockColumns,
        blockRows,
        basePositions,
        enhancementPositions: Uint32Array.from(enhancement),
    }
}

/**
 * 获取三个正交增强纹理在块内指定位置的符号。
 * @param patternIndex 增强纹理序号
 * @param x 块内横坐标
 * @param y 块内纵坐标
 */
function getEnhancementPattern(patternIndex: number, x: number, y: number): number {
    const horizontal = x < CARRIER_BLOCK_SIZE / 2 ? 1 : -1
    const vertical = y < CARRIER_BLOCK_SIZE / 2 ? 1 : -1
    if (patternIndex === 0) return horizontal
    if (patternIndex === 1) return vertical
    return horizontal * vertical
}

/**
 * 将三个中心频谱通道编码为分层 4x4 载体图。
 * @param channels 三个中心频谱通道
 * @param width 频谱宽度
 * @param height 频谱高度
 */
function encodeCarrierImage(
    channels: readonly Float64Array[],
    width: number,
    height: number
): ImageDataLike {
    const output = createImageDataLike(width, height)
    const layout = createCarrierLayout(width, height)
    const bound = getFrequencyBound(width, height)

    // 未被完整 4x4 块覆盖的边缘统一使用零码字，避免产生无定义内容。
    for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex++) {
        const offset = pixelIndex * CHANNEL_COUNT
        output.data[offset] = PIXEL_CENTER
        output.data[offset + 1] = PIXEL_CENTER
        output.data[offset + 2] = PIXEL_CENTER
        output.data[offset + 3] = LAYERED_FREQUENCY_ALPHA
    }

    for (let blockIndex = 0; blockIndex < layout.basePositions.length; blockIndex++) {
        const blockX = (blockIndex % layout.blockColumns) * CARRIER_BLOCK_SIZE
        const blockY = Math.floor(blockIndex / layout.blockColumns) * CARRIER_BLOCK_SIZE

        for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
            const baseCode = encodeFrequencyValue(
                channels[channel][layout.basePositions[blockIndex]],
                bound
            )
            const enhancementDeltas = new Float64Array(ENHANCEMENT_COUNT_PER_BLOCK)
            for (
                let enhancementIndex = 0;
                enhancementIndex < ENHANCEMENT_COUNT_PER_BLOCK;
                enhancementIndex++
            ) {
                const position =
                    layout.enhancementPositions[
                        blockIndex * ENHANCEMENT_COUNT_PER_BLOCK + enhancementIndex
                    ]
                if (position === undefined) continue
                enhancementDeltas[enhancementIndex] =
                    encodeFrequencyValue(channels[channel][position], bound) - PIXEL_CENTER
            }

            for (let y = 0; y < CARRIER_BLOCK_SIZE; y++) {
                for (let x = 0; x < CARRIER_BLOCK_SIZE; x++) {
                    let value = baseCode
                    for (
                        let patternIndex = 0;
                        patternIndex < ENHANCEMENT_COUNT_PER_BLOCK;
                        patternIndex++
                    ) {
                        value +=
                            ENHANCEMENT_STRENGTH *
                            enhancementDeltas[patternIndex] *
                            getEnhancementPattern(patternIndex, x, y)
                    }
                    const offset =
                        ((blockY + y) * width + blockX + x) * CHANNEL_COUNT + channel
                    output.data[offset] = clampByte(value)
                }
            }
        }
    }
    return output
}

/**
 * 从分层载体图恢复中心频谱通道。
 * @param image 分层频域载体图
 */
function decodeCarrierChannels(image: ImageDataLike): Float64Array[] {
    const { width, height, data } = image
    const layout = createCarrierLayout(width, height)
    const bound = getFrequencyBound(width, height)
    const hasEnhancementLayer = data[3] === LAYERED_FREQUENCY_ALPHA
    const channels = Array.from(
        { length: COLOR_CHANNEL_COUNT },
        () => new Float64Array(width * height)
    )

    for (let blockIndex = 0; blockIndex < layout.basePositions.length; blockIndex++) {
        const blockX = (blockIndex % layout.blockColumns) * CARRIER_BLOCK_SIZE
        const blockY = Math.floor(blockIndex / layout.blockColumns) * CARRIER_BLOCK_SIZE

        for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
            let blockSum = 0
            const projections = new Float64Array(ENHANCEMENT_COUNT_PER_BLOCK)
            for (let y = 0; y < CARRIER_BLOCK_SIZE; y++) {
                for (let x = 0; x < CARRIER_BLOCK_SIZE; x++) {
                    const value =
                        data[((blockY + y) * width + blockX + x) * CHANNEL_COUNT + channel]
                    blockSum += value
                    if (hasEnhancementLayer) {
                        for (
                            let patternIndex = 0;
                            patternIndex < ENHANCEMENT_COUNT_PER_BLOCK;
                            patternIndex++
                        ) {
                            projections[patternIndex] +=
                                value * getEnhancementPattern(patternIndex, x, y)
                        }
                    }
                }
            }

            const baseCode = blockSum / (CARRIER_BLOCK_SIZE * CARRIER_BLOCK_SIZE)
            channels[channel][layout.basePositions[blockIndex]] = decodeFrequencyValue(
                baseCode,
                bound
            )

            if (!hasEnhancementLayer) continue
            for (
                let enhancementIndex = 0;
                enhancementIndex < ENHANCEMENT_COUNT_PER_BLOCK;
                enhancementIndex++
            ) {
                const position =
                    layout.enhancementPositions[
                        blockIndex * ENHANCEMENT_COUNT_PER_BLOCK + enhancementIndex
                    ]
                if (position === undefined) continue
                const enhancementCode =
                    PIXEL_CENTER +
                    projections[enhancementIndex] /
                        (CARRIER_BLOCK_SIZE *
                            CARRIER_BLOCK_SIZE *
                            ENHANCEMENT_STRENGTH)
                channels[channel][position] = decodeFrequencyValue(
                    enhancementCode,
                    bound
                )
            }
        }
    }
    if (!hasEnhancementLayer) {
        stabilizeJpegSpectrum(
            channels,
            width,
            height,
            layout.blockColumns,
            layout.blockRows
        )
    }
    return channels
}

/**
 * 将目标中心频谱坐标映射到源中心频谱坐标。
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
 * 按中心低频优先规则裁剪或补零频谱。
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
 * 将原始图像转换为分层 JPEG 鲁棒频域载体图。
 * @param imageData 原始图像像素数据
 */
export async function image2fd_by_fft_v5(imageData: ImageDataLike): Promise<ImageDataLike> {
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
    return encodeCarrierImage(channels, width, height)
}

/**
 * 解码、裁剪并重新编码 v5 频谱，实现抗缩放路径。
 * @param fdImage v5 频域载体图
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
export function scale_fd_by_fft_v5(
    fdImage: ImageDataLike,
    targetWidth: number,
    targetHeight: number
): ImageDataLike {
    assertValidImageData(fdImage)
    assertValidDimensions(targetWidth, targetHeight)
    if (fdImage.width === targetWidth && fdImage.height === targetHeight) return fdImage

    const sourceChannels = decodeCarrierChannels(fdImage)
    const targetChannels = sourceChannels.map((source) =>
        resizeCenteredFrequency(
            source,
            fdImage.width,
            fdImage.height,
            targetWidth,
            targetHeight
        )
    )
    return encodeCarrierImage(targetChannels, targetWidth, targetHeight)
}

/**
 * 将 v5 分层频域载体图逆变换为空间域图像。
 * @param fdImageData v5 频域载体图
 */
export async function fd2image_by_fft_v5(
    fdImageData: ImageDataLike
): Promise<ImageDataLike> {
    assertValidImageData(fdImageData)
    const { width, height } = fdImageData
    const output = createImageDataLike(width, height)
    const channels = decodeCarrierChannels(fdImageData)

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
