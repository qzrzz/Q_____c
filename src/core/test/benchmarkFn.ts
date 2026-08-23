/**
 * 图像频域变换基准测试评估工具。
 *
 * 针对时域与频域变换算法对（例如 image2fd_by_fft / fd2image_by_fft），
 * 进行完整的全流程质量评测，包括：
 * 1. 1x 基础频域变换与逆变换还原
 * 2. 频域抗缩放测试（0.8x, 0.5x, 0.3x）与还原
 * 3. 频域抗 JPEG 再编码压缩测试（Q90/Q70, 1x/0.8x/0.5x）与还原
 * 4. 计算 PSNR、SSIM、MSE、MAE 等图像客观质量指标
 * 5. 生成结构化测试报告与多彩终端可视化输出
 */

import chalk from "chalk"
import * as fs from "node:fs"
import * as path from "node:path"
import { PNG } from "pngjs"
import jpeg from "jpeg-js"
import { type ImageDataLike, resize_image } from "../image2fd_by_fft"

/**
 * 图像客观质量评估指标集合。
 */
export interface ImageMetrics {
    /** 峰值信噪比（单位：dB），越大越好；两图完全一致时为 Infinity */
    psnr: number
    /** 结构相似性指标（范围：-1 ~ 1，通常 0 ~ 1），越接近 1 越好 */
    ssim: number
    /** 均方误差（Mean Squared Error），越小越好 */
    mse: number
    /** 平均绝对误差（Mean Absolute Error），越小越好 */
    mae: number
}

/**
 * 待评测的图像变换算法对接口。
 */
export interface TransformPair {
    /** 算法名称，例如 "2D-FFT/DHT" 或 "Global DCT-II" */
    name: string
    /** 原图转频域图的正变换函数 */
    image2fd: (image: ImageDataLike) => Promise<ImageDataLike> | ImageDataLike
    /** 频域图还原回原图的逆变换函数 */
    fd2image: (fdImage: ImageDataLike) => Promise<ImageDataLike> | ImageDataLike
}

/**
 * 单个测试用例场景分类。
 */
export type BenchmarkCategory = "basic" | "scale" | "jpeg"

/**
 * 单个测试用例执行结果。
 */
export interface BenchmarkCaseResult {
    /** 场景分类：基础 1x / 抗缩放 / 抗 JPEG */
    category: BenchmarkCategory
    /** 测试用例名称，如 "1x 逆变换"、"频域缩放 0.8x"、"JPEG Q90 1x" 等 */
    caseName: string
    /** 缩放比例，如 1.0, 0.8, 0.5, 0.3 */
    scale: number
    /** JPEG 质量（仅在抗 JPEG 场景存在，如 90, 70） */
    jpegQuality?: number
    /** 原图尺寸 */
    originalSize: { width: number; height: number }
    /** 还原图与基准参考图尺寸 */
    targetSize: { width: number; height: number }
    /** 频域图尺寸 */
    fdSize: { width: number; height: number }
    /** 质量评估指标 */
    metrics: ImageMetrics
    /** 频域编码耗时（毫秒） */
    encodeTimeMs: number
    /** 频域逆变换还原耗时（毫秒） */
    decodeTimeMs: number
    /** 频域图像保存文件路径（若启用了保存） */
    fdFilePath?: string
    /** 还原图像保存文件路径（若启用了保存） */
    restoredFilePath?: string
}

/**
 * 单张图片的评测结果汇总。
 */
export interface BenchmarkImageResult {
    /** 图像名称（不含扩展名），如 "截图"、"插画"、"照片" */
    imageName: string
    /** 原始文件路径（若从文件加载） */
    sourcePath?: string
    /** 原始尺寸 */
    width: number
    height: number
    /** 原图 raw PNG 保存文件路径 */
    rawPngPath?: string
    /** 所有测试用例的结果列表 */
    cases: BenchmarkCaseResult[]
}

/**
 * 自定义测试输入图片类型。
 */
export type BenchmarkImageInput =
    | string
    | {
          name: string
          image: ImageDataLike
          sourcePath?: string
      }

/**
 * 评测选项配置。
 */
