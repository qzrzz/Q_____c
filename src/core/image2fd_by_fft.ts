/**
 * 图像通用像素数据接口，兼容浏览器标准 ImageData 与 Node/Bun 运行环境中的像素缓冲区。
 */
export interface ImageDataLike {
    width: number
    height: number
    data: Uint8ClampedArray | Uint8Array
}

/**
 * 频域变换选项。
 */
export interface FftOptions {
    /** 零频是否居中，默认值为 true。 */
    center?: boolean
}

const CHANNEL_COUNT = 4
const COLOR_CHANNEL_COUNT = 3
const MAX_PIXEL_VALUE = 255

// 使用带符号对数编码压缩频域动态范围，让低频和高频都能在 8 位像素中保留。
const FREQUENCY_LOG_BASE = 1_000_000
const FREQUENCY_LOG_DENOMINATOR = Math.log1p(FREQUENCY_LOG_BASE)

// 频域图的 alpha 通道保留一个标记，用于让逆变换知道零频是否被居中。
const UNCENTERED_ALPHA = 254

/**
 * 校验图像尺寸是否可以用于像素和 FFT 运算。
 * @param width 图像宽度
 * @param height 图像高度
 */
function assertValidDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new RangeError(`图像尺寸必须是正整数，当前为 ${width}x${height}`)
    }
}

/**
 * 校验图像像素缓冲区长度是否与图像尺寸匹配。
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
 * 校验矩阵缓冲区长度是否与矩阵尺寸匹配。
 * @param data 矩阵数据
 * @param width 矩阵宽度
 * @param height 矩阵高度
 */
function assertValidMatrix(data: Float64Array, width: number, height: number): void {
    assertValidDimensions(width, height)
    const expectedLength = width * height
    if (data.length !== expectedLength) {
        throw new RangeError(
            `矩阵长度必须为 ${expectedLength}，当前为 ${data.length}`
        )
    }
}

/**
 * 创建空白 ImageDataLike 实例。
 * @param width 图像宽度
 * @param height 图像高度
 */
export function createImageDataLike(width: number, height: number): ImageDataLike {
    assertValidDimensions(width, height)
    return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * CHANNEL_COUNT),
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
 * 双线性插值图像尺寸缩放函数，用于普通空间域图像缩放。
 * @param src 源图像
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
export function resize_image(
    src: ImageDataLike,
    targetWidth: number,
    targetHeight: number
): ImageDataLike {
    assertValidImageData(src)
    assertValidDimensions(targetWidth, targetHeight)

    if (src.width === targetWidth && src.height === targetHeight) {
        return src
    }

    const dst = createImageDataLike(targetWidth, targetHeight)
    const srcData = src.data
    const dstData = dst.data
    const xRatio = src.width / targetWidth
    const yRatio = src.height / targetHeight

    for (let y = 0; y < targetHeight; y++) {
        const srcY = y * yRatio
        const y0 = Math.floor(srcY)
        const y1 = Math.min(y0 + 1, src.height - 1)
        const yWeight = srcY - y0
        const dstRowOffset = y * targetWidth

        for (let x = 0; x < targetWidth; x++) {
            const srcX = x * xRatio
            const x0 = Math.floor(srcX)
            const x1 = Math.min(x0 + 1, src.width - 1)
            const xWeight = srcX - x0

            const dstIndex = (dstRowOffset + x) * CHANNEL_COUNT
            const topLeft = (y0 * src.width + x0) * CHANNEL_COUNT
            const topRight = (y0 * src.width + x1) * CHANNEL_COUNT
            const bottomLeft = (y1 * src.width + x0) * CHANNEL_COUNT
            const bottomRight = (y1 * src.width + x1) * CHANNEL_COUNT

            for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
                const top =
                    srcData[topLeft + channel] * (1 - xWeight) +
                    srcData[topRight + channel] * xWeight
                const bottom =
                    srcData[bottomLeft + channel] * (1 - xWeight) +
                    srcData[bottomRight + channel] * xWeight
                dstData[dstIndex + channel] = clampByte(
                    top * (1 - yWeight) + bottom * yWeight
                )
            }
        }
    }

    return dst
}

