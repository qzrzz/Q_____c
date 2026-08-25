import type { ImageDataLike } from "../core/image2fd_by_fft"

/** 频域马赛克区域。 */
export interface ImageQcRect {
    x: number
    y: number
    width: number
    height: number
    confidence: number
}

interface CellComponent {
    minX: number
    minY: number
    maxX: number
    maxY: number
    cells: number
    score: number
}

const CELL_SIZE = 4
const MIN_RECT_SIZE = 24
const MIN_RECT_AREA = 2048

/**
 * 判断像素是否符合骑马赛克频域图的中性、中心化视觉特征。
 * 旧格式仅读取 RGB；v8c PNG 可额外利用 alpha 格式标记，但不依赖文件元数据。
 * @param data RGBA 像素缓冲区
 * @param offset 像素起始偏移
 */
function isFrequencyPixel(data: Uint8Array | Uint8ClampedArray, offset: number): boolean {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const centerDistance =
        (Math.abs(red - 128) + Math.abs(green - 128) + Math.abs(blue - 128)) / 3
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue)
    return data[offset + 3] === 250 || (centerDistance < 40 && saturation < 30)
}

/**
 * 统计指定像素区域符合频域视觉特征的比例。
 * @param image 输入图像
 * @param x 区域横坐标
 * @param y 区域纵坐标
 * @param width 区域宽度
 * @param height 区域高度
 */
function getFrequencyRatio(
    image: ImageDataLike,
    x: number,
    y: number,
    width: number,
    height: number
): number {
    const left = Math.max(0, x)
    const top = Math.max(0, y)
    const right = Math.min(image.width, x + width)
    const bottom = Math.min(image.height, y + height)
    let matched = 0
    let total = 0
    for (let py = top; py < bottom; py++) {
        for (let px = left; px < right; px++) {
            if (isFrequencyPixel(image.data, (py * image.width + px) * 4)) matched++
            total++
        }
    }
    return total === 0 ? 0 : matched / total
}

/**
 * 计算区域内相邻 RGB 像素的平均变化量，用于区分载体纹理和自然平滑灰区。
 * @param image 输入图像
 * @param x 区域横坐标
 * @param y 区域纵坐标
 * @param width 区域宽度
 * @param height 区域高度
 */
function getTextureEnergy(
    image: ImageDataLike,
    x: number,
    y: number,
    width: number,
    height: number
): number {
    const right = Math.min(image.width, x + width)
    const bottom = Math.min(image.height, y + height)
    let energy = 0
    let comparisons = 0
    for (let py = y; py < bottom; py++) {
        for (let px = x; px < right; px++) {
            const offset = (py * image.width + px) * 4
            if (px + 1 < right) {
                const next = offset + 4
                energy +=
                    (Math.abs(image.data[offset] - image.data[next]) +
                        Math.abs(image.data[offset + 1] - image.data[next + 1]) +
                        Math.abs(image.data[offset + 2] - image.data[next + 2])) /
                    3
                comparisons++
            }
            if (py + 1 < bottom) {
                const next = offset + image.width * 4
                energy +=
                    (Math.abs(image.data[offset] - image.data[next]) +
                        Math.abs(image.data[offset + 1] - image.data[next + 1]) +
                        Math.abs(image.data[offset + 2] - image.data[next + 2])) /
                    3
                comparisons++
            }
        }
    }
    return comparisons === 0 ? 0 : energy / comparisons
}

/**
 * 从布尔网格中收集八邻域连通分量。
 * @param active 活跃单元格
 * @param scores 单元格特征分数
 * @param columns 网格列数
 * @param rows 网格行数
 */
