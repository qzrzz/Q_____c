/**
 * v7 自同步局部 DHT 分层载体。
 * JPEG 基础层仅依赖载体亮度，每个 8x8 块保存 12 个 Y、2 个 Cb、2 个 Cr
 * 低频系数；PNG 增强层利用亮度正交的色差纹理再保存 96 个频谱系数。
 */
import { createImageDataLike, dht2D, idht2D, resize_image, type ImageDataLike } from "./image2fd_by_fft"

const CHANNEL_COUNT = 4
const COLOR_CHANNEL_COUNT = 3
const MAX_PIXEL_VALUE = 255
const PIXEL_CENTER = 128
const PIXEL_HALF_RANGE = 127
const LOCAL_BLOCK_SIZE = 8
const CARRIER_CELL_SIZE = 2
const CELL_COUNT = 16
const ENHANCEMENT_STRENGTH = 0.12
const FREQUENCY_COMPRESSION_EXPONENT = 0.38
const LOCAL_FREQUENCY_ALPHA = 252
const LOCAL_FREQUENCY_BOUND = MAX_PIXEL_VALUE * LOCAL_BLOCK_SIZE * LOCAL_BLOCK_SIZE
const WHITENING_PEDESTAL = 8
const SCALE_PILOT_PERIOD = 16
const SCALE_PILOT_AMPLITUDE = 7
const MIN_RAW_SCALE = 0.4
const MAX_RAW_SCALE = 2.5

interface CoefficientAssignment { channel: number; rank: number }

/** v7 解码时可选的载体全图位置信息。 */
export interface FdV7DecodeOptions {
    /** 识别区域在处理后整图中的横坐标。 */
    carrierX?: number
    /** 识别区域在处理后整图中的纵坐标。 */
    carrierY?: number
    /** 已知时可直接指定编码载体宽度，跳过导频尺寸估算。 */
    encodedWidth?: number
    /** 已知时可直接指定编码载体高度，跳过导频尺寸估算。 */
    encodedHeight?: number
}

interface AxisNormalization {
    scale: number
    phase: number
}

/** 按实际正负频率半径排列的 8x8 DHT 系数顺序。 */
const LOCAL_FREQUENCY_ORDER = Uint8Array.from(
    Array.from({ length: 64 }, (_, index) => index).sort((a, b) => {
        const ax = a % 8, ay = Math.floor(a / 8), bx = b % 8, by = Math.floor(b / 8)
        const afx = Math.min(ax, 8 - ax), afy = Math.min(ay, 8 - ay)
        const bfx = Math.min(bx, 8 - bx), bfy = Math.min(by, 8 - by)
        return afx * afx + afy * afy - bfx * bfx - bfy * bfy || a - b
    })
)

/** 灰度基础层优先保存亮度，同时为两路色差保留低频容量。 */
const BASE_ASSIGNMENTS: CoefficientAssignment[] = [
    ...Array.from({ length: 12 }, (_, rank) => ({ channel: 0, rank })),
    ...Array.from({ length: 2 }, (_, rank) => ({ channel: 1, rank })),
    ...Array.from({ length: 2 }, (_, rank) => ({ channel: 2, rank })),
]
const BASE_KEYS = new Set(BASE_ASSIGNMENTS.map(({ channel, rank }) => `${channel}:${rank}`))

/** PNG 增强层优先保留亮度细节，降低高频色差的优先级。 */
const ENHANCEMENT_ASSIGNMENTS: CoefficientAssignment[] = Array.from(
    { length: 192 }, (_, index) => ({ channel: Math.floor(index / 64), rank: index % 64 })
).filter(({ channel, rank }) => !BASE_KEYS.has(`${channel}:${rank}`)).sort((a, b) => {
    const scoreA = a.rank * (a.channel === 0 ? 1 : 1.55)
    const scoreB = b.rank * (b.channel === 0 ? 1 : 1.55)
    return scoreA - scoreB || a.channel - b.channel || a.rank - b.rank
}).slice(0, 96)

/** 校验图像数据。 @param image 图像数据 */
function assertValidImageData(image: ImageDataLike): void {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
        throw new RangeError(`图像尺寸必须是正整数，当前为 ${image.width}x${image.height}`)
    }
    const expected = image.width * image.height * CHANNEL_COUNT
    if (image.data.length !== expected) throw new RangeError(`像素缓冲区长度必须为 ${expected}，当前为 ${image.data.length}`)
}

