/// <reference types="vitest/globals" />
import { resolve } from "node:path"
import { createImageDataLike, resize_image } from "../../../../src/core/image2fd_by_fft"
import { image2fd_by_fft_v7 } from "../../../../src/core/image2fd_by_fft-v7"
import { image2fd_by_fft_v8 } from "../../../../src/core/image2fd_by_fft-v8"
import { image2fd_by_fft_v8c } from "../../../../src/core/image2fd_by_fft-v8c"
import { readImageFile, transcodeBrowserLikeJpeg } from "../../../../src/core/test/benchmarkFn"
import * as autoDecoder from "../../../../src/helper/decodeImageQcAuto"
import { detectEditorAlgorithm } from "../detectAlgorithm"

const codecs = [
    { version: "v8c", encode: image2fd_by_fft_v8c },
    { version: "v8", encode: image2fd_by_fft_v8 },
    { version: "v7", encode: image2fd_by_fft_v7 },
] as const

/** 创建两块位于整图不同位置的实际载体。 @param versions 需要写入的版本索引 */
async function createFixture(versions: number[]) {
    const source = resize_image(readImageFile(resolve("sample/照片.jpg")).image, 64, 64)
    const image = createImageDataLike(176, 96)
    const rects = []
    for (let index = 0; index < versions.length; index++) {
        const rect = { x: index * 80 + 16, y: 16, width: 64, height: 64 }
        const carrier = await codecs[versions[index]].encode(source, "测试密码")
        for (let y = 0; y < 64; y++) {
            image.data.set(carrier.data.subarray(y * 64 * 4, (y + 1) * 64 * 4), ((rect.y + y) * image.width + rect.x) * 4)
        }
        rects.push(rect)
    }
    return { image, rects }
}

for (let index = 0; index < codecs.length; index++) {
    test.each([0, 90])(`导入 ${codecs[index].version} 图片后推荐对应具体版本，JPEG 质量 %i`, async (quality) => {
        const { image, rects } = await createFixture([index, index])
        const input = quality ? transcodeBrowserLikeJpeg(image, quality) : image
        const before = input.data.slice()
        expect(await detectEditorAlgorithm(input, rects, "测试密码")).toBe(codecs[index].version)
        expect(input.data).toEqual(before)
    })
}

test("混合版本不能随意选中其中一个全局档位", async () => {
    const { image, rects } = await createFixture([0, 1])
    expect(await detectEditorAlgorithm(image, rects, "测试密码")).toBeNull()
})

test("第一个区域误报时继续尝试其他区域", async () => {
    const { image, rects } = await createFixture([0])
    const falsePositive = { x: 96, y: 16, width: 64, height: 64 }
    expect(await detectEditorAlgorithm(image, [falsePositive, ...rects], "测试密码")).toBe("v8c")
})

test("错误密码或没有区域时不推荐版本", async () => {
    const { image, rects } = await createFixture([0])
    expect(await detectEditorAlgorithm(image, rects, "错误密码")).toBeNull()
    expect(await detectEditorAlgorithm(image, [], "测试密码")).toBeNull()
})

test("环境故障应上报给编辑器，而非伪装成识别不确定", async () => {
    const { image, rects } = await createFixture([0])
    const spy = vi.spyOn(autoDecoder, "decodeImageQcAuto").mockRejectedValue(new Error("测试环境故障"))
    try {
        await expect(detectEditorAlgorithm(image, rects, "测试密码")).rejects.toThrow("测试环境故障")
    } finally {
        spy.mockRestore()
    }
})