export interface BenchmarkOptions {
    /**
     * 评测生成的中间图与还原图输出目录。
     * - 若未指定（undefined），默认输出到 `src/core/test/dist/${FnName}/`（按方法名划分独立文件夹）
     * - 若显式传入路径字符串，则输出到指定目录
     * - 若显式设为 null，则不输出文件到磁盘（仅在内存中执行评测并计算指标）
     */
    outputDir?: string | null
    /** sample 图片目录路径，默认从项目根目录 "./sample" 读取 */
    sampleDir?: string
    /** 自定义测试图片列表（支持文件路径字符串或已加载的 ImageDataLike 及其命名） */
    images?: BenchmarkImageInput[]
    /** 抗缩放测试比例列表，默认为 [0.8, 0.5, 0.3] */
    scales?: number[]
    /** 抗 JPEG 测试质量列表，默认为 [90, 70] */
    jpegQualities?: number[]
    /** 抗 JPEG 组合测试缩放比例列表，默认为 [1.0, 0.8, 0.5] */
    jpegScales?: number[]
    /** 是否在终端打印多彩测试报告，默认为 true */
    printReport?: boolean
    /** 是否在 outputDir 生成 Markdown 格式测试报告文件，默认为 true */
    generateReportMarkdown?: boolean
    /** 是否在每次运行生成前清空输出目录下的旧结果文件，默认为 true */
    cleanOutputDir?: boolean
}

/**
 * 获取算法方法名对应的安全输出文件夹名称。
 * @param name 算法方法名
 */
export function getSafeFolderName(name: string): string {
    if (!name || !name.trim()) return "default"
    return name.trim().replace(/[\\/:*?"<>|]/g, "_")
}

/**
 * 获取默认输出目录路径：src/core/test/dist/${FnName}/
 * @param transformName 算法方法名
 */
export function getDefaultOutputDir(transformName: string): string {
    const folderName = getSafeFolderName(transformName)
    return path.resolve("src/core/test/dist", folderName)
}

/**
 * 完整评测报告对象。
 */
export interface BenchmarkReport {
    /** 算法名称 */
    transformName: string
    /** 评测开始时间 */
    timestamp: Date
    /** 总耗时（毫秒） */
    totalDurationMs: number
    /** 每张图片的评测结果 */
    imageResults: BenchmarkImageResult[]
    /** Markdown 格式报告文本 */
    markdown: string
}

/**
 * 计算两张同尺寸图像的均方误差（MSE）。
 * @param imgA 第一张图像
 * @param imgB 第二张图像
 */
export function calculateMSE(imgA: ImageDataLike, imgB: ImageDataLike): number {
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        throw new Error(
            `计算 MSE 时图像尺寸必须相同: A=${imgA.width}x${imgA.height}, B=${imgB.width}x${imgB.height}`
        )
    }

    const totalPixels = imgA.width * imgA.height
    const dataA = imgA.data
    const dataB = imgB.data
    let totalSquareError = 0

    // 只计算 RGB 三个通道的误差
    for (let i = 0; i < totalPixels; i++) {
        const offset = i * 4
        const diffR = dataA[offset] - dataB[offset]
        const diffG = dataA[offset + 1] - dataB[offset + 1]
        const diffB = dataA[offset + 2] - dataB[offset + 2]
        totalSquareError += diffR * diffR + diffG * diffG + diffB * diffB
    }

    return totalSquareError / (totalPixels * 3)
}

/**
 * 计算两张同尺寸图像的平均绝对误差（MAE）。
 * @param imgA 第一张图像
 * @param imgB 第二张图像
 */
export function calculateMAE(imgA: ImageDataLike, imgB: ImageDataLike): number {
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        throw new Error(
            `计算 MAE 时图像尺寸必须相同: A=${imgA.width}x${imgA.height}, B=${imgB.width}x${imgB.height}`
        )
    }

    const totalPixels = imgA.width * imgA.height
    const dataA = imgA.data
    const dataB = imgB.data
    let totalAbsError = 0

    for (let i = 0; i < totalPixels; i++) {
        const offset = i * 4
        totalAbsError +=
            Math.abs(dataA[offset] - dataB[offset]) +
            Math.abs(dataA[offset + 1] - dataB[offset + 1]) +
            Math.abs(dataA[offset + 2] - dataB[offset + 2])
    }

    return totalAbsError / (totalPixels * 3)
}

/**
 * 计算两张同尺寸图像的峰值信噪比（PSNR，单位为 dB）。
 * @param imgA 第一张图像
 * @param imgB 第二张图像
 */
export function calculatePSNR(imgA: ImageDataLike, imgB: ImageDataLike): number {
    const mse = calculateMSE(imgA, imgB)
    if (mse === 0) {
        return Infinity
    }
    return 10 * Math.log10((255 * 255) / mse)
}

/**
 * 使用分块统计方法计算两张同尺寸图像的结构相似性（SSIM，范围 0 ~ 1）。
 * @param imgA 第一张图像
 * @param imgB 第二张图像
 * @param blockSize 统计分块大小，默认为 8
 */
