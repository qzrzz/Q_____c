/**
 * 图像频域转换与频域存储核心模块
 */

export * from "./core/image2fd_by_fft"
export * from "./core/image2fd_by_fft-v2"
export * from "./core/image2fd_by_fft-v3"
export * from "./core/image2fd_by_fft-v4"
export * from "./core/image2fd_by_fft-v5"
export * from "./core/image2fd_by_fft-v6"
export * from "./core/image2fd_by_fft-v7"
export * from "./core/image2fd_by_fft-v8"
export * from "./core/frequency_fft"
export * from "./core/test/benchmarkFn"
export * from "./helper/getImageQcRects"

/**
 * 示例打招呼函数
 * @param name 名称
 */
export function hi(name: string): string {
    return `Hello, ${name}!`
}