function collectComponents(
    active: Uint8Array,
    scores: Float32Array,
    columns: number,
    rows: number
): CellComponent[] {
    const visited = new Uint8Array(active.length)
    const components: CellComponent[] = []
    for (let start = 0; start < active.length; start++) {
        if (!active[start] || visited[start]) continue
        const queue = [start]
        visited[start] = 1
        const component: CellComponent = {
            minX: columns,
            minY: rows,
            maxX: 0,
            maxY: 0,
            cells: 0,
            score: 0,
        }
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const index = queue[cursor]
            const x = index % columns
            const y = Math.floor(index / columns)
            component.minX = Math.min(component.minX, x)
            component.minY = Math.min(component.minY, y)
            component.maxX = Math.max(component.maxX, x)
            component.maxY = Math.max(component.maxY, y)
            component.cells++
            component.score += scores[index]
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx
                    const ny = y + dy
                    if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue
                    const neighbor = ny * columns + nx
                    if (active[neighbor] && !visited[neighbor]) {
                        visited[neighbor] = 1
                        queue.push(neighbor)
                    }
                }
            }
        }
        components.push(component)
    }
    return components
}

/**
 * 从强频域特征单元向周围弱特征单元生长，填补插画频谱中的亮暗断点。
 * @param active 强特征单元
 * @param ratios 中心化像素比例
 * @param textures 局部纹理能量
 * @param columns 网格列数
 * @param rows 网格行数
 */
function growFrequencyCells(
    active: Uint8Array,
    ratios: Float32Array,
    textures: Float32Array,
    columns: number,
    rows: number
): Uint8Array {
    let current = active
    for (let pass = 0; pass < 2; pass++) {
        const next = current.slice()
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) {
                const index = y * columns + x
                if (current[index] || ratios[index] < 0.38 || textures[index] < 3) continue
                let neighbors = 0
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const nx = x + dx
                        const ny = y + dy
                        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue
                        neighbors += current[ny * columns + nx]
                    }
                }
                if (neighbors >= 4) next[index] = 1
            }
        }
        current = next
    }
    return current
}

/**
 * 依据行列像素命中率把网格边界收紧到真实像素边界。
 * @param image 输入图像
 * @param rect 网格估算区域
 */
