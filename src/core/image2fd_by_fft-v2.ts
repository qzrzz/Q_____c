/**
 * JPEG 友好的频域图像变换 v2。
 *
 * v1 将每个 DHT 系数直接写到对应的频谱像素中。JPEG 的 8x8 块量化会把
 * 这种高频、跳变很大的像素图破坏得比较严重，因此 v2 做了四件事：
 * 1. 按频率半径重新布局，让低频集中在中心，整体图像更平滑；
 * 2. 对中心低频系数做多点冗余，JPEG 量化后可以通过平均降低误差；
 * 3. 用幂压缩扩大中小系数的可用 8 位动态范围；
 * 4. 将冗余覆盖的少量最高频系数置零，把其余系数放入外圈备用位置，保证
 *    PNG 1x 往返和缩放流程仍然可用。
 */

import {
    createImageDataLike,
    dht2D,
    idht2D,
    type ImageDataLike,
} from "./image2fd_by_fft"

const CHANNEL_COUNT = 4
const COLOR_CHANNEL_COUNT = 3
const MAX_PIXEL_VALUE = 255
const PIXEL_CENTER = 128
const PIXEL_HALF_RANGE = 127

/** 低频系数在频域图中占用的比例，保证不同缩放尺寸下布局比例一致。 */
const PROTECTED_COEFFICIENT_FRACTION = 1 / 128

/** 每个受保护低频系数的重复次数。 */
const PROTECTED_REPEAT_COUNT = 4

/** 幂压缩指数；略低于 0.5 可为中小系数保留更多 8 位精度。 */
const FREQUENCY_COMPRESSION_EXPONENT = 0.43

/** 频域图 alpha 通道使用的固定值；JPEG 解码后的 alpha 不参与逆变换。 */
const FREQUENCY_ALPHA = 255

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
 * 校验图像像素缓冲区长度是否有效。
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
 * 获取 DHT 系数在当前尺寸下的安全幅值上限。
 * @param width 图像宽度
 * @param height 图像高度
 */
function getFrequencyBound(width: number, height: number): number {
    return MAX_PIXEL_VALUE * width * height
}

/**
 * 计算中心频谱坐标的归一化半径。
 * @param x 频谱横坐标
 * @param y 频谱纵坐标
 * @param width 频谱宽度
 * @param height 频谱高度
 */
function getNormalizedRadius(x: number, y: number, width: number, height: number): number {
    const centerX = Math.floor(width / 2)
    const centerY = Math.floor(height / 2)
    const radiusX = Math.max(1, width / 2)
    const radiusY = Math.max(1, height / 2)
    const dx = (x - centerX) / radiusX
    const dy = (y - centerY) / radiusY
    return dx * dx + dy * dy
}

/**
 * 生成从中心低频到边缘高频的半径排序。
 * @param width 图像宽度
 * @param height 图像高度
 */
function createRadialOrder(width: number, height: number): Uint32Array {
    const order = Array.from({ length: width * height }, (_, index) => index)
    order.sort((a, b) => {
        const ax = a % width
        const ay = Math.floor(a / width)
        const bx = b % width
        const by = Math.floor(b / width)
        const radiusDifference =
            getNormalizedRadius(ax, ay, width, height) -
            getNormalizedRadius(bx, by, width, height)
        if (radiusDifference !== 0) return radiusDifference

        // 半径相同时使用稳定的行列顺序，避免不同运行时的排序差异。
        return a - b
    })
    return Uint32Array.from(order)
}

/**
 * 获取当前尺寸下需要冗余保护的低频系数数量。
 * @param coefficientCount 系数总数
 */
function getProtectedCoefficientCount(coefficientCount: number): number {
    if (coefficientCount < PROTECTED_REPEAT_COUNT) return 0
    return Math.max(
        1,
        Math.min(
            Math.floor(coefficientCount / PROTECTED_REPEAT_COUNT),
            Math.floor(coefficientCount * PROTECTED_COEFFICIENT_FRACTION)
        )
    )
}

/**
 * 获取冗余布局下仍然实际写入的最高系数数量。
 * @param coefficientCount 系数总数
 */