/**
 * 快速 Radix-2 FFT 变换，输入长度必须是 2 的幂。
 * @param re 实部数组
 * @param im 虚部数组
 * @param inverse 是否逆变换
 */
export function radix2FFT(re: Float64Array, im: Float64Array, inverse = false): void {
    if (re.length !== im.length) {
        throw new RangeError("FFT 实部和虚部长度必须一致")
    }

    const n = re.length
    if (n <= 1) return
    if ((n & (n - 1)) !== 0) {
        throw new RangeError(`Radix-2 FFT 长度必须是 2 的幂，当前为 ${n}`)
    }

    let j = 0
    for (let i = 0; i < n - 1; i++) {
        if (i < j) {
            const tempRe = re[i]
            re[i] = re[j]
            re[j] = tempRe
            const tempIm = im[i]
            im[i] = im[j]
            im[j] = tempIm
        }

        let k = n >> 1
        while (k <= j) {
            j -= k
            k >>= 1
        }
        j += k
    }

    const sign = inverse ? 1 : -1
    for (let length = 2; length <= n; length <<= 1) {
        const halfLength = length >> 1
        const angle = (sign * 2 * Math.PI) / length
        const stepRe = Math.cos(angle)
        const stepIm = Math.sin(angle)

        for (let start = 0; start < n; start += length) {
            let weightRe = 1
            let weightIm = 0
            for (let offset = 0; offset < halfLength; offset++) {
                const position = start + offset
                const match = position + halfLength
                const upperRe = re[position]
                const upperIm = im[position]
                const lowerRe = re[match] * weightRe - im[match] * weightIm
                const lowerIm = re[match] * weightIm + im[match] * weightRe

                re[position] = upperRe + lowerRe
                im[position] = upperIm + lowerIm
                re[match] = upperRe - lowerRe
                im[match] = upperIm - lowerIm

                const nextWeightRe = weightRe * stepRe - weightIm * stepIm
                const nextWeightIm = weightRe * stepIm + weightIm * stepRe
                weightRe = nextWeightRe
                weightIm = nextWeightIm
            }
        }
    }

    if (inverse) {
        for (let i = 0; i < n; i++) {
            re[i] /= n
            im[i] /= n
        }
    }
}

/**
 * Bluestein 算法，计算任意长度的高性能一维 FFT。
 * @param re 实部数组
 * @param im 虚部数组
 * @param inverse 是否逆变换
 */
export function bluesteinFFT(re: Float64Array, im: Float64Array, inverse = false): void {
    if (re.length !== im.length) {
        throw new RangeError("FFT 实部和虚部长度必须一致")
    }

    const n = re.length
    if (n <= 1) return
    if ((n & (n - 1)) === 0) {
        radix2FFT(re, im, inverse)
        return
    }

    let convolutionLength = 1
    while (convolutionLength < 2 * n - 1) convolutionLength <<= 1

    const sign = inverse ? 1 : -1
    const aRe = new Float64Array(convolutionLength)
    const aIm = new Float64Array(convolutionLength)
    const bRe = new Float64Array(convolutionLength)
    const bIm = new Float64Array(convolutionLength)

    for (let k = 0; k < n; k++) {
        const angle = (sign * Math.PI * ((k * k) % (2 * n))) / n
        const cosAngle = Math.cos(angle)
        const sinAngle = Math.sin(angle)
        bRe[k] = cosAngle
        bIm[k] = sinAngle
        if (k > 0) {
            bRe[convolutionLength - k] = cosAngle
            bIm[convolutionLength - k] = sinAngle
        }

        aRe[k] = re[k] * cosAngle + im[k] * sinAngle
        aIm[k] = -re[k] * sinAngle + im[k] * cosAngle
    }

    radix2FFT(aRe, aIm, false)
    radix2FFT(bRe, bIm, false)

    const convolutionRe = new Float64Array(convolutionLength)
    const convolutionIm = new Float64Array(convolutionLength)
    for (let i = 0; i < convolutionLength; i++) {
        convolutionRe[i] = aRe[i] * bRe[i] - aIm[i] * bIm[i]
        convolutionIm[i] = aRe[i] * bIm[i] + aIm[i] * bRe[i]
    }
    radix2FFT(convolutionRe, convolutionIm, true)

    const factor = inverse ? 1 / n : 1
    for (let k = 0; k < n; k++) {
        const angle = (sign * Math.PI * ((k * k) % (2 * n))) / n
        const cosAngle = Math.cos(angle)
        const sinAngle = -Math.sin(angle)
        const resultRe = convolutionRe[k] * cosAngle - convolutionIm[k] * sinAngle
        const resultIm = convolutionRe[k] * sinAngle + convolutionIm[k] * cosAngle
        re[k] = resultRe * factor
        im[k] = resultIm * factor
    }
}

