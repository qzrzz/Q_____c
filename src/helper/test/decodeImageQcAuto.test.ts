import { resolve } from "node:path"
import { createImageDataLike, resize_image, type ImageDataLike } from "../../core/image2fd_by_fft"
import { image2fd_by_fft_v6 } from "../../core/image2fd_by_fft-v6"
import { fd2image_by_fft_v7, image2fd_by_fft_v7 } from "../../core/image2fd_by_fft-v7"
import { fd2image_by_fft_v8, image2fd_by_fft_v8 } from "../../core/image2fd_by_fft-v8"
import { fd2image_by_fft_v8c, image2fd_by_fft_v8c } from "../../core/image2fd_by_fft-v8c"
import * as v8c from "../../core/image2fd_by_fft-v8c"
import * as v8 from "../../core/image2fd_by_fft-v8"
import * as v7 from "../../core/image2fd_by_fft-v7"
import { readImageFile, transcodeBrowserLikeJpeg } from "../../core/test/benchmarkFn"
import { decodeImageQcAuto, ImageQcAutoDecodeError } from "../decodeImageQcAuto"
import { getImageQcRects } from "../getImageQcRects"

const PASSWORD = "主人-自动版本测试"
const codecs = [
    { version: "v8c", encode: image2fd_by_fft_v8c, decode: fd2image_by_fft_v8c },
    { version: "v8", encode: image2fd_by_fft_v8, decode: fd2image_by_fft_v8 },
    {
        version: "v7", encode: image2fd_by_fft_v7,
        /** 统一 v7 无密码解码器的测试调用参数。 @param image 载体 @param _password 忽略密码 */
        decode: (image: ImageDataLike, _password?: string) => fd2image_by_fft_v7(image, {
            encodedWidth: image.width, encodedHeight: image.height,
        }),
    },
] as const

/** 读取固定样本，缩小原图以限制测试耗时，不对编码后的载体做受控缩放。 @param name 样本文件名 */
function sample(name = "照片.jpg"): ImageDataLike {
    return resize_image(readImageFile(resolve("sample", name)).image, 96, 80)
}

for (const name of ["照片.jpg", "插画.JPG", "截图.png"]) {
    for (const codec of codecs) {
        test.each(["PNG", "无 alpha PNG", "JPEG Q90", "JPEG Q70"])(
            `${name} 的 ${codec.version} 经过 %s 后能自动识别且与指定版本解码一致`, async (mode) => {
                const carrier = await codec.encode(sample(name), PASSWORD)
                if (mode === "无 alpha PNG") {
                    for (let offset = 3; offset < carrier.data.length; offset += 4) carrier.data[offset] = 255
                }
                const input = mode.startsWith("JPEG")
                    ? transcodeBrowserLikeJpeg(carrier, mode === "JPEG Q90" ? 90 : 70) : carrier
                const before = input.data.slice()
                const result = await decodeImageQcAuto(input, PASSWORD)
                expect(result.version).toBe(codec.version)
                expect(result.candidates.map((candidate) => candidate.version)).toEqual(["v8c", "v8", "v7"])
                expect(result.validationError).toBeLessThan(12)
                const manual = await codec.decode(input, PASSWORD, {
                    encodedWidth: input.width, encodedHeight: input.height,
                })
                expect(result.image).toEqual(manual)
                expect(input.data).toEqual(before)
            }
        )
    }
}

for (const codec of codecs) {
    test(`${codec.version} 大尺寸载体的探针不得移动密码块坐标`, async () => {
        const carrier = await codec.encode(resize_image(sample(), 192, 176), PASSWORD)
        const result = await decodeImageQcAuto(carrier, PASSWORD)
        expect(result.version).toBe(codec.version)
        expect(result.image.width).toBe(192)
        expect(result.image.height).toBe(176)
    })
    test(`${codec.version} 裁剪偏移一个像素时不能当作成功恢复`, async () => {
        const carrier = await codec.encode(sample(), PASSWORD)
        const shifted = createImageDataLike(carrier.width - 1, carrier.height)
        for (let y = 0; y < carrier.height; y++) {
            shifted.data.set(carrier.data.subarray((y * carrier.width + 1) * 4, (y + 1) * carrier.width * 4), y * shifted.width * 4)
        }
        await expect(decodeImageQcAuto(shifted, PASSWORD)).rejects.toBeInstanceOf(ImageQcAutoDecodeError)
    })
}

for (const codec of codecs.slice(0, 2)) {
    test.each(["", "qzrzz"])(`${codec.version} 支持空密码和默认密码：%s`, async (password) => {
        const carrier = await codec.encode(sample(), "")
        expect((await decodeImageQcAuto(carrier, password)).version).toBe(codec.version)
    })
    test.each([0, 70])(`${codec.version} 错误密码不会被当作其他版本成功，JPEG 质量 %i`, async (quality) => {
        const carrier = await codec.encode(sample(), PASSWORD)
        const input = quality ? transcodeBrowserLikeJpeg(carrier, quality) : carrier
        await expect(decodeImageQcAuto(input, "错误密码")).rejects.toBeInstanceOf(ImageQcAutoDecodeError)
    })
}

