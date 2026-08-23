import chalk from "chalk"
import {
    benchmarkFn,
    type BenchmarkOptions,
    type BenchmarkReport,
    type TransformPair,
} from "./test/benchmarkFn"
import {
    fd2image_by_fft_v4,
    image2fd_by_fft_v4,
} from "./image2fd_by_fft-v4"

/** 基于 v3 并加入三级不等强度 JPEG 保护的 v4 算法对。 */
export const fftV4TransformPair: TransformPair = {
    name: "image2fd_by_fft-v4",
    image2fd: image2fd_by_fft_v4,
    fd2image: fd2image_by_fft_v4,
}

/**
 * 运行 image2fd_by_fft-v4 的全套基准测试。
 * @param options 基准测试配置
 */
export async function runImage2fdByFftV4Benchmark(
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    console.log(chalk.cyan.bold("🚀 开始执行 image2fd_by_fft-v4 频域算法基准测试...\n"))
    return benchmarkFn(fftV4TransformPair, options)
}

if (import.meta.main) {
    await runImage2fdByFftV4Benchmark()
}
