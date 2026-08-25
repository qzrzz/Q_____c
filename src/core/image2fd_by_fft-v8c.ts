/**
 * v8c 彩色高容量局部 DHT 载体。
 * 亮度均值提供 JPEG 基础层，色度均值与正交纹理为 PNG 保存 144 个优先频谱系数。
 */
export {
    fd2image_by_fft_v8c,
    image2fd_by_fft_v8c,
    scale_fd_by_fft_v8c,
    type FdV8cDecodeOptions,
} from "./image2fd_by_fft-v8"