export function calculateSSIM(
    imgA: ImageDataLike,
    imgB: ImageDataLike,
    blockSize = 8
): number {
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        throw new Error(
            `计算 SSIM 时图像尺寸必须相同: A=${imgA.width}x${imgA.height}, B=${imgB.width}x${imgB.height}`
        )
    }

    const width = imgA.width
    const height = imgA.height
    const dataA = imgA.data
    const dataB = imgB.data

    const numBlocksX = Math.floor(width / blockSize)
    const numBlocksY = Math.floor(height / blockSize)

    if (numBlocksX === 0 || numBlocksY === 0) {
        return 1.0
    }

    const c1 = 6.5025 // (0.01 * 255)^2
    const c2 = 58.5225 // (0.03 * 255)^2
    const blockSizeSquared = blockSize * blockSize

    let totalSsim = 0
    let totalBlockCount = 0

    // 分别对 RGB 三个通道进行分块统计
    for (let channel = 0; channel < 3; channel++) {
        for (let blockY = 0; blockY < numBlocksY; blockY++) {
            for (let blockX = 0; blockX < numBlocksX; blockX++) {
                let sumA = 0
                let sumB = 0
                let sumSquareA = 0
                let sumSquareB = 0
                let sumCrossAB = 0

                for (let dy = 0; dy < blockSize; dy++) {
                    const y = blockY * blockSize + dy
                    const rowOffset = y * width
                    for (let dx = 0; dx < blockSize; dx++) {
                        const x = blockX * blockSize + dx
                        const offset = (rowOffset + x) * 4 + channel
                        const valA = dataA[offset]
                        const valB = dataB[offset]

                        sumA += valA
                        sumB += valB
                        sumSquareA += valA * valA
                        sumSquareB += valB * valB
                        sumCrossAB += valA * valB
                    }
                }

                const meanA = sumA / blockSizeSquared
                const meanB = sumB / blockSizeSquared
                const varianceA = sumSquareA / blockSizeSquared - meanA * meanA
                const varianceB = sumSquareB / blockSizeSquared - meanB * meanB
                const covarianceAB = sumCrossAB / blockSizeSquared - meanA * meanB

                const numerator = (2 * meanA * meanB + c1) * (2 * covarianceAB + c2)
                const denominator =
                    (meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2)

                totalSsim += numerator / denominator
                totalBlockCount++
            }
        }
    }

    return totalBlockCount > 0 ? totalSsim / totalBlockCount : 1.0
}

/**
 * 综合计算两张同尺寸图像的全部客观质量指标（PSNR, SSIM, MSE, MAE）。
 * @param target 目标待测图像（还原图像）
 * @param reference 基准参考图像（原图或下采样后的原图）
 */
export function calculateImageMetrics(
    target: ImageDataLike,
    reference: ImageDataLike
): ImageMetrics {
    const mse = calculateMSE(target, reference)
    const mae = calculateMAE(target, reference)
    const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
    const ssim = calculateSSIM(target, reference)
    return { psnr, ssim, mse, mae }
}

/**
 * 从文件系统读取并解码图像文件（支持 PNG 与 JPEG 格式）。
 * @param filePath 图像文件绝对路径或相对路径
 */
export function readImageFile(filePath: string): {
    name: string
    image: ImageDataLike
    sourcePath: string
} {
    const absolutePath = path.resolve(filePath)
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`找不到图像文件: ${absolutePath}`)
    }

    const ext = path.extname(absolutePath).toLowerCase()
    const fileNameWithoutExt = path.basename(absolutePath, path.extname(absolutePath))
    const fileBuffer = fs.readFileSync(absolutePath)

    if (ext === ".png") {
        const png = PNG.sync.read(fileBuffer)
        const image: ImageDataLike = {
            width: png.width,
            height: png.height,
            data: new Uint8ClampedArray(
                png.data.buffer,
                png.data.byteOffset,
                png.data.length
            ),
        }
        return { name: fileNameWithoutExt, image, sourcePath: absolutePath }
    }

    if (ext === ".jpg" || ext === ".jpeg") {
        const decoded = jpeg.decode(fileBuffer, { useTArray: true })
        const image: ImageDataLike = {
            width: decoded.width,
            height: decoded.height,
            data: new Uint8ClampedArray(
                decoded.data.buffer,
                decoded.data.byteOffset,
                decoded.data.byteLength
            ),
        }
        return { name: fileNameWithoutExt, image, sourcePath: absolutePath }
    }

    throw new Error(`不支持的图像格式: ${ext}，仅支持 .png, .jpg, .jpeg`)
}

/**
 * 将 ImageDataLike 编码并写入 PNG 文件。
 * @param filePath 目标文件路径
 * @param image 图像数据
 */