function getEncodableCoefficientCount(coefficientCount: number): number {
    const protectedCount = getProtectedCoefficientCount(coefficientCount)
    return coefficientCount - protectedCount * (PROTECTED_REPEAT_COUNT - 1)
}

/**
 * 获取普通系数在频域图像线性序列中的存储位置。
 * @param coefficientIndex 按频率半径排序后的系数序号
 * @param coefficientCount 系数总数
 */
function getCoefficientSlot(coefficientIndex: number, coefficientCount: number): number {
    const protectedCount = getProtectedCoefficientCount(coefficientCount)
    const protectedSlotCount = protectedCount * PROTECTED_REPEAT_COUNT

    if (coefficientIndex < protectedCount) {
        return coefficientIndex * PROTECTED_REPEAT_COUNT
    }

    return protectedSlotCount + coefficientIndex - protectedCount
}

/**
 * 对低频冗余位置取样并还原所有频域系数。
 * @param encodedSequence 频域图按半径排序后的编码值
 */
function decodeCoefficientSequence(encodedSequence: Float64Array): Float64Array {
    const coefficientCount = encodedSequence.length
    const decoded = new Float64Array(coefficientCount)
    const protectedCount = getProtectedCoefficientCount(coefficientCount)

    for (let coefficientIndex = 0; coefficientIndex < protectedCount; coefficientIndex++) {
        const firstSlot = coefficientIndex * PROTECTED_REPEAT_COUNT
        let sum = 0
        for (let repeatIndex = 0; repeatIndex < PROTECTED_REPEAT_COUNT; repeatIndex++) {
            sum += encodedSequence[firstSlot + repeatIndex]
        }
        decoded[coefficientIndex] = sum / PROTECTED_REPEAT_COUNT
    }

    for (
        let coefficientIndex = protectedCount;
        coefficientIndex < getEncodableCoefficientCount(coefficientCount);
        coefficientIndex++
    ) {
        decoded[coefficientIndex] =
            encodedSequence[
                getCoefficientSlot(coefficientIndex, coefficientCount)
            ]
    }

    return decoded
}

/**
 * 使用平方根压缩将有符号频域系数编码为 8 位像素值。
 * @param value 频域系数
 * @param bound 频域系数幅值上限
 */
function encodeFrequencyValue(value: number, bound: number): number {
    if (!Number.isFinite(value) || value === 0) return PIXEL_CENTER

    const normalizedMagnitude = Math.min(1, Math.abs(value) / bound)
    const compressedMagnitude = Math.pow(
        normalizedMagnitude,
        FREQUENCY_COMPRESSION_EXPONENT
    )
    const signedValue = value < 0 ? -compressedMagnitude : compressedMagnitude
    return clampByte(PIXEL_CENTER + signedValue * PIXEL_HALF_RANGE)
}

/**
 * 将 8 位像素值解码为有符号频域系数。
 * @param value 编码后的像素值
 * @param bound 频域系数幅值上限
 */
function decodeFrequencyValue(value: number, bound: number): number {
    const signedValue = (value - PIXEL_CENTER) / PIXEL_HALF_RANGE
    const magnitude =
        Math.pow(Math.abs(signedValue), 1 / FREQUENCY_COMPRESSION_EXPONENT) * bound
    return signedValue < 0 ? -magnitude : magnitude
}

/**
 * 将一个中心排列的频谱矩阵转换为半径序列。
 * @param frequency 中心排列的频谱矩阵
 * @param order 半径排序索引
 */
function flattenByRadialOrder(frequency: Float64Array, order: Uint32Array): Float64Array {
    const sequence = new Float64Array(order.length)
    for (let i = 0; i < order.length; i++) {
        sequence[i] = frequency[order[i]]
    }
    return sequence
}

/**
 * 将半径序列写回中心排列的频谱矩阵。
 * @param sequence 频谱序列
 * @param order 半径排序索引
 * @param width 图像宽度
 * @param height 图像高度
 */
function expandByRadialOrder(
    sequence: Float64Array,
    order: Uint32Array,
    width: number,
    height: number
): Float64Array {
    const frequency = new Float64Array(width * height)
    for (let i = 0; i < order.length; i++) {
        frequency[order[i]] = sequence[i]
    }
    return frequency
}