/**
 * 计算二维 FFT，支持任意正整数宽高。
 * @param re 实部矩阵，按行存储
 * @param im 虚部矩阵，按行存储
 * @param width 矩阵宽度
 * @param height 矩阵高度
 * @param inverse 是否逆变换
 */
export function fft2D(
    re: Float64Array,
    im: Float64Array,
    width: number,
    height: number,
    inverse = false
): void {
    assertValidMatrix(re, width, height)
    assertValidMatrix(im, width, height)

    const rowRe = new Float64Array(width)
    const rowIm = new Float64Array(width)
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width
        for (let x = 0; x < width; x++) {
            rowRe[x] = re[rowOffset + x]
            rowIm[x] = im[rowOffset + x]
        }
        bluesteinFFT(rowRe, rowIm, inverse)
        for (let x = 0; x < width; x++) {
            re[rowOffset + x] = rowRe[x]
            im[rowOffset + x] = rowIm[x]
        }
    }

    const columnRe = new Float64Array(height)
    const columnIm = new Float64Array(height)
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            columnRe[y] = re[y * width + x]
            columnIm[y] = im[y * width + x]
        }
        bluesteinFFT(columnRe, columnIm, inverse)
        for (let y = 0; y < height; y++) {
            re[y * width + x] = columnRe[y]
            im[y * width + x] = columnIm[y]
        }
    }
}

/**
 * 将零频分量移动到频谱中心。
 * @param data 待移动的矩阵
 * @param width 矩阵宽度
 * @param height 矩阵高度
 */
export function fftShift(data: Float64Array, width: number, height: number): Float64Array {
    assertValidMatrix(data, width, height)
    const out = new Float64Array(width * height)
    const halfWidth = Math.floor(width / 2)
    const halfHeight = Math.floor(height / 2)

    for (let y = 0; y < height; y++) {
        const newY = (y + halfHeight) % height
        for (let x = 0; x < width; x++) {
            const newX = (x + halfWidth) % width
            out[newY * width + newX] = data[y * width + x]
        }
    }
    return out
}

/**
 * 将中心零频还原到 FFT 原始排列。
 * @param data 待移动的矩阵
 * @param width 矩阵宽度
 * @param height 矩阵高度
 */
export function ifftShift(data: Float64Array, width: number, height: number): Float64Array {
    assertValidMatrix(data, width, height)
    const out = new Float64Array(width * height)
    const halfWidth = Math.ceil(width / 2)
    const halfHeight = Math.ceil(height / 2)

    for (let y = 0; y < height; y++) {
        const newY = (y + halfHeight) % height
        for (let x = 0; x < width; x++) {
            const newX = (x + halfWidth) % width
            out[newY * width + newX] = data[y * width + x]
        }
    }
    return out
}

/**
 * 计算二维离散哈特莱变换，将实数图像映射为实数频谱。
 * @param input 输入实数矩阵
 * @param width 矩阵宽度
 * @param height 矩阵高度
 */
export function dht2D(input: Float64Array, width: number, height: number): Float64Array {
    assertValidMatrix(input, width, height)
    const re = new Float64Array(input)
    const im = new Float64Array(width * height)
    fft2D(re, im, width, height, false)

    const out = new Float64Array(width * height)
    for (let i = 0; i < out.length; i++) {
        out[i] = re[i] - im[i]
    }
    return out
}

/**
 * 计算二维逆离散哈特莱变换，将实数频谱还原为空间域矩阵。
 * @param dht 输入哈特莱频谱
 * @param width 矩阵宽度
 * @param height 矩阵高度
 */
