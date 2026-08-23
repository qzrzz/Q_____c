/**
 * v6 局部 DHT 分层载体。
 * JPEG 基础层仅依赖载体亮度，每个 8x8 块保存 12 个 Y、2 个 Cb、2 个 Cr
 * 低频系数；PNG 增强层利用 RGB 正交纹理再保存 144 个频谱系数。
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
const ENHANCEMENT_STRENGTH = 0.22
const FREQUENCY_COMPRESSION_EXPONENT = 0.38
const LOCAL_FREQUENCY_ALPHA = 252
const LOCAL_FREQUENCY_BOUND = MAX_PIXEL_VALUE * LOCAL_BLOCK_SIZE * LOCAL_BLOCK_SIZE
const WHITENING_PEDESTAL = 8

interface CoefficientAssignment { channel: number; rank: number }

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
}).slice(0, 144)

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

/** 混合一个 32 位整数，供确定性置换使用。 @param value 输入整数 */
function mixCarrierSeed(value: number): number {
    value ^= value >>> 16
    value = Math.imul(value, 0x7feb352d)
    value ^= value >>> 15
    value = Math.imul(value, 0x846ca68b)
    return (value ^ (value >>> 16)) >>> 0
}

/**
 * 按图像尺寸生成完整 8x8 块的确定性置换。
 * 置换只移动完整 JPEG 亮度块，不改变块内载荷结构；专用缩放会先逆置换再重编码。
 * @param width 图像宽度
 * @param height 图像高度
 */
function createBlockPermutation(width: number, height: number): Uint32Array {
    const columns = Math.floor(width / LOCAL_BLOCK_SIZE)
    const rows = Math.floor(height / LOCAL_BLOCK_SIZE)
    const permutation = Uint32Array.from({ length: columns * rows }, (_, index) => index)
    let state = mixCarrierSeed(
        Math.imul(width, 0x9e3779b1) ^ Math.imul(height, 0x85ebca77) ^ 0x6d2b79f5
    ) || 0xa341316c
    for (let index = permutation.length - 1; index > 0; index--) {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        const target = (state >>> 0) % (index + 1)
        const current = permutation[index]
        permutation[index] = permutation[target]
        permutation[target] = current
    }
    return permutation
}

/**
 * 获取逻辑块在载体中的物理坐标。
 * @param permutation 块置换
 * @param columns 完整块列数
 * @param logicalX 逻辑块横坐标
 * @param logicalY 逻辑块纵坐标
 */
