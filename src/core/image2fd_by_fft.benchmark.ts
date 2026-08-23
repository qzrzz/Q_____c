import chalk from "chalk"
import {
    benchmarkFn,
    type BenchmarkOptions,
    type BenchmarkReport,
    type TransformPair,
} from "./test/benchmarkFn"
import {
    fd2image_by_fft,
    image2fd_by_fft,
} from "./image2fd_by_fft"

/**
 * 基于 2D-FFT / DHT 的频域图像变换与逆变换算法对定义。
 */
export const fftTransformPair: TransformPair = {
    name: "image2fd_by_fft",
    image2fd: (image) => image2fd_by_fft(image),
    fd2image: (fdImage) => fd2image_by_fft(fdImage),
}

/**
 * 运行 image2fd_by_fft 算法的全套基准测试评估。
 * 评测流程涵盖：
 * 1. 1x 基础频域变换与逆变换还原（原图与还原图对比）
 * 2. 频域抗缩放测试（0.8x, 0.5x, 0.3x 缩放后逆变换还原）
 * 3. 频域抗 JPEG 再编码压缩测试（Q90/Q70, 1x/0.8x/0.5x 下逆变换还原）
 * 4. 自动计算 PSNR、SSIM、MSE、MAE 图像质量客观指标
 * 5. 在终端打印多彩报告并在输出目录生成 Markdown 报告和生成图像
 *
 * @param options 可选的评测配置选项
 */
export async function runImage2fdByFftBenchmark(
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    console.log(
        chalk.cyan.bold(`🚀 开始执行 image2fd_by_fft 频域算法基准测试...\n`)
    )
    const report = await benchmarkFn(fftTransformPair, options)
    return report
}

// 若通过 bun 直接运行此文件，自动触发基准评测流程
if (import.meta.main) {
    await runImage2fdByFftBenchmark()
}