export function idht2D(dht: Float64Array, width: number, height: number): Float64Array {
    assertValidMatrix(dht, width, height)
    const re = new Float64Array(dht)
    const im = new Float64Array(width * height)
    fft2D(re, im, width, height, false)

    const out = new Float64Array(width * height)
    const factor = 1 / (width * height)
    for (let i = 0; i < out.length; i++) {
        out[i] = (re[i] - im[i]) * factor
    }
    return out
}

/**
 * 计算给定尺寸下 DHT 系数的安全幅值上限。
 * @param width 图像宽度
 * @param height 图像高度
 */
function getFrequencyBound(width: number, height: number): number {
    return MAX_PIXEL_VALUE * width * height
}

/**
 * 将一个有符号频域系数压缩为 8 位像素值。
 * @param value 频域系数
 * @param bound 当前尺寸下的频域幅值上限
 */
function encodeFrequencyValue(value: number, bound: number): number {
    if (!Number.isFinite(value) || value === 0) return 128

    const normalizedMagnitude = Math.min(1, Math.abs(value) / bound)
    const logarithmicMagnitude =
        Math.log1p(normalizedMagnitude * FREQUENCY_LOG_BASE) /
        FREQUENCY_LOG_DENOMINATOR
    const signedValue = value < 0 ? -logarithmicMagnitude : logarithmicMagnitude
    return clampByte((signedValue + 1) * 127.5)
}

/**
 * 将 8 位像素值还原为有符号频域系数。
 * @param value 频域像素值
 * @param bound 当前尺寸下的频域幅值上限
 */
function decodeFrequencyValue(value: number, bound: number): number {
    if (value === 128) return 0

    const signedValue = value / 127.5 - 1
    const magnitude =
        Math.expm1(Math.abs(signedValue) * FREQUENCY_LOG_DENOMINATOR) /
        FREQUENCY_LOG_BASE
    return Math.sign(signedValue) * magnitude * bound
}

/**
 * 将频域矩阵编码到 RGB 像素通道，并在 alpha 通道记录零频排列方式。
 * @param channels 三个颜色通道的频域矩阵
 * @param width 图像宽度
 * @param height 图像高度
 * @param center 是否已经将零频移动到中心
 */
function encodeFrequencyImage(
    channels: readonly Float64Array[],
    width: number,
    height: number,
    center: boolean
): ImageDataLike {
    const out = createImageDataLike(width, height)
    const outData = out.data
    const bound = getFrequencyBound(width, height)
    const alpha = center ? MAX_PIXEL_VALUE : UNCENTERED_ALPHA

    for (let i = 0; i < width * height; i++) {
        const pixelOffset = i * CHANNEL_COUNT
        for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
            outData[pixelOffset + channel] = encodeFrequencyValue(
                channels[channel][i],
                bound
            )
        }
        outData[pixelOffset + 3] = alpha
    }
    return out
}

/**
 * 从频域图像 RGB 通道解码出频域矩阵。
 * @param fdImage 频域图像
 */
function decodeFrequencyChannels(fdImage: ImageDataLike): Float64Array[] {
    const { width, height, data } = fdImage
    const bound = getFrequencyBound(width, height)
    const channels = Array.from(
        { length: COLOR_CHANNEL_COUNT },
        () => new Float64Array(width * height)
    )

    for (let i = 0; i < width * height; i++) {
        const pixelOffset = i * CHANNEL_COUNT
        for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
            channels[channel][i] = decodeFrequencyValue(
                data[pixelOffset + channel],
                bound
            )
        }
    }
    return channels
}

/**
 * 读取频域图的零频排列方式。
 * @param fdImage 频域图像
 */
function isCenteredFrequencyImage(fdImage: ImageDataLike): boolean {
    return fdImage.data[3] !== UNCENTERED_ALPHA
}

/**
 * 将一个频域索引映射到缩放前的中心频谱索引。
 * @param index 缩放后索引
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
 * 将一个频域索引映射到缩放前的未居中频谱索引。
 * @param index 缩放后索引
 * @param sourceSize 源尺寸
 * @param targetSize 目标尺寸
 */
function mapUncenteredFrequencyIndex(
    index: number,
    sourceSize: number,
    targetSize: number
): number {
    const signedIndex = index <= Math.floor(targetSize / 2) ? index : index - targetSize
    return signedIndex >= 0 ? signedIndex : sourceSize + signedIndex
}