function getPermutedBlockCoordinates(
    permutation: Uint32Array,
    columns: number,
    logicalX: number,
    logicalY: number
): [number, number] {
    const physical = permutation[logicalY * columns + logicalX]
    return [(physical % columns) * LOCAL_BLOCK_SIZE, Math.floor(physical / columns) * LOCAL_BLOCK_SIZE]
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
        const deltas = Array.from({ length: 3 }, () => new Float64Array(3))
        for (let storage = 0; storage < 3; storage++) for (let pattern = 0; pattern < 3; pattern++) {
            const assignment = ENHANCEMENT_ASSIGNMENTS[logicalCell * 9 + storage * 3 + pattern]
            const rawCode = encodeFrequencyValue(
                frequencies[assignment.channel][LOCAL_FREQUENCY_ORDER[assignment.rank]], LOCAL_FREQUENCY_BOUND
            )
            const sign = getCarrierSign(blockX, blockY, logicalCell, 1 + storage * 3 + pattern)
            deltas[storage][pattern] = whitenFrequencyCode(rawCode, sign) - PIXEL_CENTER
        }
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
            const offset = ((blockY + cellY + y) * output.width + blockX + cellX + x) * 4
            for (let storage = 0; storage < 3; storage++) {
                let value = baseCode
                for (let pattern = 0; pattern < 3; pattern++) {
                    value += ENHANCEMENT_STRENGTH * deltas[storage][pattern] * getCellPattern(pattern, x, y)
                }
                output.data[offset + storage] = clampByte(value)
            }
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
        const projections = Array.from({ length: 3 }, () => new Float64Array(3))
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
            const offset = ((blockY + cellY + y) * image.width + blockX + cellX + x) * 4
            baseSum += 0.299 * image.data[offset] + 0.587 * image.data[offset + 1] + 0.114 * image.data[offset + 2]
            if (enhanced) for (let storage = 0; storage < 3; storage++) for (let pattern = 0; pattern < 3; pattern++) {
                projections[storage][pattern] += image.data[offset + storage] * getCellPattern(pattern, x, y)
            }
        }
        const base = BASE_ASSIGNMENTS[logicalCell]
        const baseCode = unwhitenFrequencyCode(
            baseSum / 4,
            getCarrierSign(blockX, blockY, logicalCell, 0)
        )
        frequencies[base.channel][LOCAL_FREQUENCY_ORDER[base.rank]] =
            decodeFrequencyValue(baseCode, LOCAL_FREQUENCY_BOUND)
        if (enhanced) for (let storage = 0; storage < 3; storage++) for (let pattern = 0; pattern < 3; pattern++) {
            const assignment = ENHANCEMENT_ASSIGNMENTS[logicalCell * 9 + storage * 3 + pattern]
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

/** 将原图转换为 v6 局部频域载体。 @param imageData 原始图像 */
export async function image2fd_by_fft_v6(imageData: ImageDataLike): Promise<ImageDataLike> {
    assertValidImageData(imageData)
    const output = createImageDataLike(imageData.width, imageData.height)
    const fullColumns = Math.floor(imageData.width / LOCAL_BLOCK_SIZE)
    const blockPermutation = createBlockPermutation(imageData.width, imageData.height)
    for (let blockY = 0; blockY < imageData.height; blockY += 8) for (let blockX = 0; blockX < imageData.width; blockX += 8) {
        const width = Math.min(8, imageData.width - blockX), height = Math.min(8, imageData.height - blockY)
        const frequencies = transformLocalBlock(imageData, blockX, blockY, width, height)
        if (width === 8 && height === 8) {
            const [carrierX, carrierY] = getPermutedBlockCoordinates(
                blockPermutation, fullColumns, blockX / LOCAL_BLOCK_SIZE, blockY / LOCAL_BLOCK_SIZE
            )
            encodeFullLocalBlock(output, frequencies, carrierX, carrierY)
        } else encodePartialLocalBlock(output, frequencies, blockX, blockY, width, height)
    }
    for (let pixel = 0; pixel < imageData.width * imageData.height; pixel++) output.data[pixel * 4 + 3] = LOCAL_FREQUENCY_ALPHA
    return output
}

/** 将 v6 载体恢复为空间图像。 @param fdImageData 频域载体 */
export async function fd2image_by_fft_v6(fdImageData: ImageDataLike): Promise<ImageDataLike> {
    assertValidImageData(fdImageData)
    const output = createImageDataLike(fdImageData.width, fdImageData.height)
    const enhanced = fdImageData.data[3] === LOCAL_FREQUENCY_ALPHA
    const fullColumns = Math.floor(fdImageData.width / LOCAL_BLOCK_SIZE)
    const blockPermutation = createBlockPermutation(fdImageData.width, fdImageData.height)
    for (let blockY = 0; blockY < fdImageData.height; blockY += 8) for (let blockX = 0; blockX < fdImageData.width; blockX += 8) {
        const width = Math.min(8, fdImageData.width - blockX), height = Math.min(8, fdImageData.height - blockY)
        let frequencies: Float64Array[]
        if (width === 8 && height === 8) {
            const [carrierX, carrierY] = getPermutedBlockCoordinates(
                blockPermutation, fullColumns, blockX / LOCAL_BLOCK_SIZE, blockY / LOCAL_BLOCK_SIZE
            )
            frequencies = decodeFullLocalBlock(fdImageData, carrierX, carrierY, enhanced)
        } else frequencies = decodePartialLocalBlock(fdImageData, blockX, blockY, width, height)
        restoreLocalBlock(output, frequencies, blockX, blockY, width, height)
    }
    for (let pixel = 0; pixel < output.width * output.height; pixel++) output.data[pixel * 4 + 3] = MAX_PIXEL_VALUE
    return output
}

/** 缩放 v6 载体。 @param fdImage 载体 @param targetWidth 目标宽度 @param targetHeight 目标高度 */
export async function scale_fd_by_fft_v6(fdImage: ImageDataLike, targetWidth: number, targetHeight: number): Promise<ImageDataLike> {
    assertValidImageData(fdImage); assertValidDimensions(targetWidth, targetHeight)
    return image2fd_by_fft_v6(resize_image(await fd2image_by_fft_v6(fdImage), targetWidth, targetHeight))
}
