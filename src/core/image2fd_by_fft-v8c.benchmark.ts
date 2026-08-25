import chalk from "chalk"
import {
    benchmarkFn,
    type BenchmarkOptions,
    type BenchmarkReport,
    type TransformPair,
} from "./test/benchmarkFn"
import {
    fd2image_by_fft_v8c,
    image2fd_by_fft_v8c,
} from "./image2fd_by_fft-v8c"

const BENCHMARK_PASSWORD = "image2fd-by-fft-v8c-benchmark"

/** 彩色分层局部 8x8 DHT 载体算法对。 */
export const fftV8cTransformPair: TransformPair = {
    name: "image2fd_by_fft-v8c",
    image2fd: (image) => image2fd_by_fft_v8c(image, BENCHMARK_PASSWORD),
    fd2image: (image) => fd2image_by_fft_v8c(image, BENCHMARK_PASSWORD),
}

/**
 * 运行 image2fd_by_fft-v8c 的完整基准测试。
 * @param options 基准测试配置
 */
export async function runImage2fdByFftV8cBenchmark(
    options: BenchmarkOptions = {}
): Promise<BenchmarkReport> {
    console.log(chalk.cyan.bold("🚀 开始执行 image2fd_by_fft-v8c 彩色频域基准测试...\n"))
    return benchmarkFn(fftV8cTransformPair, {
        scales: [],
        jpegScales: [1],
        ...options,
    })
}

if (import.meta.main) await runImage2fdByFftV8cBenchmark()
