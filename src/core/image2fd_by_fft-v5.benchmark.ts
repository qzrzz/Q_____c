import chalk from "chalk"
import {
    benchmarkFn,
    type BenchmarkOptions,
    type BenchmarkReport,
    type TransformPair,
} from "./test/benchmarkFn"
import {
    fd2image_by_fft_v5,
    image2fd_by_fft_v5,
} from "./image2fd_by_fft-v5"

/** 分层 4x4 频域载体编码算法对。 */
export const fftV5TransformPair: TransformPair = {
    name: "image2fd_by_fft-v5",
    image2fd: image2fd_by_fft_v5,
    fd2image: fd2image_by_fft_v5,
}

/**
 * 运行 image2fd_by_fft-v5 的完整基准测试。
 * @param options 基准测试配置
 */
export async function runImage2fdByFftV5Benchmark(
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    console.log(chalk.cyan.bold("🚀 开始执行 image2fd_by_fft-v5 分层载体基准测试...\n"))
    return benchmarkFn(fftV5TransformPair, options)
}

if (import.meta.main) {
    await runImage2fdByFftV5Benchmark()
}