/** 校验目标尺寸。 @param width 目标宽度 @param height 目标高度 */
function assertValidDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new RangeError(`图像尺寸必须是正整数，当前为 ${width}x${height}`)
    }
}

/** 将数值限制到 8 位范围。 @param value 待限制数值 */
function clampByte(value: number): number { return Math.max(0, Math.min(255, Math.round(value))) }

/** 将 RGB 转换为 YCbCr。 @param red 红色 @param green 绿色 @param blue 蓝色 */
function rgbToYcbcr(red: number, green: number, blue: number): [number, number, number] {
    return [
        0.299 * red + 0.587 * green + 0.114 * blue,
        128 - 0.168736 * red - 0.331264 * green + 0.5 * blue,
        128 + 0.5 * red - 0.418688 * green - 0.081312 * blue,
    ]
}

/** 将 YCbCr 转换为 RGB。 @param y 亮度 @param cb 蓝色色差 @param cr 红色色差 */
function ycbcrToRgb(y: number, cb: number, cr: number): [number, number, number] {
    cb -= 128; cr -= 128
    return [clampByte(y + 1.402 * cr), clampByte(y - 0.344136 * cb - 0.714136 * cr), clampByte(y + 1.772 * cb)]
}

/** 编码频谱系数。 @param value 系数 @param bound 幅值上限 */
function encodeFrequencyValue(value: number, bound: number): number {
    if (!Number.isFinite(value) || value === 0) return 128
    return clampByte(128 + Math.sign(value) * Math.pow(Math.min(1, Math.abs(value) / bound), FREQUENCY_COMPRESSION_EXPONENT) * 127)
}

/** 解码频谱系数。 @param value 码字 @param bound 幅值上限 */
function decodeFrequencyValue(value: number, bound: number): number {
    const signed = (value - 128) / 127
    return signed === 0 ? 0 : Math.sign(signed) * Math.pow(Math.min(1, Math.abs(signed)), 1 / FREQUENCY_COMPRESSION_EXPONENT) * bound
}

/** 获取单元正交纹理。 @param pattern 纹理序号 @param x 横坐标 @param y 纵坐标 */
function getCellPattern(pattern: number, x: number, y: number): number {
    const h = x === 0 ? 1 : -1, v = y === 0 ? 1 : -1
    return pattern === 0 ? h : pattern === 1 ? v : h * v
}

/** 生成与块坐标相关的稳定伪随机数。 @param blockX 块横坐标 @param blockY 块纵坐标 @param salt 用途编号 */
function getCarrierRandom(blockX: number, blockY: number, salt: number): number {
    let value =
        Math.imul(Math.floor(blockX / 8) + 1, 0x9e3779b1) ^
        Math.imul(Math.floor(blockY / 8) + 1, 0x85ebca77) ^
        Math.imul(salt + 1, 0xc2b2ae3d)
    value ^= value >>> 16
    value = Math.imul(value, 0x7feb352d)
    value ^= value >>> 15
    value = Math.imul(value, 0x846ca68b)
    return (value ^ (value >>> 16)) >>> 0
}

/** 为当前块生成 16 个单元的可逆置换。 @param blockX 块横坐标 @param blockY 块纵坐标 */
function createCellPermutation(blockX: number, blockY: number): Uint8Array {
    const permutation = new Uint8Array(CELL_COUNT)
    const mode = getCarrierRandom(blockX, blockY, 100) % 8
    for (let physical = 0; physical < CELL_COUNT; physical++) {
        let x = physical % 4
        let y = Math.floor(physical / 4)
        if (mode >= 4) x = 3 - x
        for (let rotation = 0; rotation < mode % 4; rotation++) {
            const previousX = x
            x = y
            y = 3 - previousX
        }
        permutation[physical] = y * 4 + x
    }
    return permutation
}

/** 获取码字符号白化因子。 @param blockX 块横坐标 @param blockY 块纵坐标 @param logicalCell 逻辑单元 @param salt 用途编号 */
function getCarrierSign(blockX: number, blockY: number, logicalCell: number, salt: number): number {
    const signSalt = salt === 0 ? 0 : logicalCell * 16 + salt
    return (getCarrierRandom(blockX, blockY, signSalt) & 1) === 0 ? 1 : -1
}