export function writePngFile(filePath: string, image: ImageDataLike): void {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }

    const png = new PNG({ width: image.width, height: image.height })
    png.data = Buffer.from(
        image.data.buffer,
        image.data.byteOffset,
        image.data.byteLength
    )
    const buffer = PNG.sync.write(png)
    fs.writeFileSync(filePath, buffer)
}

/**
 * 执行一次浏览器风格的 4:2:0 JPEG 内存编解码。
 * 亮度按原分辨率量化，Cb/Cr 在半分辨率量化后再放大，模拟 Canvas JPEG 的 MCU 路径。
 * @param image 待转码图像
 * @param quality JPEG 质量（1-100）
 */
export function transcodeBrowserLikeJpeg(
    image: ImageDataLike,
    quality: number
): ImageDataLike {
    const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))
    const luminanceData = new Uint8ClampedArray(image.data.length)
    const chromaWidth = Math.ceil(image.width / 2)
    const chromaHeight = Math.ceil(image.height / 2)
    const chromaData = new Uint8ClampedArray(chromaWidth * chromaHeight * 4)

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const offset = (y * image.width + x) * 4
            const luminance = clamp(
                0.299 * image.data[offset] +
                    0.587 * image.data[offset + 1] +
                    0.114 * image.data[offset + 2]
            )
            luminanceData[offset] = luminance
            luminanceData[offset + 1] = luminance
            luminanceData[offset + 2] = luminance
            luminanceData[offset + 3] = 255
        }
    }

    for (let y = 0; y < chromaHeight; y++) {
        for (let x = 0; x < chromaWidth; x++) {
            let red = 0
            let green = 0
            let blue = 0
            let count = 0
            for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const sourceX = x * 2 + dx
                    const sourceY = y * 2 + dy
                    if (sourceX >= image.width || sourceY >= image.height) continue
                    const offset = (sourceY * image.width + sourceX) * 4
                    red += image.data[offset]
                    green += image.data[offset + 1]
                    blue += image.data[offset + 2]
                    count++
                }
            }
            const offset = (y * chromaWidth + x) * 4
            chromaData[offset] = clamp(red / count)
            chromaData[offset + 1] = clamp(green / count)
            chromaData[offset + 2] = clamp(blue / count)
            chromaData[offset + 3] = 255
        }
    }

    const encodeAndDecode = (width: number, height: number, data: Uint8ClampedArray) =>
        decodeJpegBuffer(
            jpeg.encode(
                { width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) },
                quality
            ).data
        )
    const decodedLuminance = encodeAndDecode(image.width, image.height, luminanceData)
    const decodedChroma = encodeAndDecode(chromaWidth, chromaHeight, chromaData)
    const output = new Uint8ClampedArray(image.data.length)

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const offset = (y * image.width + x) * 4
            const chromaOffset =
                (Math.floor(y / 2) * chromaWidth + Math.floor(x / 2)) * 4
            const luminance = decodedLuminance.data[offset]
            const chromaRedValue = decodedChroma.data[chromaOffset]
            const chromaGreenValue = decodedChroma.data[chromaOffset + 1]
            const chromaBlueValue = decodedChroma.data[chromaOffset + 2]
            const chromaBlue =
                128 -
                0.168736 * chromaRedValue -
                0.331264 * chromaGreenValue +
                0.5 * chromaBlueValue
            const chromaRed =
                128 +
                0.5 * chromaRedValue -
                0.418688 * chromaGreenValue -
                0.081312 * chromaBlueValue
            const blueDelta = chromaBlue - 128
            const redDelta = chromaRed - 128
            output[offset] = clamp(luminance + 1.402 * redDelta)
            output[offset + 1] = clamp(
                luminance - 0.344136 * blueDelta - 0.714136 * redDelta
            )
            output[offset + 2] = clamp(luminance + 1.772 * blueDelta)
            output[offset + 3] = 255
        }
    }
    return { width: image.width, height: image.height, data: output }
}

/**
 * 将 ImageDataLike 编码并写入 JPEG 文件。
 * @param filePath 目标文件路径
 * @param image 图像数据
 * @param quality JPEG 编码质量（1-100）
 */
export function writeJpegFile(
    filePath: string,
    image: ImageDataLike,
    quality: number
): Buffer {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }

    const rawData = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    const encoded = jpeg.encode({ width: image.width, height: image.height, data: rawData }, quality)
    fs.writeFileSync(filePath, encoded.data)
    return encoded.data
}

/**
 * 将 JPEG 缓冲区解码为 ImageDataLike。
 * @param buffer JPEG 文件缓冲区
 */