function refineRect(image: ImageDataLike, rect: Omit<ImageQcRect, "confidence">): Omit<ImageQcRect, "confidence"> {
    const padding = CELL_SIZE
    let left = Math.max(0, rect.x - padding)
    let right = Math.min(image.width, rect.x + rect.width + padding)
    let top = Math.max(0, rect.y - padding)
    let bottom = Math.min(image.height, rect.y + rect.height + padding)

    while (
        left < right &&
        (getFrequencyRatio(image, left, top, 1, bottom - top) < 0.35 ||
            getTextureEnergy(image, left, top, 1, bottom - top) < 3)
    ) left++
    while (
        right > left &&
        (getFrequencyRatio(image, right - 1, top, 1, bottom - top) < 0.35 ||
            getTextureEnergy(image, right - 1, top, 1, bottom - top) < 3)
    ) right--
    while (
        top < bottom &&
        (getFrequencyRatio(image, left, top, right - left, 1) < 0.35 ||
            getTextureEnergy(image, left, top, right - left, 1) < 3)
    ) top++
    while (
        bottom > top &&
        (getFrequencyRatio(image, left, bottom - 1, right - left, 1) < 0.35 ||
            getTextureEnergy(image, left, bottom - 1, right - left, 1) < 3)
    ) bottom--
    return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 计算一条候选边界两侧相邻 RGB 像素的平均差异。
 * @param image 输入图像
 * @param position 边界坐标，表示右侧或下侧区域的起点
 * @param start 与边界平行方向的起点
 * @param length 与边界平行方向的长度
 * @param vertical 是否为纵向边界
 */
function getEdgeContrast(
    image: ImageDataLike,
    position: number,
    start: number,
    length: number,
    vertical: boolean
): number {
    const parallelLimit = vertical ? image.height : image.width
    const perpendicularLimit = vertical ? image.width : image.height
    if (position <= 0 || position >= perpendicularLimit) return 0
    let difference = 0
    let samples = 0
    const from = Math.max(0, start + CELL_SIZE)
    const to = Math.min(parallelLimit, start + length - CELL_SIZE)
    for (let parallel = from; parallel < to; parallel++) {
        const beforeX = vertical ? position - 1 : parallel
        const beforeY = vertical ? parallel : position - 1
        const afterX = vertical ? position : parallel
        const afterY = vertical ? parallel : position
        const before = (beforeY * image.width + beforeX) * 4
        const after = (afterY * image.width + afterX) * 4
        difference +=
            (Math.abs(image.data[before] - image.data[after]) +
                Math.abs(image.data[before + 1] - image.data[after + 1]) +
                Math.abs(image.data[before + 2] - image.data[after + 2])) /
            3
        samples++
    }
    return samples === 0 ? 0 : difference / samples
}

/**
 * 计算候选边界由背景进入中性载体时的定向特征跃迁。
 * @param image 输入图像
 * @param position 边界坐标
 * @param start 与边界平行方向的起点
 * @param length 与边界平行方向的长度
 * @param vertical 是否为纵向边界
 * @param carrierAfter 边界右侧或下侧是否为载体内部
 */
function getFrequencyEdgeContrast(
    image: ImageDataLike,
    position: number,
    start: number,
    length: number,
    vertical: boolean,
    carrierAfter: boolean
): number {
    // 覆盖完整的 v6 载体周期，防止 2 像素高对比纹理被误认为矩形外边界。
    const strip = CELL_SIZE * 2
    const before = vertical
        ? getFrequencyRatio(image, position - strip, start, strip, length)
        : getFrequencyRatio(image, start, position - strip, length, strip)
    const after = vertical
        ? getFrequencyRatio(image, position, start, strip, length)
        : getFrequencyRatio(image, start, position, length, strip)
    const directedDifference = carrierAfter ? after - before : before - after
    return directedDifference * 100 + getEdgeContrast(image, position, start, length, vertical)
}

/**
 * 在阈值边界附近寻找载体与背景的最强颜色跃迁，校正 JPEG 模糊造成的内缩。
 * 搜索窗口小于 v6 的 8x8 周期，避免误吸附到相邻载体块的内部纹理峰。
 * @param image 输入图像
 * @param rect 依据像素阈值收紧后的区域
 */
function snapRectToEdges(
    image: ImageDataLike,
    rect: Omit<ImageQcRect, "confidence">
): Omit<ImageQcRect, "confidence"> {
    const localRadius = 6
    const expandedRadius = CELL_SIZE * 8
    const originalRight = rect.x + rect.width
    const originalBottom = rect.y + rect.height
    let left = rect.x
    let right = originalRight
    let top = rect.y
    let bottom = originalBottom
    let leftScore = getFrequencyEdgeContrast(image, left, rect.y, rect.height, true, true)
    let rightScore = getFrequencyEdgeContrast(image, right, rect.y, rect.height, true, false)
    let topScore = getFrequencyEdgeContrast(image, top, rect.x, rect.width, false, true)
    let bottomScore = getFrequencyEdgeContrast(image, bottom, rect.x, rect.width, false, false)
    /** 根据当前边界证据强度选择搜索半径，避免强边界被远处的内部纹理替换。 */
    const getSearchRadius = (score: number): number => score < 50 ? expandedRadius : localRadius
    const leftRadius = getSearchRadius(leftScore)
    const rightRadius = getSearchRadius(rightScore)
    const topRadius = getSearchRadius(topScore)
    const bottomRadius = getSearchRadius(bottomScore)

    for (let offset = -expandedRadius; offset <= expandedRadius; offset++) {
        const candidateLeft = rect.x + offset
        const candidateRight = originalRight + offset
        const candidateTop = rect.y + offset
        const candidateBottom = originalBottom + offset
        const candidateLeftScore = getFrequencyEdgeContrast(
            image, candidateLeft, rect.y, rect.height, true, true
        )
        const candidateRightScore = getFrequencyEdgeContrast(
            image, candidateRight, rect.y, rect.height, true, false
        )
        const candidateTopScore = getFrequencyEdgeContrast(
            image, candidateTop, rect.x, rect.width, false, true
        )
        const candidateBottomScore = getFrequencyEdgeContrast(
            image, candidateBottom, rect.x, rect.width, false, false
        )
        if (
            Math.abs(offset) <= leftRadius &&
            candidateLeft >= 0 &&
            candidateLeft <= image.width &&
            candidateLeftScore > leftScore
        ) {
            left = candidateLeft
            leftScore = candidateLeftScore
        }
        if (
            Math.abs(offset) <= rightRadius &&
            candidateRight >= 0 &&
            candidateRight <= image.width &&
            candidateRightScore > rightScore
        ) {
            right = candidateRight
            rightScore = candidateRightScore
        }
        if (
            Math.abs(offset) <= topRadius &&
            candidateTop >= 0 &&
            candidateTop <= image.height &&
            candidateTopScore > topScore
        ) {
            top = candidateTop
            topScore = candidateTopScore
        }
        if (
            Math.abs(offset) <= bottomRadius &&
            candidateBottom >= 0 &&
            candidateBottom <= image.height &&
            candidateBottomScore > bottomScore
        ) {
            bottom = candidateBottom
            bottomScore = candidateBottomScore
        }
    }
    return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 判断像素是否接近 v8c 洋红色识别边框。 @param data RGBA 像素缓冲区 @param offset 像素起始偏移 */
function isV8cBorderPixel(data: Uint8Array | Uint8ClampedArray, offset: number): boolean {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    return red >= 155 && blue >= 150 && green <= 85 &&
        Math.abs(red - blue) <= 45 && red - green >= 75 && blue - green >= 65
}

/** 根据 v8c PNG 的 alpha 格式标记识别未经扁平化的区域。 @param image 输入图像 */
function getV8cAlphaRects(image: ImageDataLike): ImageQcRect[] {
    const columns = Math.ceil(image.width / CELL_SIZE)
    const rows = Math.ceil(image.height / CELL_SIZE)
    const active = new Uint8Array(columns * rows)
    const scores = new Float32Array(columns * rows)
    for (let cellY = 0; cellY < rows; cellY++) for (let cellX = 0; cellX < columns; cellX++) {
        let matched = 0
        let total = 0
        for (let y = cellY * CELL_SIZE; y < Math.min(image.height, (cellY + 1) * CELL_SIZE); y++) {
            for (let x = cellX * CELL_SIZE; x < Math.min(image.width, (cellX + 1) * CELL_SIZE); x++) {
                if (image.data[(y * image.width + x) * 4 + 3] === 250) matched++
                total++
            }
        }
        const index = cellY * columns + cellX
        scores[index] = total === 0 ? 0 : matched / total
        active[index] = matched > 0 ? 1 : 0
    }
    return collectComponents(active, scores, columns, rows)
        .filter((component) => {
            const boxCells =
                (component.maxX - component.minX + 1) *
                (component.maxY - component.minY + 1)
            return component.cells / boxCells >= 0.7
        })
        .map((component) => {
            const left = component.minX * CELL_SIZE
            const top = component.minY * CELL_SIZE
            const right = Math.min(image.width, (component.maxX + 1) * CELL_SIZE)
            const bottom = Math.min(image.height, (component.maxY + 1) * CELL_SIZE)
            let minX = right
            let minY = bottom
            let maxX = left - 1
            let maxY = top - 1
            for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
                if (image.data[(y * image.width + x) * 4 + 3] !== 250) continue
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x)
                maxY = Math.max(maxY, y)
            }
            return {
                x: minX,
                y: minY,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
                confidence: 0.99,
            }
        })
        .filter((rect) => rect.width >= MIN_RECT_SIZE && rect.height >= MIN_RECT_SIZE)
        .filter((rect) => rect.width * rect.height >= MIN_RECT_AREA)
}