/**
 * 对码字施加带固定底噪的符号白化，使频谱幅度不再直接形成可见轮廓。
 * @param code 原始码字
 * @param carrierSign 载体伪随机符号
 */
function whitenFrequencyCode(code: number, carrierSign: number): number {
    const delta = code - PIXEL_CENTER
    const sourceSign = delta < 0 ? -1 : 1
    const magnitude =
        WHITENING_PEDESTAL +
        ((PIXEL_HALF_RANGE - WHITENING_PEDESTAL) * Math.abs(delta)) /
            PIXEL_HALF_RANGE
    return PIXEL_CENTER + carrierSign * sourceSign * magnitude
}

/**
 * 解除码字白化。
 * @param code 白化码字
 * @param carrierSign 载体伪随机符号
 */
function unwhitenFrequencyCode(code: number, carrierSign: number): number {
    const delta = code - PIXEL_CENTER
    const sourceSign = (delta < 0 ? -1 : 1) * carrierSign
    const magnitude = Math.max(
        0,
        ((Math.abs(delta) - WHITENING_PEDESTAL) * PIXEL_HALF_RANGE) /
            (PIXEL_HALF_RANGE - WHITENING_PEDESTAL)
    )
    return PIXEL_CENTER + sourceSign * magnitude
}

/** 获取指定坐标处的尺度导频值。 @param x 横坐标 @param y 纵坐标 */
function getScalePilot(x: number, y: number): number {
    const phaseX = (2 * Math.PI * (x + 0.5)) / SCALE_PILOT_PERIOD
    const phaseY = (2 * Math.PI * (y + 0.5)) / SCALE_PILOT_PERIOD
    return SCALE_PILOT_AMPLITUDE * (Math.sin(phaseX) + Math.sin(phaseY))
}

/** 向载体叠加尺度导频。 @param image 载体图像 */
function addScalePilot(image: ImageDataLike): void {
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * CHANNEL_COUNT
        const pilot = getScalePilot(x, y)
        for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
            image.data[offset + channel] = clampByte(image.data[offset + channel] + pilot)
        }
    }
}

/** 创建移除尺度导频后的载体副本。 @param image 已归一化到编码尺寸的载体 */
function removeScalePilot(image: ImageDataLike): ImageDataLike {
    const output = createImageDataLike(image.width, image.height)
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * CHANNEL_COUNT
        const pilot = getScalePilot(x, y)
        for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
            output.data[offset + channel] = clampByte(image.data[offset + channel] - pilot)
        }
        output.data[offset + 3] = image.data[offset + 3]
    }
    return output
}

/**
 * 提取横向或纵向的平均亮度投影。
 * @param image 载体图像
 * @param horizontal 是否提取横向投影
 */
function createLuminanceProjection(image: ImageDataLike, horizontal: boolean): Float64Array {
    const length = horizontal ? image.width : image.height
    const orthogonalLength = horizontal ? image.height : image.width
    const projection = new Float64Array(length)
    const step = Math.max(1, Math.floor(orthogonalLength / 128))
    let samples = 0
    for (let orthogonal = 0; orthogonal < orthogonalLength; orthogonal += step) {
        samples++
        for (let position = 0; position < length; position++) {
            const x = horizontal ? position : orthogonal
            const y = horizontal ? orthogonal : position
            const offset = (y * image.width + x) * CHANNEL_COUNT
            projection[position] +=
                0.299 * image.data[offset] +
                0.587 * image.data[offset + 1] +
                0.114 * image.data[offset + 2]
        }
    }
    const mean = projection.reduce((sum, value) => sum + value, 0) / (length * samples)
    for (let index = 0; index < length; index++) projection[index] = projection[index] / samples - mean
    return projection
}

/** 计算投影在指定周期上的归一化能量。 @param projection 亮度投影 @param period 周期 */
function calculatePilotEnergy(projection: Float64Array, period: number): number {
    let sine = 0
    let cosine = 0
    let energy = 0
    for (let index = 0; index < projection.length; index++) {
        const value = projection[index]
        const phase = (2 * Math.PI * (index + 0.5)) / period
        sine += value * Math.sin(phase)
        cosine += value * Math.cos(phase)
        energy += value * value
    }
    return (sine * sine + cosine * cosine) / Math.max(1, energy * projection.length)
}

/**
 * 从尺度导频估算某一轴的原始编码尺寸。
 * @param image 当前载体图像
 * @param horizontal 是否估算横轴
 */