/**
 * 按低频优先原则裁剪或补零一个频域矩阵。
 * @param source 源频域矩阵
 * @param sourceWidth 源宽度
 * @param sourceHeight 源高度
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 * @param center 是否使用中心零频排列
 */
function resizeFrequencyChannel(
    source: Float64Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    center: boolean
): Float64Array {
    const target = new Float64Array(targetWidth * targetHeight)
    const scale = (targetWidth * targetHeight) / (sourceWidth * sourceHeight)

    for (let y = 0; y < targetHeight; y++) {
        const sourceY = center
            ? mapCenteredFrequencyIndex(y, sourceHeight, targetHeight)
            : mapUncenteredFrequencyIndex(y, sourceHeight, targetHeight)
        if (sourceY < 0 || sourceY >= sourceHeight) continue

        for (let x = 0; x < targetWidth; x++) {
            const sourceX = center
                ? mapCenteredFrequencyIndex(x, sourceWidth, targetWidth)
                : mapUncenteredFrequencyIndex(x, sourceWidth, targetWidth)
            if (sourceX < 0 || sourceX >= sourceWidth) continue

            target[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX] * scale
        }
    }
    return target
}

/**
 * 将原始图像转换为自包含的二维 FFT 频域图像。
 *
 * RGB 三个通道分别保存三个颜色通道的 DHT 频谱，频谱使用带符号对数编码，
 * 因此写入 PNG 后不依赖进程内缓存也可以逆变换。alpha 通道记录零频是否居中。
 * @param imageData 原始图像像素数据
 * @param options 变换选项
 */
export async function image2fd_by_fft(
    imageData: ImageDataLike,
    options: FftOptions = {}
): Promise<ImageDataLike> {
    assertValidImageData(imageData)
    const { width, height, data } = imageData
    const center = options.center ?? true
    const channels: Float64Array[] = []

    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const spatial = new Float64Array(width * height)
        for (let i = 0; i < spatial.length; i++) {
            spatial[i] = data[i * CHANNEL_COUNT + channel]
        }

        const frequency = dht2D(spatial, width, height)
        channels.push(center ? fftShift(frequency, width, height) : frequency)
    }

    return encodeFrequencyImage(channels, width, height, center)
}

/**
 * 缩放频域图像，按中心低频优先裁剪或补零，并保持目标图像尺寸。
 * @param fdImage 频域图像
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
export function scale_fd_by_fft(
    fdImage: ImageDataLike,
    targetWidth: number,
    targetHeight: number
): ImageDataLike {
    assertValidImageData(fdImage)
    assertValidDimensions(targetWidth, targetHeight)

    if (fdImage.width === targetWidth && fdImage.height === targetHeight) {
        return fdImage
    }

    const center = isCenteredFrequencyImage(fdImage)
    const sourceChannels = decodeFrequencyChannels(fdImage)
    const targetChannels = sourceChannels.map((source) =>
        resizeFrequencyChannel(
            source,
            fdImage.width,
            fdImage.height,
            targetWidth,
            targetHeight,
            center
        )
    )

    return encodeFrequencyImage(targetChannels, targetWidth, targetHeight, center)
}

/**
 * 将自包含的二维 FFT 频域图像逆变换为空间域图像。
 * @param fdImageData 频域图像像素数据
 */
export async function fd2image_by_fft(
    fdImageData: ImageDataLike
): Promise<ImageDataLike> {
    assertValidImageData(fdImageData)
    const { width, height } = fdImageData
    const out = createImageDataLike(width, height)
    const outData = out.data
    const center = isCenteredFrequencyImage(fdImageData)
    const channels = decodeFrequencyChannels(fdImageData)

    for (let channel = 0; channel < COLOR_CHANNEL_COUNT; channel++) {
        const unshifted = center
            ? ifftShift(channels[channel], width, height)
            : channels[channel]
        const restored = idht2D(unshifted, width, height)

        for (let i = 0; i < restored.length; i++) {
            outData[i * CHANNEL_COUNT + channel] = clampByte(restored[i])
        }
    }

    for (let i = 0; i < width * height; i++) {
        outData[i * CHANNEL_COUNT + 3] = MAX_PIXEL_VALUE
    }
    return out
}
