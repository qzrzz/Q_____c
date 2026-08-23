/**
 * 任意长度快速傅里叶变换（FFT）实现。
 *
 * 支持任意正整数长度：
 * - 长度为 2 的幂：使用迭代 Radix-2 FFT（最高性能）。
 * - 一般合数长度：使用混合基（Mixed-Radix）DIT 分解，素数因子逐个拆解。
 * - 大素数长度（> 61）：回退到 Bluestein 算法（利用 2 的幂 FFT 计算卷积）。
 *
 * 约定：正变换 X(k) = Σ x(j)·e^{-2πikj/N}，逆变换为其共轭并除以 N。
 * 注意：项目旧版 bluesteinFFT 的"正/逆"符号约定与标准相反（往返测试无法发现），
 * 因此本模块自带标准约定的实现，不依赖旧代码。
 */

import { radix2FFT } from "./image2fd_by_fft"

/** 直接 O(N²) DFT 的最大素数长度阈值，超过则使用 Bluestein。 */
const DIRECT_DFT_MAX_PRIME = 61

/** 小素数表，用于快速分解。 */
const PRIME_FACTORS = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61,
]

/**
 * 判断一个正整数是否为 2 的幂。
 * @param n 待判断的整数
 */
function isPowerOfTwo(n: number): boolean {
    return n > 0 && (n & (n - 1)) === 0
}

/**
 * 求正整数的最小素因子；若本身就是素数则返回自身。
 * @param n 待分解的整数
 */
function smallestPrimeFactor(n: number): number {
    for (const p of PRIME_FACTORS) {
        if (n % p === 0) return p
    }
    return n
}

/**
 * 直接 O(N²) DFT，仅用于小素数叶子节点。
 * @param re 实部数组（原位变换）
 * @param im 虚部数组（原位变换）
 * @param n 变换长度
 * @param inverse 是否逆变换（仅符号翻转，归一化由外层处理）
 */
function directDft(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
    const sign = inverse ? 1 : -1
    const outRe = new Float64Array(n)
    const outIm = new Float64Array(n)
    for (let k = 0; k < n; k++) {
        let sumRe = 0
        let sumIm = 0
        for (let j = 0; j < n; j++) {
            const angle = (sign * 2 * Math.PI * k * j) / n
            const cosAngle = Math.cos(angle)
            const sinAngle = Math.sin(angle)
            sumRe += re[j] * cosAngle - im[j] * sinAngle
            sumIm += re[j] * sinAngle + im[j] * cosAngle
        }
        outRe[k] = sumRe
        outIm[k] = sumIm
    }
    re.set(outRe)
    im.set(outIm)
}

/**
 * 标准约定的 Bluestein FFT，用于大素数长度（> 61）。
 * 正变换：X(k) = Σ x(j)·e^{-2πikj/N}。
 * @param re 实部数组（原位变换）
 * @param im 虚部数组（原位变换）
 * @param n 变换长度
 * @param inverse 是否逆变换（含 1/N 归一化）
 */
function bluesteinStandard(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
    if (n <= 1) return
    // 卷积长度需要 ≥ 2N-1，向上取 2 的幂
    let convolutionLength = 1
    while (convolutionLength < 2 * n - 1) convolutionLength <<= 1

    const sign = inverse ? 1 : -1
    // 线性调频因子：W = e^{-2πi·sign/N}，W^{t²/2} 的相位角为 -sign·π·t²/N
    const aRe = new Float64Array(convolutionLength)
    const aIm = new Float64Array(convolutionLength)
    const bRe = new Float64Array(convolutionLength)
    const bIm = new Float64Array(convolutionLength)

    for (let k = 0; k < n; k++) {
        const angle = (sign * Math.PI * ((k * k) % (2 * n))) / n
        const cosAngle = Math.cos(angle)
        const sinAngle = Math.sin(angle)
        // b(t) = W^{-t²/2} = e^{-i·sign·π·t²/N}，t ∈ [-(N-1), N-1]，负半轴折回数组尾部（周期 2N）
        bRe[k] = cosAngle
        bIm[k] = -sinAngle
        if (k > 0) {
            bRe[convolutionLength - k] = cosAngle
            bIm[convolutionLength - k] = -sinAngle
        }
        // a(j) = x(j)·W^{j²/2} = x·e^{i·sign·π·j²/N}
        aRe[k] = re[k] * cosAngle - im[k] * sinAngle
        aIm[k] = re[k] * sinAngle + im[k] * cosAngle
    }

    radix2FFT(aRe, aIm, false)
    radix2FFT(bRe, bIm, false)
    for (let i = 0; i < convolutionLength; i++) {
        const cRe = aRe[i] * bRe[i] - aIm[i] * bIm[i]
        const cIm = aRe[i] * bIm[i] + aIm[i] * bRe[i]
        aRe[i] = cRe
        aIm[i] = cIm
    }
    radix2FFT(aRe, aIm, true)

    const factor = inverse ? 1 / n : 1
    for (let k = 0; k < n; k++) {
        const angle = (sign * Math.PI * ((k * k) % (2 * n))) / n
        const cosAngle = Math.cos(angle)
        const sinAngle = Math.sin(angle)
        // X(k) = W^{k²/2}·c(k) = c·e^{i·sign·π·k²/N}
        const resultRe = aRe[k] * cosAngle - aIm[k] * sinAngle
        const resultIm = aRe[k] * sinAngle + aIm[k] * cosAngle
        re[k] = resultRe * factor
        im[k] = resultIm * factor
    }
}