function estimateEncodedAxisSize(image: ImageDataLike, horizontal: boolean): number {
    const currentSize = horizontal ? image.width : image.height
    const projection = createLuminanceProjection(image, horizontal)
    let bestScale = 1
    let bestEnergy = -Infinity
    for (let scale = MIN_RAW_SCALE; scale <= MAX_RAW_SCALE; scale += 0.01) {
        const energy = calculatePilotEnergy(projection, SCALE_PILOT_PERIOD * scale)
        if (energy > bestEnergy) {
            bestEnergy = energy
            bestScale = scale
        }
    }
    if (Math.abs(bestScale - 1) < 0.08) return currentSize
    const approximateSize = Math.max(1, Math.round(currentSize / bestScale))
    let bestSize = approximateSize
    for (let size = Math.max(1, approximateSize - 12); size <= approximateSize + 12; size++) {
        const period = (SCALE_PILOT_PERIOD * currentSize) / size
        const energy = calculatePilotEnergy(projection, period)
        if (energy > bestEnergy) {
            bestEnergy = energy
            bestSize = size
        }
    }
    return Math.max(LOCAL_BLOCK_SIZE, Math.round(bestSize / LOCAL_BLOCK_SIZE) * LOCAL_BLOCK_SIZE)
}

/**
 * 在浮点坐标处对图像进行双线性采样。
 * @param image 输入图像
 * @param x 横坐标
 * @param y 纵坐标
 */
function sampleImage(image: ImageDataLike, x: number, y: number): [number, number, number] {
    const clampedX = Math.max(0, Math.min(image.width - 1, x))
    const clampedY = Math.max(0, Math.min(image.height - 1, y))
    const x0 = Math.floor(clampedX), y0 = Math.floor(clampedY)
    const x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1)
    const wx = clampedX - x0, wy = clampedY - y0
    const result: [number, number, number] = [0, 0, 0]
    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const top =
            image.data[(y0 * image.width + x0) * 4 + channel] * (1 - wx) +
            image.data[(y0 * image.width + x1) * 4 + channel] * wx
        const bottom =
            image.data[(y1 * image.width + x0) * 4 + channel] * (1 - wx) +
            image.data[(y1 * image.width + x1) * 4 + channel] * wx
        result[channel] = top * (1 - wy) + bottom * wy
    }
    return result
}

/**
 * 利用编码区域原本按 16 像素对齐的约束，恢复整图缩放造成的裁剪相位。
 * @param currentSize 识别区域在处理后图片中的尺寸
 * @param encodedSize 编码时的区域尺寸
 * @param currentStart 识别区域在处理后整图中的起点
 */
function estimateAxisNormalization(
    currentSize: number,
    encodedSize: number,
    currentStart: number | undefined
): AxisNormalization {
    const nominalScale = currentSize / encodedSize
    if (currentStart === undefined || !Number.isFinite(currentStart)) {
        return { scale: nominalScale, phase: 0 }
    }

    const approximateSourceStart = currentStart / nominalScale
    const firstCandidate = Math.max(
        0,
        Math.round(approximateSourceStart / SCALE_PILOT_PERIOD) - 4
    )
    let bestScale = nominalScale
    let bestSourceStart = Math.round(approximateSourceStart / SCALE_PILOT_PERIOD) * SCALE_PILOT_PERIOD
    let bestScore = Infinity
    const currentEnd = currentStart + currentSize
    for (let index = firstCandidate; index <= firstCandidate + 8; index++) {
        const sourceStart = index * SCALE_PILOT_PERIOD
        const sourceEnd = sourceStart + encodedSize
        const scale =
            (currentStart * sourceStart + currentEnd * sourceEnd) /
            (sourceStart * sourceStart + sourceEnd * sourceEnd)
        if (scale < MIN_RAW_SCALE || scale > MAX_RAW_SCALE) continue
        const startError = currentStart - sourceStart * scale
        const endError = currentEnd - sourceEnd * scale
        const scaleError = (scale - nominalScale) * encodedSize
        const score = startError * startError + endError * endError + scaleError * scaleError * 0.05
        if (score < bestScore) {
            bestScore = score
            bestScale = scale
            bestSourceStart = sourceStart
        }
    }
    return {
        scale: bestScale,
        phase: currentStart / bestScale - bestSourceStart,
    }
}