export function decodeJpegBuffer(buffer: Buffer | Uint8Array): ImageDataLike {
    const decoded = jpeg.decode(buffer, { useTArray: true })
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

/**
 * 对单张图像执行完整的全流程基准评测。
 * @param imageInput 待测试图像输入（文件路径或已解析的图像对象）
 * @param transform 待评测的算法对
 * @param options 评测选项
 */
export async function runBenchmarkOnImage(
    imageInput: BenchmarkImageInput,
    transform: TransformPair,
    options: BenchmarkOptions = {}
): Promise<BenchmarkImageResult> {
    let imageName: string
    let originalImage: ImageDataLike
    let sourcePath: string | undefined

    if (typeof imageInput === "string") {
        const loaded = readImageFile(imageInput)
        imageName = loaded.name
        originalImage = loaded.image
        sourcePath = loaded.sourcePath
    } else {
        imageName = imageInput.name
        originalImage = imageInput.image
        sourcePath = imageInput.sourcePath
    }

    const outputDir =
        options.outputDir === null
            ? null
            : options.outputDir !== undefined
            ? path.resolve(options.outputDir)
            : getDefaultOutputDir(transform.name)

    const scales = options.scales ?? [0.8, 0.5, 0.3]
    const jpegQualities = options.jpegQualities ?? [90, 70]
    const jpegScales = options.jpegScales ?? [1.0, 0.8, 0.5]

    const originalWidth = originalImage.width
    const originalHeight = originalImage.height
    const cases: BenchmarkCaseResult[] = []

    // 1. 原图 -> 原图.raw.png
    let rawPngPath: string | undefined
    if (outputDir) {
        rawPngPath = path.join(outputDir, `${imageName}.raw.png`)
        writePngFile(rawPngPath, originalImage)
    }

    // 2. 原图.raw.png -> 原图_fd_1x.png（原图转换为频域图 1x 尺寸）
    const encode1xStart = performance.now()
    const fd1x = await transform.image2fd(originalImage)
    const encode1xDuration = performance.now() - encode1xStart

    let fd1xPath: string | undefined
    if (outputDir) {
        fd1xPath = path.join(outputDir, `${imageName}_fd_1x.png`)
        writePngFile(fd1xPath, fd1x)
    }

    // 3. 原图_fd_1x.png -> 逆运算 -> 原图_re_1x.png 逆变换回原图 1x 尺寸
    const decode1xStart = performance.now()
    const re1x = await transform.fd2image(fd1x)
    const decode1xDuration = performance.now() - decode1xStart

    let re1xPath: string | undefined
    if (outputDir) {
        re1xPath = path.join(outputDir, `${imageName}_re_1x.png`)
        writePngFile(re1xPath, re1x)
    }

    const metrics1x = calculateImageMetrics(re1x, originalImage)
    cases.push({
        category: "basic",
        caseName: "1x 逆变换",
        scale: 1.0,
        originalSize: { width: originalWidth, height: originalHeight },
        targetSize: { width: re1x.width, height: re1x.height },
        fdSize: { width: fd1x.width, height: fd1x.height },
        metrics: metrics1x,
        encodeTimeMs: encode1xDuration,
        decodeTimeMs: decode1xDuration,
        fdFilePath: fd1xPath,
        restoredFilePath: re1xPath,
    })

    // 4. 抗缩放测试：
    // 原图_fd_1x.png -> 缩放 -> 原图_fd_{scale}x.png
    // 原图_fd_{scale}x.png -> 逆运算 -> 原图_re_{scale}x.png
    for (const scale of scales) {
        const targetWidth = Math.max(1, Math.round(originalWidth * scale))
        const targetHeight = Math.max(1, Math.round(originalHeight * scale))

        const scaleStart = performance.now()
        // 基准必须直接缩放载体，不能调用“解码、缩放、重新编码”的专用 API。
        const scaledFd = resize_image(fd1x, targetWidth, targetHeight)
        const scaleDuration = performance.now() - scaleStart

        let fdScalePath: string | undefined
        if (outputDir) {
            fdScalePath = path.join(outputDir, `${imageName}_fd_${scale}x.png`)
            writePngFile(fdScalePath, scaledFd)
        }

        const decodeScaleStart = performance.now()
        const restoredScale = await transform.fd2image(scaledFd)
        const decodeScaleDuration = performance.now() - decodeScaleStart

        let reScalePath: string | undefined
        if (outputDir) {
            reScalePath = path.join(outputDir, `${imageName}_re_${scale}x.png`)
            writePngFile(reScalePath, restoredScale)
        }

        // 以同尺寸双线性下采样原图作为质量比较基准
        const referenceScaled = resize_image(originalImage, targetWidth, targetHeight)
        const metricsScale = calculateImageMetrics(restoredScale, referenceScaled)

        cases.push({
            category: "scale",
            caseName: `频域缩放 ${scale}x`,
            scale,
            originalSize: { width: originalWidth, height: originalHeight },
            targetSize: { width: restoredScale.width, height: restoredScale.height },
            fdSize: { width: scaledFd.width, height: scaledFd.height },
            metrics: metricsScale,
            encodeTimeMs: encode1xDuration + scaleDuration,
            decodeTimeMs: decodeScaleDuration,
            fdFilePath: fdScalePath,
            restoredFilePath: reScalePath,
        })
    }

    // 5. 抗 JPEG 测试：
    // 原图_fd_1x.png -> (缩放 + ) JPEG 压缩 -> 原图_fd_jpeg_Q{quality}_{scale}x.jpg
    // 原图_fd_jpeg_Q{quality}_{scale}x.jpg -> 逆运算 -> 原图_re_jpeg_Q{quality}_{scale}x.png
    for (const scale of jpegScales) {
        const targetWidth = Math.max(1, Math.round(originalWidth * scale))
        const targetHeight = Math.max(1, Math.round(originalHeight * scale))

        let sourceFdToCompress: ImageDataLike
        let scaleTime = 0
        if (scale === 1.0) {
            sourceFdToCompress = fd1x
        } else {
            const scaleStart = performance.now()
            // 模拟用户直接缩放已经生成的载体，再交给 JPEG 编码器。
            sourceFdToCompress = resize_image(fd1x, targetWidth, targetHeight)
            scaleTime = performance.now() - scaleStart
        }

        for (const quality of jpegQualities) {
            const scaleSuffix = scale === 1.0 ? "1x" : `${scale}x`
            let jpegFdPath: string | undefined
            const decodedFd = transcodeBrowserLikeJpeg(sourceFdToCompress, quality)
            if (outputDir) {
                jpegFdPath = path.join(
                    outputDir,
                    `${imageName}_fd_jpeg_Q${quality}_${scaleSuffix}.jpg`
                )
                // 文件仅用于观察已经过 4:2:0 转码的载体；质量指标直接使用 decodedFd。
                writeJpegFile(jpegFdPath, decodedFd, 100)
            }

            // 逆运算还原
            const decodeJpegStart = performance.now()
            const restoredJpeg = await transform.fd2image(decodedFd)
            const decodeJpegDuration = performance.now() - decodeJpegStart

            let reJpegPath: string | undefined
            if (outputDir) {
                reJpegPath = path.join(
                    outputDir,
                    `${imageName}_re_jpeg_Q${quality}_${scaleSuffix}.png`
                )
                writePngFile(reJpegPath, restoredJpeg)
            }

            // 参考基准原图
            const referenceImage =
                scale === 1.0
                    ? originalImage
                    : resize_image(originalImage, targetWidth, targetHeight)

            const metricsJpeg = calculateImageMetrics(restoredJpeg, referenceImage)

            cases.push({
                category: "jpeg",
                caseName: `JPEG Q${quality} ${scaleSuffix}`,
                scale,
                jpegQuality: quality,
                originalSize: { width: originalWidth, height: originalHeight },
                targetSize: { width: restoredJpeg.width, height: restoredJpeg.height },
                fdSize: { width: decodedFd.width, height: decodedFd.height },
                metrics: metricsJpeg,
                encodeTimeMs: encode1xDuration + scaleTime,
                decodeTimeMs: decodeJpegDuration,
                fdFilePath: jpegFdPath,
                restoredFilePath: reJpegPath,
            })
        }
    }

    return {
        imageName,
        sourcePath,
        width: originalWidth,
        height: originalHeight,
        rawPngPath,
        cases,
    }
}

/**
 * 格式化 PSNR 数值并附加颜色。
 * @param psnr PSNR 数值
 */
function formatPsnrColor(psnr: number): string {
    if (!Number.isFinite(psnr)) {
        return chalk.green.bold("∞ dB")
    }
    const str = `${psnr.toFixed(2)} dB`
    if (psnr >= 30) return chalk.green.bold(str)
    if (psnr >= 20) return chalk.cyan.bold(str)
    if (psnr >= 12) return chalk.yellow(str)
    return chalk.red(str)
}

/**
 * 格式化 SSIM 数值并附加颜色。
 * @param ssim SSIM 数值
 */
function formatSsimColor(ssim: number): string {
    const str = ssim.toFixed(4)
    if (ssim >= 0.95) return chalk.green.bold(str)
    if (ssim >= 0.8) return chalk.cyan(str)
    if (ssim >= 0.6) return chalk.yellow(str)
    return chalk.red(str)
}

/**
 * 格式化生成 Markdown 格式的评测报告。
 * @param transformName 算法名称
 * @param timestamp 评测时间戳
 * @param totalDurationMs 总评测耗时
 * @param imageResults 图片测试结果列表
 */
export function formatBenchmarkReportMarkdown(
    transformName: string,
    timestamp: Date,
    totalDurationMs: number,
    imageResults: BenchmarkImageResult[]
): string {
    const lines: string[] = []

    lines.push(`# 频域变换算法评测报告`)
    lines.push(``)
    lines.push(`- **算法名称**：\`${transformName}\``)
    lines.push(`- **评测时间**：${timestamp.toLocaleString()}`)
    lines.push(`- **总耗时**：${(totalDurationMs / 1000).toFixed(2)} 秒`)
    lines.push(`- **评测图片数**：${imageResults.length} 张`)
    lines.push(``)

    lines.push(`## 评测汇总表`)
    lines.push(``)

    // 构建所有用例名称集合
    const caseNames: string[] = []
    if (imageResults.length > 0) {
        for (const c of imageResults[0].cases) {
            caseNames.push(c.caseName)
        }
    }

    lines.push(
        `| 测试场景 | ` +
            imageResults.map((r) => `${r.imageName} (${r.width}×${r.height}) PSNR`).join(" | ") +
            ` | 平均 PSNR | 平均 SSIM |`
    )
    lines.push(
        `| :--- | ` +
            imageResults.map(() => `:---:`).join(" | ") +
            ` | :---: | :---: |`
    )

    for (let i = 0; i < caseNames.length; i++) {
        const cName = caseNames[i]
        const psnrValues: number[] = []
        const ssimValues: number[] = []
        const rowCells: string[] = [`| **${cName}**`]

        for (const imgRes of imageResults) {
            const c = imgRes.cases[i]
            if (c) {
                psnrValues.push(c.metrics.psnr)
                ssimValues.push(c.metrics.ssim)
                const psnrStr = Number.isFinite(c.metrics.psnr)
                    ? `${c.metrics.psnr.toFixed(2)} dB`
                    : `∞ dB`
                rowCells.push(`${psnrStr}`)
            } else {
                rowCells.push(`-`)
            }
        }

        const validPsnrs = psnrValues.filter((v) => Number.isFinite(v))
        const avgPsnr =
            validPsnrs.length > 0
                ? (validPsnrs.reduce((a, b) => a + b, 0) / validPsnrs.length).toFixed(2) + " dB"
                : "∞ dB"
        const avgSsim =
            ssimValues.length > 0
                ? (ssimValues.reduce((a, b) => a + b, 0) / ssimValues.length).toFixed(4)
                : "-"

        rowCells.push(avgPsnr)
        rowCells.push(avgSsim)
        lines.push(rowCells.join(" | ") + ` |`)
    }

    lines.push(``)

    // 每张图片的详细结果
    for (const imgRes of imageResults) {
        lines.push(`### 图片：${imgRes.imageName} (${imgRes.width}×${imgRes.height})`)
        lines.push(``)
        lines.push(
            `| 场景分类 | 测试用例 | 尺寸 | PSNR (dB) | SSIM | MSE | MAE | 编码耗时 | 解码耗时 |`
        )
        lines.push(
            `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`
        )

        for (const c of imgRes.cases) {
            const categoryLabel =
                c.category === "basic"
                    ? "基础"
                    : c.category === "scale"
                    ? "抗缩放"
                    : "抗 JPEG"
            const sizeStr = `${c.targetSize.width}×${c.targetSize.height}`
            const psnrStr = Number.isFinite(c.metrics.psnr)
                ? c.metrics.psnr.toFixed(2)
                : "∞"
            const ssimStr = c.metrics.ssim.toFixed(4)
            const mseStr = c.metrics.mse.toFixed(2)
            const maeStr = c.metrics.mae.toFixed(2)
            const encTime = `${c.encodeTimeMs.toFixed(1)} ms`
            const decTime = `${c.decodeTimeMs.toFixed(1)} ms`

            lines.push(
                `| ${categoryLabel} | ${c.caseName} | ${sizeStr} | ${psnrStr} | ${ssimStr} | ${mseStr} | ${maeStr} | ${encTime} | ${decTime} |`
            )
        }
        lines.push(``)
    }

    return lines.join("\n")
}

/**
 * 在终端中打印多彩、美观的可视化评测结果报告。
 * @param report 评测报告对象
 */
export function printBenchmarkReport(report: BenchmarkReport): void {
    console.log(``)
    console.log(
        chalk.bgCyan.black.bold(` 📊 频域变换算法评测报告: ${report.transformName} `)
    )
    console.log(
        chalk.gray(
            `评测时间: ${report.timestamp.toLocaleString()} | 总耗时: ${(
                report.totalDurationMs / 1000
            ).toFixed(2)}s | 测试图片数: ${report.imageResults.length}`
        )
    )
    console.log(chalk.gray(`─`.repeat(88)))

    for (const imgRes of report.imageResults) {
        console.log(
            chalk.magenta.bold(`\n🖼️  图像: ${imgRes.imageName} `) +
                chalk.gray(`(${imgRes.width} × ${imgRes.height})`)
        )

        // 表头
        const header =
            chalk.bold("  测试场景".padEnd(20)) +
            chalk.bold("目标尺寸".padEnd(14)) +
            chalk.bold("PSNR (dB)".padEnd(14)) +
            chalk.bold("SSIM".padEnd(12)) +
            chalk.bold("MSE".padEnd(10)) +
            chalk.bold("解码耗时".padEnd(12))
        console.log(chalk.blue(header))
        console.log(chalk.gray(`  ${"─".repeat(80)}`))

        for (const c of imgRes.cases) {
            const nameStr = `  ${c.caseName}`.padEnd(20)
            const sizeStr = `${c.targetSize.width}×${c.targetSize.height}`.padEnd(14)
            const psnrStr = formatPsnrColor(c.metrics.psnr).padEnd(23)
            const ssimStr = formatSsimColor(c.metrics.ssim).padEnd(21)
            const mseStr = `${c.metrics.mse.toFixed(2)}`.padEnd(10)
            const timeStr = `${c.decodeTimeMs.toFixed(1)} ms`.padEnd(12)

            console.log(`${nameStr}${sizeStr}${psnrStr}${ssimStr}${mseStr}${timeStr}`)
        }
    }

    console.log(chalk.gray(`\n${"─".repeat(88)}`))
    console.log(chalk.green.bold(`✅ 评测完成！`))
    console.log(``)
}

/**
 * 核心基准测试入口函数：对指定算法对进行 sample 图片全流程测试并输出质量报告。
 *
 * @param transform 待测试的图像变换算法对（例如 { name: 'FFT', image2fd: image2fd_by_fft, fd2image: fd2image_by_fft }）
 * @param options 评测选项（包含 outputDir, sampleDir, images, scales, jpegQualities 等）
 */
export async function benchmarkFn(
    transform: TransformPair,
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    const startTime = performance.now()
    const timestamp = new Date()
    const printReport = options.printReport ?? true
    const generateReportMarkdown = options.generateReportMarkdown ?? true

    // 解析待测试的图片列表
    let imageInputs: BenchmarkImageInput[] = []
    if (options.images && options.images.length > 0) {
        imageInputs = options.images
    } else {
        const sampleDir = path.resolve(options.sampleDir ?? "./sample")
        if (fs.existsSync(sampleDir)) {
            const files = fs.readdirSync(sampleDir)
            for (const file of files) {
                const ext = path.extname(file).toLowerCase()
                if ([".png", ".jpg", ".jpeg"].includes(ext)) {
                    imageInputs.push(path.join(sampleDir, file))
                }
            }
        }
    }

    if (imageInputs.length === 0) {
        throw new Error(
            `未找到任何可用于测试的图片。请指定 sampleDir 或在 options.images 中传入图片。`
        )
    }

    const outputDir =
        options.outputDir === null
            ? null
            : options.outputDir !== undefined
            ? path.resolve(options.outputDir)
            : getDefaultOutputDir(transform.name)

    // 每次生成前清空旧结果文件夹
    const cleanOutputDir = options.cleanOutputDir ?? true
    if (outputDir && cleanOutputDir && fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true })
    }
    if (outputDir && !fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
    }

    // 逐张图片执行全套测试流程
    const imageResults: BenchmarkImageResult[] = []
    for (const input of imageInputs) {
        const res = await runBenchmarkOnImage(input, transform, options)
        imageResults.push(res)
    }

    const totalDurationMs = performance.now() - startTime

    // 生成 Markdown 报告
    const markdown = formatBenchmarkReportMarkdown(
        transform.name,
        timestamp,
        totalDurationMs,
        imageResults
    )

    // 若指定或默认启用了 outputDir 且允许生成 Markdown 报告，写入 report.md
    if (outputDir && generateReportMarkdown) {
        const reportPath = path.join(outputDir, "report.md")
        fs.writeFileSync(reportPath, markdown, "utf-8")
    }

    const report: BenchmarkReport = {
        transformName: transform.name,
        timestamp,
        totalDurationMs,
        imageResults,
        markdown,
    }

    // 终端多彩打印
    if (printReport) {
        printBenchmarkReport(report)
    }

    return report
}