/**
 * 根据闭合的洋红色单像素边框识别 v8c 区域。
 * @param image 输入图像
 */
function getV8cBorderRects(image: ImageDataLike): ImageQcRect[] {
    const columns = Math.ceil(image.width / CELL_SIZE)
    const rows = Math.ceil(image.height / CELL_SIZE)
    const active = new Uint8Array(columns * rows)
    const scores = new Float32Array(columns * rows)
    for (let cellY = 0; cellY < rows; cellY++) for (let cellX = 0; cellX < columns; cellX++) {
        let matched = 0
        let total = 0
        for (let y = cellY * CELL_SIZE; y < Math.min(image.height, (cellY + 1) * CELL_SIZE); y++) {
            for (let x = cellX * CELL_SIZE; x < Math.min(image.width, (cellX + 1) * CELL_SIZE); x++) {
                if (isV8cBorderPixel(image.data, (y * image.width + x) * 4)) matched++
                total++
            }
        }
        const index = cellY * columns + cellX
        scores[index] = total === 0 ? 0 : matched / total
        active[index] = matched > 0 ? 1 : 0
    }
    return collectComponents(active, scores, columns, rows)
        .filter((component) => {
            const width = component.maxX - component.minX + 1
            const height = component.maxY - component.minY + 1
            const perimeter = Math.max(1, 2 * width + 2 * height - 4)
            const coverage = component.cells / perimeter
            let top = 0
            let bottom = 0
            let left = 0
            let right = 0
            for (let x = component.minX; x <= component.maxX; x++) {
                top += active[component.minY * columns + x]
                bottom += active[component.maxY * columns + x]
            }
            for (let y = component.minY; y <= component.maxY; y++) {
                left += active[y * columns + component.minX]
                right += active[y * columns + component.maxX]
            }
            return width >= 6 && height >= 6 &&
                coverage >= 0.4 && coverage <= 1.7 &&
                top / width >= 0.5 && bottom / width >= 0.5 &&
                left / height >= 0.5 && right / height >= 0.5
        })
        .map((component) => {
            const left = component.minX * CELL_SIZE
            const top = component.minY * CELL_SIZE
            const right = Math.min(image.width, (component.maxX + 1) * CELL_SIZE)
            const bottom = Math.min(image.height, (component.maxY + 1) * CELL_SIZE)
            let minX = right
            let minY = bottom
            let maxX = left - 1
            let maxY = top - 1
            let matched = 0
            for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
                if (!isV8cBorderPixel(image.data, (y * image.width + x) * 4)) continue
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x)
                maxY = Math.max(maxY, y)
                matched++
            }
            const width = maxX - minX + 1
            const height = maxY - minY + 1
            const perimeter = Math.max(1, 2 * width + 2 * height - 4)
            return {
                x: minX,
                y: minY,
                width,
                height,
                confidence: Math.min(0.99, matched / perimeter),
            }
        })
        .filter((rect) => rect.width >= MIN_RECT_SIZE && rect.height >= MIN_RECT_SIZE)
        .filter((rect) => rect.width * rect.height >= MIN_RECT_AREA)
}