test.each(["照片.jpg", "插画.JPG", "截图.png"])("普通样本 %s 不应被当作可解码载体", async (name) => {
    await expect(decodeImageQcAuto(sample(name), PASSWORD)).rejects.toBeInstanceOf(ImageQcAutoDecodeError)
})

for (const name of ["照片.jpg", "插画.JPG", "截图.png"]) {
    test.each([0, 90, 70])(`旧版 v6 ${name} 不应被误认成 v7，JPEG 质量 %i`, async (quality) => {
        const carrier = await image2fd_by_fft_v6(sample(name))
        const input = quality ? transcodeBrowserLikeJpeg(carrier, quality) : carrier
        await expect(decodeImageQcAuto(input, PASSWORD)).rejects.toBeInstanceOf(ImageQcAutoDecodeError)
    })
}

test("随机噪声不应被当作正确解码结果", async () => {
    const image = createImageDataLike(96, 80)
    let seed = 20260826
    for (let offset = 0; offset < image.data.length; offset++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        image.data[offset] = offset % 4 === 3 ? 255 : seed >>> 24
    }
    await expect(decodeImageQcAuto(image, PASSWORD)).rejects.toBeInstanceOf(ImageQcAutoDecodeError)
})

test.each([0, 90])("同一图像混用三个版本时逐区域识别，JPEG 质量 %i", async (quality) => {
    const image = createImageDataLike(464, 128)
    for (let offset = 0; offset < image.data.length; offset += 4) image.data.set([35, 55, 75, 255], offset)
    for (let index = 0; index < codecs.length; index++) {
        const carrier = await codecs[index].encode(resize_image(sample(), 128, 96), PASSWORD)
        for (let y = 0; y < carrier.height; y++) for (let x = 0; x < carrier.width; x++) {
            const offset = ((y + 16) * image.width + index * 144 + 16 + x) * 4
            image.data.set(carrier.data.subarray((y * carrier.width + x) * 4, (y * carrier.width + x) * 4 + 4), offset)
            image.data[offset + 3] = 255
        }
    }
    const input = quality ? transcodeBrowserLikeJpeg(image, quality) : image
    const rects = getImageQcRects(input).sort((a, b) => a.x - b.x)
    expect(rects).toHaveLength(3)
    for (let index = 0; index < rects.length; index++) {
        const rect = rects[index]
        const carrier = createImageDataLike(rect.width, rect.height)
        for (let y = 0; y < rect.height; y++) {
            carrier.data.set(input.data.subarray(((rect.y + y) * input.width + rect.x) * 4,
                ((rect.y + y) * input.width + rect.x + rect.width) * 4), y * rect.width * 4)
        }
        expect((await decodeImageQcAuto(carrier, PASSWORD)).version).toBe(codecs[index].version)
    }
})

test("只有左上探针正常而其余载体损坏时不能报告成功", async () => {
    const carrier = await image2fd_by_fft_v8(resize_image(sample(), 320, 240), PASSWORD)
    for (let y = 0; y < carrier.height; y++) for (let x = 0; x < carrier.width; x++) {
        if (x >= 160 || y >= 160) carrier.data.set([0, 0, 0, 255], (y * carrier.width + x) * 4)
    }
    await expect(decodeImageQcAuto(carrier, PASSWORD)).rejects.toBeInstanceOf(ImageQcAutoDecodeError)
})

test("小区域和非法缓冲区应明确拒绝，不返回伪造的版本", async () => {
    await expect(decodeImageQcAuto(createImageDataLike(16, 16))).rejects.toBeInstanceOf(ImageQcAutoDecodeError)
    await expect(decodeImageQcAuto({ width: 32, height: 32, data: new Uint8Array(4) })).rejects.toBeInstanceOf(RangeError)
})

test("候选误差接近时应报告歧义，而不是选择最先试解的版本", async () => {
    const image = sample()
    // 控制重编码输出来隔离歧义分支；这里不验证具体编解码算法。
    vi.spyOn(v8c, "image2fd_by_fft_v8c").mockResolvedValue(image)
    vi.spyOn(v8, "image2fd_by_fft_v8").mockResolvedValue(image)
    vi.spyOn(v7, "image2fd_by_fft_v7").mockResolvedValue(image)
    try {
        await expect(decodeImageQcAuto(image, PASSWORD)).rejects.toMatchObject({ reason: "ambiguous" })
    } finally {
        vi.restoreAllMocks()
    }
})

test("缺少 Web Crypto 的运行环境应暴露原始错误，不能伪装为密码错误", async () => {
    const image = sample()
    vi.stubGlobal("crypto", undefined)
    try {
        await expect(decodeImageQcAuto(image)).rejects.toThrow("不支持 Web Crypto")
    } finally {
        vi.unstubAllGlobals()
    }
})