/**
 * 将任意缩放后的载体按原始 2x2 码元积分回编码网格。
 * 缩放会破坏 RGB 增强纹理，因此这里只重建 JPEG 基础层所需的码元平均值。
 * @param image 被用户缩放后的载体
 * @param encodedWidth 编码时宽度
 * @param encodedHeight 编码时高度
 */
function normalizeScaledCarrier(
    image: ImageDataLike,
    encodedWidth: number,
    encodedHeight: number,
    options: FdV7DecodeOptions
): ImageDataLike {
    const output = createImageDataLike(encodedWidth, encodedHeight)
    const horizontal = estimateAxisNormalization(
        image.width,
        encodedWidth,
        options.carrierX
    )
    const vertical = estimateAxisNormalization(
        image.height,
        encodedHeight,
        options.carrierY
    )
    for (let cellY = 0; cellY < encodedHeight; cellY += CARRIER_CELL_SIZE) {
        for (let cellX = 0; cellX < encodedWidth; cellX += CARRIER_CELL_SIZE) {
            const cellWidth = Math.min(CARRIER_CELL_SIZE, encodedWidth - cellX)
            const cellHeight = Math.min(CARRIER_CELL_SIZE, encodedHeight - cellY)
            // 选择映射回码元内部中心附近的真实目标像素，避免再次插值跨入相邻码元。
            const sampleX = Math.round(
                (cellX + 0.5 - horizontal.phase) * horizontal.scale
            )
            const sampleY = Math.round(
                (cellY + 0.5 - vertical.phase) * vertical.scale
            )
            const average = sampleImage(image, sampleX, sampleY)
            for (let y = 0; y < cellHeight; y++) for (let x = 0; x < cellWidth; x++) {
                const offset = ((cellY + y) * encodedWidth + cellX + x) * CHANNEL_COUNT
                for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
                    output.data[offset + channel] = clampByte(average[channel])
                }
                output.data[offset + 3] = MAX_PIXEL_VALUE
            }
        }
    }
    return output
}

/**
 * 提取局部块，转换为 YCbCr 后执行三路 DHT。
 * @param image 输入图像 @param blockX 块横坐标 @param blockY 块纵坐标
 * @param width 块宽度 @param height 块高度
 */
function transformLocalBlock(image: ImageDataLike, blockX: number, blockY: number, width: number, height: number): Float64Array[] {
    const spatial = Array.from({ length: 3 }, () => new Float64Array(width * height))
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = ((blockY + y) * image.width + blockX + x) * 4
        const values = rgbToYcbcr(image.data[offset], image.data[offset + 1], image.data[offset + 2])
        for (let channel = 0; channel < 3; channel++) spatial[channel][y * width + x] = values[channel]
    }
    return spatial.map((values) => dht2D(values, width, height))
}

/** 写入完整 8x8 载体块。 @param output 输出 @param frequencies 三路频谱 @param blockX 横坐标 @param blockY 纵坐标 */
function encodeFullLocalBlock(output: ImageDataLike, frequencies: Float64Array[], blockX: number, blockY: number): void {
    const permutation = createCellPermutation(blockX, blockY)
    for (let cell = 0; cell < 16; cell++) {
        const logicalCell = permutation[cell]
        const cellX = (cell % 4) * 2, cellY = Math.floor(cell / 4) * 2
        const base = BASE_ASSIGNMENTS[logicalCell]
        const rawBaseCode = encodeFrequencyValue(
            frequencies[base.channel][LOCAL_FREQUENCY_ORDER[base.rank]],
            LOCAL_FREQUENCY_BOUND
        )
        const baseCode = whitenFrequencyCode(
            rawBaseCode,
            getCarrierSign(blockX, blockY, logicalCell, 0)
        )
        const deltas = Array.from({ length: 2 }, () => new Float64Array(3))
        for (let storage = 0; storage < 2; storage++) for (let pattern = 0; pattern < 3; pattern++) {
            const assignment = ENHANCEMENT_ASSIGNMENTS[logicalCell * 6 + storage * 3 + pattern]
            const rawCode = encodeFrequencyValue(
                frequencies[assignment.channel][LOCAL_FREQUENCY_ORDER[assignment.rank]], LOCAL_FREQUENCY_BOUND
            )
            const sign = getCarrierSign(blockX, blockY, logicalCell, 1 + storage * 3 + pattern)
            deltas[storage][pattern] = whitenFrequencyCode(rawCode, sign) - PIXEL_CENTER
        }
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
            const offset = ((blockY + cellY + y) * output.width + blockX + cellX + x) * 4
            let cbDelta = 0, crDelta = 0
            for (let pattern = 0; pattern < 3; pattern++) {
                const texture = getCellPattern(pattern, x, y)
                cbDelta += ENHANCEMENT_STRENGTH * deltas[0][pattern] * texture
                crDelta += ENHANCEMENT_STRENGTH * deltas[1][pattern] * texture
            }
            output.data[offset] = clampByte(baseCode + 1.402 * crDelta)
            output.data[offset + 1] = clampByte(baseCode - 0.344136 * cbDelta - 0.714136 * crDelta)
            output.data[offset + 2] = clampByte(baseCode + 1.772 * cbDelta)
        }
    }
}

