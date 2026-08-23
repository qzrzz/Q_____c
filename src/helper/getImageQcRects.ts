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
 * 识别只读取 RGB 像素，不依赖 alpha、元数据或隐藏标记。
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
    return centerDistance < 40 && saturation < 30
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

/**
 * 纯视觉识别图像中由 core 频域算法生成的马赛克矩形。
 * 算法先在小网格上寻找大面积的中性中心化频谱纹理，再按像素收紧边界。
 * @param image 输入的 RGBA 图像数据
 */
export function getImageQcRects(image: ImageDataLike): ImageQcRect[] {
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
            active[index] =
                ratio >= 0.65 &&
                textures[index] >= 5.5
                    ? 1
                    : 0
        }
    }

    const grown = growFrequencyCells(active, scores, textures, columns, rows)
    return collectComponents(grown, scores, columns, rows)
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
            const rect = snapRectToEdges(image, refineRect(image, rough))
            return {
                ...rect,
                confidence: Math.min(0.99, component.score / component.cells),
            }
        })
        .filter((rect) => rect.width >= MIN_RECT_SIZE && rect.height >= MIN_RECT_SIZE)
        .filter((rect) => rect.width * rect.height >= MIN_RECT_AREA)
        .filter((rect) => getFrequencyRatio(image, rect.x, rect.y, rect.width, rect.height) >= 0.5)
        .filter((rect) => getTextureEnergy(image, rect.x, rect.y, rect.width, rect.height) >= 6)
}