/**
 * 将有损 JPEG 内部纹理识别结果向附近的 v8c 彩色边框扩展。
 * @param image 输入图像
 * @param rect 内部纹理矩形
 */
function snapRectToV8cBorder(
    image: ImageDataLike,
    rect: Omit<ImageQcRect, "confidence">
): Omit<ImageQcRect, "confidence"> {
    let left = rect.x
    let top = rect.y
    let right = rect.x + rect.width
    let bottom = rect.y + rect.height
    const verticalScore = (x: number): number => {
        let matched = 0
        let total = 0
        for (let y = Math.max(0, top - 2); y < Math.min(image.height, bottom + 2); y++) {
            if (isV8cBorderPixel(image.data, (y * image.width + x) * 4)) matched++
            total++
        }
        return total === 0 ? 0 : matched / total
    }
    const horizontalScore = (y: number): number => {
        let matched = 0
        let total = 0
        for (let x = Math.max(0, left - 2); x < Math.min(image.width, right + 2); x++) {
            if (isV8cBorderPixel(image.data, (y * image.width + x) * 4)) matched++
            total++
        }
        return total === 0 ? 0 : matched / total
    }
    let candidateLeft = left
    let candidateRight = right
    let leftScore = 0
    let rightScore = 0
    for (let x = Math.max(0, left - 4); x <= left; x++) {
        const score = verticalScore(x)
        if (score > leftScore) { candidateLeft = x; leftScore = score }
    }
    for (let x = right - 1; x < Math.min(image.width, right + 4); x++) {
        const score = verticalScore(x)
        if (score > rightScore) { candidateRight = x + 1; rightScore = score }
    }
    if (leftScore >= 0.18 && rightScore >= 0.18) {
        left = candidateLeft
        right = candidateRight
    }
    let candidateTop = top
    let candidateBottom = bottom
    let topScore = 0
    let bottomScore = 0
    for (let y = Math.max(0, top - 4); y <= top; y++) {
        const score = horizontalScore(y)
        if (score > topScore) { candidateTop = y; topScore = score }
    }
    for (let y = bottom - 1; y < Math.min(image.height, bottom + 4); y++) {
        const score = horizontalScore(y)
        if (score > bottomScore) { candidateBottom = y + 1; bottomScore = score }
    }
    if (topScore >= 0.18 && bottomScore >= 0.18) {
        top = candidateTop
        bottom = candidateBottom
    }
    return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 识别图像中由 core 频域算法生成的马赛克矩形。
 * v8c 优先使用闭合彩色边框，旧格式使用中性中心化频谱纹理，再按像素收紧边界。
 * @param image 输入的 RGBA 图像数据
 */
export function getImageQcRects(image: ImageDataLike): ImageQcRect[] {
    const alphaRects = getV8cAlphaRects(image)
    const borderRects = [
        ...alphaRects,
        ...getV8cBorderRects(image).filter((border) => !alphaRects.some((alpha) =>
            border.x + border.width / 2 >= alpha.x &&
            border.x + border.width / 2 < alpha.x + alpha.width &&
            border.y + border.height / 2 >= alpha.y &&
            border.y + border.height / 2 < alpha.y + alpha.height
        )),
    ]
    const columns = Math.ceil(image.width / CELL_SIZE)
    const rows = Math.ceil(image.height / CELL_SIZE)
    const active = new Uint8Array(columns * rows)
    const scores = new Float32Array(columns * rows)
    const textures = new Float32Array(columns * rows)
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
            const ratio = getFrequencyRatio(
                image,
                x * CELL_SIZE,
                y * CELL_SIZE,
                CELL_SIZE,
                CELL_SIZE
            )
            const index = y * columns + x
            scores[index] = ratio
            textures[index] = getTextureEnergy(
                image,
                x * CELL_SIZE,
                y * CELL_SIZE,
                CELL_SIZE,
                CELL_SIZE
            )
            active[index] = ratio >= 0.65 && textures[index] >= 5.5
                    ? 1
                    : 0
        }
    }

    const grown = growFrequencyCells(active, scores, textures, columns, rows)
    const textureRects = collectComponents(grown, scores, columns, rows)
        .filter((component) => component.cells >= 12)
        .filter((component) => {
            const boxCells =
                (component.maxX - component.minX + 1) *
                (component.maxY - component.minY + 1)
            return component.cells / boxCells >= 0.42
        })
        .map((component) => {
            const rough = {
                x: component.minX * CELL_SIZE,
                y: component.minY * CELL_SIZE,
                width: Math.min(image.width, (component.maxX + 1) * CELL_SIZE) - component.minX * CELL_SIZE,
                height: Math.min(image.height, (component.maxY + 1) * CELL_SIZE) - component.minY * CELL_SIZE,
            }
            const rect = snapRectToV8cBorder(
                image,
                snapRectToEdges(image, refineRect(image, rough))
            )
            return {
                ...rect,
                confidence: Math.min(0.99, component.score / component.cells),
            }
        })
        .filter((rect) => rect.width >= MIN_RECT_SIZE && rect.height >= MIN_RECT_SIZE)
        .filter((rect) => rect.width * rect.height >= MIN_RECT_AREA)
        .filter((rect) => getFrequencyRatio(image, rect.x, rect.y, rect.width, rect.height) >= 0.5)
        .filter((rect) => getTextureEnergy(image, rect.x, rect.y, rect.width, rect.height) >= 6)
        .filter((rect) => !borderRects.some((border) =>
            rect.x + rect.width / 2 >= border.x &&
            rect.x + rect.width / 2 < border.x + border.width &&
            rect.y + rect.height / 2 >= border.y &&
            rect.y + rect.height / 2 < border.y + border.height
        ))
    return [...borderRects, ...textureRects]
}