/** 写入不足 8x8 的边缘块。 @param output 输出 @param frequencies 频谱 @param blockX 横坐标 @param blockY 纵坐标 @param width 宽度 @param height 高度 */
function encodePartialLocalBlock(output: ImageDataLike, frequencies: Float64Array[], blockX: number, blockY: number, width: number, height: number): void {
    const bound = 255 * width * height
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = ((blockY + y) * output.width + blockX + x) * 4
        for (let channel = 0; channel < 3; channel++) output.data[offset + channel] = encodeFrequencyValue(frequencies[channel][y * width + x], bound)
    }
}

/** 恢复完整 8x8 频谱块。 @param image 载体 @param blockX 横坐标 @param blockY 纵坐标 @param enhanced 是否恢复增强层 */
function decodeFullLocalBlock(image: ImageDataLike, blockX: number, blockY: number, enhanced: boolean): Float64Array[] {
    const frequencies = Array.from({ length: 3 }, () => new Float64Array(64))
    const permutation = createCellPermutation(blockX, blockY)
    for (let cell = 0; cell < 16; cell++) {
        const logicalCell = permutation[cell]
        const cellX = (cell % 4) * 2, cellY = Math.floor(cell / 4) * 2
        let baseSum = 0
        const projections = Array.from({ length: 2 }, () => new Float64Array(3))
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
            const offset = ((blockY + cellY + y) * image.width + blockX + cellX + x) * 4
            baseSum += 0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2]
            if (enhanced) {
                const [, cb, cr] = rgbToYcbcr(
                    image.data[offset], image.data[offset + 1], image.data[offset + 2]
                )
                for (let pattern = 0; pattern < 3; pattern++) {
                    const texture = getCellPattern(pattern, x, y)
                    projections[0][pattern] += cb * texture
                    projections[1][pattern] += cr * texture
                }
            }
        }
        const base = BASE_ASSIGNMENTS[logicalCell]
        const baseCode = unwhitenFrequencyCode(
            baseSum / 4,
            getCarrierSign(blockX, blockY, logicalCell, 0)
        )
        frequencies[base.channel][LOCAL_FREQUENCY_ORDER[base.rank]] =
            decodeFrequencyValue(baseCode, LOCAL_FREQUENCY_BOUND)
        if (enhanced) for (let storage = 0; storage < 2; storage++) for (let pattern = 0; pattern < 3; pattern++) {
            const assignment = ENHANCEMENT_ASSIGNMENTS[logicalCell * 6 + storage * 3 + pattern]
            const code = unwhitenFrequencyCode(
                128 + projections[storage][pattern] / (4 * ENHANCEMENT_STRENGTH),
                getCarrierSign(blockX, blockY, logicalCell, 1 + storage * 3 + pattern)
            )
            frequencies[assignment.channel][LOCAL_FREQUENCY_ORDER[assignment.rank]] = decodeFrequencyValue(code, LOCAL_FREQUENCY_BOUND)
        }
    }
    return frequencies
}

/** 恢复边缘频谱块。 @param image 载体 @param blockX 横坐标 @param blockY 纵坐标 @param width 宽度 @param height 高度 */
function decodePartialLocalBlock(image: ImageDataLike, blockX: number, blockY: number, width: number, height: number): Float64Array[] {
    const bound = 255 * width * height
    const frequencies = Array.from({ length: 3 }, () => new Float64Array(width * height))
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = ((blockY + y) * image.width + blockX + x) * 4
        for (let channel = 0; channel < 3; channel++) frequencies[channel][y * width + x] = decodeFrequencyValue(image.data[offset + channel], bound)
    }
    return frequencies
}