/**
 * 按 DHT 的实际横纵频率坐标裁剪或补零频谱矩阵。
 * @param source 源中心排列频谱矩阵
 * @param sourceWidth 源频谱宽度
 * @param sourceHeight 源频谱高度
 * @param targetWidth 目标频谱宽度
 * @param targetHeight 目标频谱高度
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
    const sourceCenterX = Math.floor(sourceWidth / 2)
    const sourceCenterY = Math.floor(sourceHeight / 2)
    const targetCenterX = Math.floor(targetWidth / 2)
    const targetCenterY = Math.floor(targetHeight / 2)

    for (let targetY = 0; targetY < targetHeight; targetY++) {
        const sourceY = sourceCenterY + targetY - targetCenterY
        if (sourceY < 0 || sourceY >= sourceHeight) continue

        for (let targetX = 0; targetX < targetWidth; targetX++) {
            const sourceX = sourceCenterX + targetX - targetCenterX
            if (sourceX < 0 || sourceX >= sourceWidth) continue
            target[targetY * targetWidth + targetX] =
                source[sourceY * sourceWidth + sourceX] * scale
        }
    }
    return target
}

/**
 * 将一个频谱序列编码到单个颜色通道的像素位置。
 * @param sequence 原始频谱序列
 * @param order 半径排序索引
 * @param output 输出图像
 * @param channel 颜色通道序号
 * @param bound 频域系数幅值上限
 */
function encodeChannel(
    sequence: Float64Array,
    order: Uint32Array,
    output: ImageDataLike,
    channel: number,
    bound: number
): void {
    const encodedSequence = new Float64Array(sequence.length)
    encodedSequence.fill(PIXEL_CENTER)
    const protectedCount = getProtectedCoefficientCount(sequence.length)
    const encodableCount = getEncodableCoefficientCount(sequence.length)
    for (let coefficientIndex = 0; coefficientIndex < sequence.length; coefficientIndex++) {
        if (coefficientIndex < protectedCount) {
            const encoded = encodeFrequencyValue(sequence[coefficientIndex], bound)
            const firstSlot = coefficientIndex * PROTECTED_REPEAT_COUNT
            for (let repeatIndex = 0; repeatIndex < PROTECTED_REPEAT_COUNT; repeatIndex++) {
                encodedSequence[firstSlot + repeatIndex] = encoded
            }
        } else if (coefficientIndex < encodableCount) {
            const slot = getCoefficientSlot(coefficientIndex, sequence.length)
            encodedSequence[slot] = encodeFrequencyValue(sequence[coefficientIndex], bound)
        }
    }

    for (let slot = 0; slot < order.length; slot++) {
        const pixelIndex = order[slot]
        output.data[pixelIndex * CHANNEL_COUNT + channel] = clampByte(encodedSequence[slot])
    }
}

/**
 * 从单个颜色通道读取并解码频谱序列。
 * @param input 输入频域图像
 * @param order 半径排序索引
 * @param channel 颜色通道序号
 * @param bound 频域系数幅值上限
 */
function decodeChannel(
    input: ImageDataLike,
    order: Uint32Array,
    channel: number,
    bound: number
): Float64Array {
    const encodedSequence = new Float64Array(order.length)
    for (let slot = 0; slot < order.length; slot++) {
        encodedSequence[slot] = decodeFrequencyValue(
            input.data[order[slot] * CHANNEL_COUNT + channel],
            bound
        )
    }
    return decodeCoefficientSequence(encodedSequence)
}

/**
 * 将原始图像转换为 JPEG 友好的二维 DHT 频域图像。
 *
 * 频域图的尺寸与原图相同，中心区域保存低频系数，重复位置会在逆变换时
 * 自动平均；外围位置保存被覆盖的高频系数。频域图可以直接保存为 PNG，
 * 也可以经过普通双线性缩放或 JPEG 编码后再调用 fd2image_by_fft_v2。
 * @param imageData 原始图像像素数据
 */
