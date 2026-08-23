import chalk from "chalk"
import {
    benchmarkFn,
    type BenchmarkOptions,
    type BenchmarkReport,
    type TransformPair,
} from "./test/benchmarkFn"
import {
    fd2image_by_fft_v7,
    image2fd_by_fft_v7,
} from "./image2fd_by_fft-v7"

/** 局部 8x8 DHT 分层载体算法对。 */
export const fftV7TransformPair: TransformPair = {
    name: "image2fd_by_fft-v7",
    image2fd: image2fd_by_fft_v7,
    fd2image: fd2image_by_fft_v7,
}

/**
 * 运行 image2fd_by_fft-v7 的完整基准测试。
 * @param options 基准测试配置
 */
export async function runImage2fdByFftV7Benchmark(
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    console.log(chalk.cyan.bold("🚀 开始执行 image2fd_by_fft-v7 自同步频域基准测试...\n"))
    return benchmarkFn(fftV7TransformPair, options)
}

if (import.meta.main) await runImage2fdByFftV7Benchmark()