/**
 * 限制缩放有损载体中的异常频谱脉冲，避免少量码元串扰放大为整块强烈伪色。
 * @param frequencies 当前块的三路频谱
 */
function stabilizeScaledFrequencies(frequencies: Float64Array[]): void {
    const yDcIndex = LOCAL_FREQUENCY_ORDER[0]
    frequencies[0][yDcIndex] = Math.max(
        0,
        Math.min(LOCAL_FREQUENCY_BOUND, frequencies[0][yDcIndex])
    )
    for (let rank = 1; rank < 12; rank++) {
        const index = LOCAL_FREQUENCY_ORDER[rank]
        const bound = 4600 / Math.sqrt(rank)
        frequencies[0][index] = Math.max(-bound, Math.min(bound, frequencies[0][index]))
    }
    for (let channel = 1; channel < COLOR_CHANNEL_COUNT; channel++) {
        const dcIndex = LOCAL_FREQUENCY_ORDER[0]
        const acIndex = LOCAL_FREQUENCY_ORDER[1]
        frequencies[channel][dcIndex] = Math.max(
            64 * LOCAL_BLOCK_SIZE * LOCAL_BLOCK_SIZE,
            Math.min(
                192 * LOCAL_BLOCK_SIZE * LOCAL_BLOCK_SIZE,
                frequencies[channel][dcIndex]
            )
        )
        frequencies[channel][acIndex] = Math.max(
            -1800,
            Math.min(1800, frequencies[channel][acIndex])
        )
    }
}

/**
 * 对缩放且有损转码的恢复图执行保守降噪，避免不可靠色差码元形成强烈伪色。
 * @param image 初步恢复的空间图像
 */
function stabilizeLossyScaledOutput(image: ImageDataLike): ImageDataLike {
    const reduced = resize_image(
        image,
        Math.max(1, Math.round(image.width / 2)),
        Math.max(1, Math.round(image.height / 2))
    )
    const output = resize_image(reduced, image.width, image.height)
    for (let offset = 0; offset < output.data.length; offset += CHANNEL_COUNT) {
        const luminance = clampByte(
            0.299 * output.data[offset] +
            0.587 * output.data[offset + 1] +
            0.114 * output.data[offset + 2]
        )
        output.data[offset] = luminance
        output.data[offset + 1] = luminance
        output.data[offset + 2] = luminance
        output.data[offset + 3] = MAX_PIXEL_VALUE
    }
    return output
}

/** 判断恢复结果是否包含明显的缩放色差串扰。 @param image 待检查图像 */
function hasSevereChromaArtifacts(image: ImageDataLike): boolean {
    let saturation = 0
    for (let offset = 0; offset < image.data.length; offset += CHANNEL_COUNT) {
        const red = image.data[offset]
        const green = image.data[offset + 1]
        const blue = image.data[offset + 2]
        saturation += Math.max(red, green, blue) - Math.min(red, green, blue)
    }
    return saturation / (image.width * image.height) > 110
}

/** 将三路频谱恢复到输出 RGB 图像。 @param output 输出 @param frequencies 频谱 @param blockX 横坐标 @param blockY 纵坐标 @param width 宽度 @param height 高度 */
function restoreLocalBlock(output: ImageDataLike, frequencies: Float64Array[], blockX: number, blockY: number, width: number, height: number): void {
    const spatial = frequencies.map((values) => idht2D(values, width, height))
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const pixel = y * width + x
        const rgb = ycbcrToRgb(spatial[0][pixel], spatial[1][pixel], spatial[2][pixel])
        const offset = ((blockY + y) * output.width + blockX + x) * 4
        output.data[offset] = rgb[0]; output.data[offset + 1] = rgb[1]; output.data[offset + 2] = rgb[2]
    }
}