export async function image2fd_by_fft_v2(imageData: ImageDataLike): Promise<ImageDataLike> {
    assertValidImageData(imageData)
    const { width, height, data } = imageData
    const pixelCount = width * height
    const order = createRadialOrder(width, height)
    const bound = getFrequencyBound(width, height)
    const output = createImageDataLike(width, height)

    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const spatial = new Float64Array(pixelCount)
        for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
            spatial[pixelIndex] = data[pixelIndex * CHANNEL_COUNT + channel]
        }

        const frequency = dht2D(spatial, width, height)
        const centeredFrequency = new Float64Array(pixelCount)
        const centerX = Math.floor(width / 2)
        const centerY = Math.floor(height / 2)
        for (let y = 0; y < height; y++) {
            const shiftedY = (y + centerY) % height
            for (let x = 0; x < width; x++) {
                const shiftedX = (x + centerX) % width
                centeredFrequency[shiftedY * width + shiftedX] = frequency[y * width + x]
            }
        }

        encodeChannel(
            flattenByRadialOrder(centeredFrequency, order),
            order,
            output,
            channel,
            bound
        )
    }

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
        output.data[pixelIndex * CHANNEL_COUNT + 3] = FREQUENCY_ALPHA
    }
    return output
}

/**
 * 缩放 v2 频域图像。
 *
 * v2 的布局按归一化频率半径排列。缩放时先恢复中心频谱矩阵，再按实际
 * DHT 频率坐标裁剪或补零，最后重新编码。该函数仅供业务主动缩放使用，
 * 基准测试不会调用它，以免把受控重编码误判为抗直接缩放能力。
 * @param fdImage v2 频域图像
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
export function scale_fd_by_fft_v2(
    fdImage: ImageDataLike,
    targetWidth: number,
    targetHeight: number
): ImageDataLike {
    assertValidImageData(fdImage)
    assertValidDimensions(targetWidth, targetHeight)
    if (fdImage.width === targetWidth && fdImage.height === targetHeight) {
        return fdImage
    }

    const sourceOrder = createRadialOrder(fdImage.width, fdImage.height)
    const targetOrder = createRadialOrder(targetWidth, targetHeight)
    const sourceBound = getFrequencyBound(fdImage.width, fdImage.height)
    const targetBound = getFrequencyBound(targetWidth, targetHeight)
    const output = createImageDataLike(targetWidth, targetHeight)

    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const sourceFrequency = expandByRadialOrder(
            decodeChannel(fdImage, sourceOrder, channel, sourceBound),
            sourceOrder,
            fdImage.width,
            fdImage.height
        )
        const targetFrequency = resizeCenteredFrequency(
            sourceFrequency,
            fdImage.width,
            fdImage.height,
            targetWidth,
            targetHeight
        )
        const targetSequence = flattenByRadialOrder(targetFrequency, targetOrder)
        encodeChannel(targetSequence, targetOrder, output, channel, targetBound)
    }

    for (let pixelIndex = 0; pixelIndex < targetWidth * targetHeight; pixelIndex++) {
        output.data[pixelIndex * CHANNEL_COUNT + 3] = FREQUENCY_ALPHA
    }
    return output
}

/**
 * 将 JPEG 友好的 v2 频域图像逆变换为空间域图像。
 * @param fdImageData v2 频域图像像素数据
 */
export async function fd2image_by_fft_v2(
    fdImageData: ImageDataLike
): Promise<ImageDataLike> {
    assertValidImageData(fdImageData)
    const { width, height } = fdImageData
    const pixelCount = width * height
    const order = createRadialOrder(width, height)
    const bound = getFrequencyBound(width, height)
    const output = createImageDataLike(width, height)
    const centerX = Math.ceil(width / 2)
    const centerY = Math.ceil(height / 2)

    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const centeredFrequency = expandByRadialOrder(
            decodeChannel(fdImageData, order, channel, bound),
            order,
            width,
            height
        )
        const frequency = new Float64Array(pixelCount)
        for (let y = 0; y < height; y++) {
            const shiftedY = (y + centerY) % height
            for (let x = 0; x < width; x++) {
                const shiftedX = (x + centerX) % width
                frequency[y * width + x] = centeredFrequency[shiftedY * width + shiftedX]
            }
        }

        const restored = idht2D(frequency, width, height)
        for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
            output.data[pixelIndex * CHANNEL_COUNT + channel] = clampByte(restored[pixelIndex])
        }
    }

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
        output.data[pixelIndex * CHANNEL_COUNT + 3] = MAX_PIXEL_VALUE
    }
    return output
}