/**
 * 混合基 DIT 递归核心。
 *
 * 将长度为 n = r·m 的变换拆成 r 个长度为 m 的子序列（stride r 抽样），
 * 递归变换后按 X(j + t·m) = Σ_q W_n^{q(j+tm)}·G_q(j) 合并。
 * workRe/workIm 为长度 ≥ n 的工作区，与 re/im 交替使用避免反复分配。
 * @param re 实部数组（原位变换，长度 n）
 * @param im 虚部数组（原位变换，长度 n）
 * @param n 变换长度
 * @param inverse 是否逆变换（符号翻转；1/N 归一化由外层处理）
 * @param workRe 工作区实部（长度 ≥ n）
 * @param workIm 工作区虚部（长度 ≥ n）
 */
function mixedRadixCore(
    re: Float64Array,
    im: Float64Array,
    n: number,
    inverse: boolean,
    workRe: Float64Array,
    workIm: Float64Array
): void {
    if (n <= 1) return
    const r = smallestPrimeFactor(n)
    if (r === n) {
        // 素数叶子节点
        if (n > DIRECT_DFT_MAX_PRIME) {
            bluesteinStandard(re, im, n, inverse)
        } else {
            directDft(re, im, n, inverse)
        }
        return
    }

    const m = n / r
    const sign = inverse ? 1 : -1

    // 转置收集：work[q·m + t] = re[t·r + q]，把 r 个子序列连续存放
    for (let t = 0; t < m; t++) {
        const base = t * r
        for (let q = 0; q < r; q++) {
            workRe[q * m + t] = re[base + q]
            workIm[q * m + t] = im[base + q]
        }
    }

    // 递归变换每个子序列；子问题以 work 段为输入输出，re/im 作为其工作区
    for (let q = 0; q < r; q++) {
        mixedRadixCore(
            workRe.subarray(q * m, (q + 1) * m),
            workIm.subarray(q * m, (q + 1) * m),
            m,
            inverse,
            re,
            im
        )
    }

    // 预计算本层旋转因子表：W_n^k = e^{sign·2πik/n}，k = 0..n-1
    const twiddleRe = new Float64Array(n)
    const twiddleIm = new Float64Array(n)
    for (let k = 0; k < n; k++) {
        const angle = (sign * 2 * Math.PI * k) / n
        twiddleRe[k] = Math.cos(angle)
        twiddleIm[k] = Math.sin(angle)
    }

    // 合并：X(j + t·m) = Σ_q W_n^{qj}·W_r^{qt}·G_q(j)
    for (let j = 0; j < m; j++) {
        // 先乘 W_n^{qj} 得到 v_q
        const vRe = new Float64Array(r)
        const vIm = new Float64Array(r)
        for (let q = 0; q < r; q++) {
            const idx = (q * j) % n
            const wRe = twiddleRe[idx]
            const wIm = twiddleIm[idx]
            const gRe = workRe[q * m + j]
            const gIm = workIm[q * m + j]
            vRe[q] = gRe * wRe - gIm * wIm
            vIm[q] = gRe * wIm + gIm * wRe
        }
        // 对 q 做 r 点 DFT（含 W_r^{qt}）
        for (let t = 0; t < r; t++) {
            let sumRe = 0
            let sumIm = 0
            for (let q = 0; q < r; q++) {
                const idx = (q * t) % r
                const wRe = twiddleRe[(idx * n) / r]
                const wIm = twiddleIm[(idx * n) / r]
                sumRe += vRe[q] * wRe - vIm[q] * wIm
                sumIm += vRe[q] * wIm + vIm[q] * wRe
            }
            re[j + t * m] = sumRe
            im[j + t * m] = sumIm
        }
    }
}

/**
 * 任意长度快速傅里叶变换。
 * 正变换：X(k) = Σ x(j)·e^{-2πikj/N}；逆变换：x(j) = (1/N)·Σ X(k)·e^{+2πikj/N}。
 * @param re 实部数组（原位变换）
 * @param im 虚部数组（原位变换）
 * @param inverse 是否逆变换
 */
export function arbitraryFFT(re: Float64Array, im: Float64Array, inverse = false): void {
    if (re.length !== im.length) {
        throw new RangeError("FFT 实部与虚部长度必须一致")
    }
    const n = re.length
    if (n <= 1) return
    if (isPowerOfTwo(n)) {
        radix2FFT(re, im, inverse)
        return
    }
    // 大素数直接走 Bluestein；合数走混合基递归
    if (smallestPrimeFactor(n) === n) {
        bluesteinStandard(re, im, n, inverse)
        return
    }
    const workRe = new Float64Array(n)
    const workIm = new Float64Array(n)
    mixedRadixCore(re, im, n, inverse, workRe, workIm)
    if (inverse) {
        // 混合基路径未做 1/N 归一化，在此统一处理
        for (let i = 0; i < n; i++) {
            re[i] /= n
            im[i] /= n
        }
    }
}