/** 将原图转换为 v7 自同步局部频域载体。 @param imageData 原始图像 */
export async function image2fd_by_fft_v7(imageData: ImageDataLike): Promise<ImageDataLike> {
    assertValidImageData(imageData)
    const output = createImageDataLike(imageData.width, imageData.height)
    for (let blockY = 0; blockY < imageData.height; blockY += 8) for (let blockX = 0; blockX < imageData.width; blockX += 8) {
        const width = Math.min(8, imageData.width - blockX), height = Math.min(8, imageData.height - blockY)
        const frequencies = transformLocalBlock(imageData, blockX, blockY, width, height)
        if (width === 8 && height === 8) encodeFullLocalBlock(output, frequencies, blockX, blockY)
        else encodePartialLocalBlock(output, frequencies, blockX, blockY, width, height)
    }
    addScalePilot(output)
    for (let pixel = 0; pixel < imageData.width * imageData.height; pixel++) output.data[pixel * 4 + 3] = LOCAL_FREQUENCY_ALPHA
    return output
}

/**
 * 将 v7 载体恢复为空间图像。
 * @param fdImageData 频域载体
 * @param options 载体在处理后整图中的可选位置信息，用于恢复直接缩放产生的相位
 */
export async function fd2image_by_fft_v7(
    fdImageData: ImageDataLike,
    options: FdV7DecodeOptions = {}
): Promise<ImageDataLike> {
    assertValidImageData(fdImageData)
    const targetWidth = fdImageData.width
    const targetHeight = fdImageData.height
    const isAlignedUnscaledRegion =
        options.carrierX !== undefined &&
        options.carrierY !== undefined &&
        options.carrierX % SCALE_PILOT_PERIOD === 0 &&
        options.carrierY % SCALE_PILOT_PERIOD === 0 &&
        (options.carrierX + targetWidth) % SCALE_PILOT_PERIOD === 0 &&
        (options.carrierY + targetHeight) % SCALE_PILOT_PERIOD === 0
    const encodedWidth = options.encodedWidth ?? (
        isAlignedUnscaledRegion ? targetWidth : estimateEncodedAxisSize(fdImageData, true)
    )
    const encodedHeight = options.encodedHeight ?? (
        isAlignedUnscaledRegion ? targetHeight : estimateEncodedAxisSize(fdImageData, false)
    )
    const wasRawScaled = encodedWidth !== targetWidth || encodedHeight !== targetHeight
    const normalizedCarrier = wasRawScaled
        ? normalizeScaledCarrier(fdImageData, encodedWidth, encodedHeight, options)
        : fdImageData
    const carrier = removeScalePilot(normalizedCarrier)
    const output = createImageDataLike(encodedWidth, encodedHeight)
    const enhanced = !wasRawScaled && carrier.data[3] === LOCAL_FREQUENCY_ALPHA
    for (let blockY = 0; blockY < carrier.height; blockY += 8) for (let blockX = 0; blockX < carrier.width; blockX += 8) {
        const width = Math.min(8, carrier.width - blockX), height = Math.min(8, carrier.height - blockY)
        const frequencies = width === 8 && height === 8
            ? decodeFullLocalBlock(carrier, blockX, blockY, enhanced)
            : decodePartialLocalBlock(carrier, blockX, blockY, width, height)
        if (wasRawScaled && width === 8 && height === 8) {
            stabilizeScaledFrequencies(frequencies)
        }
        restoreLocalBlock(output, frequencies, blockX, blockY, width, height)
    }
    for (let pixel = 0; pixel < output.width * output.height; pixel++) output.data[pixel * 4 + 3] = MAX_PIXEL_VALUE
    const centerAlpha = fdImageData.data[
        (Math.floor(fdImageData.height / 2) * fdImageData.width +
            Math.floor(fdImageData.width / 2)) * CHANNEL_COUNT + 3
    ]
    const wasLossyTranscoded = centerAlpha >= MAX_PIXEL_VALUE - 1
    const stabilized = wasRawScaled && wasLossyTranscoded && hasSevereChromaArtifacts(output)
        ? stabilizeLossyScaledOutput(output)
        : output
    return wasRawScaled ? resize_image(stabilized, targetWidth, targetHeight) : stabilized
}

/** 缩放 v7 载体。 @param fdImage 载体 @param targetWidth 目标宽度 @param targetHeight 目标高度 */
export async function scale_fd_by_fft_v7(fdImage: ImageDataLike, targetWidth: number, targetHeight: number): Promise<ImageDataLike> {
    assertValidImageData(fdImage); assertValidDimensions(targetWidth, targetHeight)
    return image2fd_by_fft_v7(resize_image(await fd2image_by_fft_v7(fdImage), targetWidth, targetHeight))
}
