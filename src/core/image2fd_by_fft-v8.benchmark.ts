import chalk from "chalk"
import {
    benchmarkFn,
    type BenchmarkOptions,
    type BenchmarkReport,
    type TransformPair,
} from "./test/benchmarkFn"
import {
    fd2image_by_fft_v8,
    image2fd_by_fft_v8,
} from "./image2fd_by_fft-v8"

const BENCHMARK_PASSWORD = "image2fd-by-fft-v8-benchmark"

/** 局部 8x8 DHT 分层载体算法对。 */
export const fftV8TransformPair: TransformPair = {
    name: "image2fd_by_fft-v8",
    image2fd: (image) => image2fd_by_fft_v8(image, BENCHMARK_PASSWORD),
    fd2image: (image) => fd2image_by_fft_v8(image, BENCHMARK_PASSWORD),
}

/**
 * 运行 image2fd_by_fft-v8 的完整基准测试。
 * @param options 基准测试配置
 */
export async function runImage2fdByFftV8Benchmark(
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    console.log(chalk.cyan.bold("🚀 开始执行 image2fd_by_fft-v8 自同步频域基准测试...\n"))
    return benchmarkFn(fftV8TransformPair, options)
}

if (import.meta.main) await runImage2fdByFftV8Benchmark()
