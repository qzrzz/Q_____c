import chalk from "chalk"
import {
    benchmarkFn,
    type BenchmarkOptions,
    type BenchmarkReport,
    type TransformPair,
} from "./test/benchmarkFn"
import {
    fd2image_by_fft_v3,
    image2fd_by_fft_v3,
} from "./image2fd_by_fft-v3"

/** 基于 v1 频谱裁剪模型并加入 JPEG 冗余编码的 v3 算法对。 */
export const fftV3TransformPair: TransformPair = {
    name: "image2fd_by_fft-v3",
    image2fd: image2fd_by_fft_v3,
    fd2image: fd2image_by_fft_v3,
}

/**
 * 运行 image2fd_by_fft-v3 的全套基准测试。
 * @param options 基准测试配置
 */
export async function runImage2fdByFftV3Benchmark(
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    console.log(chalk.cyan.bold("🚀 开始执行 image2fd_by_fft-v3 频域算法基准测试...\n"))
    return benchmarkFn(fftV3TransformPair, options)
}

if (import.meta.main) {
    await runImage2fdByFftV3Benchmark()
}
