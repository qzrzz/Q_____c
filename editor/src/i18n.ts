export type Locale = "zh-CN" | "en"

const STORAGE_KEY = "q-mosaic-locale"

const zh = {
    pageTitle: "Q_____c 骑马赛克",
    brandSubtitle: "骑马赛克 / 可逆马赛克工具",
    languageSwitch: "切换到英文",
    workMode: "工作模式",
    encode: "打码",
    decode: "解码",
    algorithmVersion: "算法版本",
    algorithm: "算法",
    newTask: "新建任务",
    selectionCoordinates: "选区坐标",
    selectionX: "选区 X 坐标",
    selectionY: "选区 Y 坐标",
    width: "宽",
    height: "高",
    selectionWidth: "选区宽度",
    selectionHeight: "选区高度",
    preScale: "提前缩放",
    preScaleSize: "提前缩放尺寸",
    noPreScale: "不提前缩放尺寸",
    customSize: "手动设置",
    customWidth: "手动设置宽度尺寸",
    widthLabel: "宽度",
    undo: "撤销",
    redo: "重做",
    deleteSelection: "删除选区",
    changeImage: "更换图片",
    selectImage: "选择图片",
    dropImage: "拖入图片",
    fileSupport: "支持 PNG、JPEG、WebP，图片仅在本地处理",
    maskingEditor: "打码编辑",
    frequencyImage: "频域图像",
    updatingMask: "正在更新打码结果",
    maskingHint: "框选区域实时显示打码结果",
    calibrationHint: "选择并校准识别区域",
    updating: "正在更新",
    manualAdjustment: "手动调整",
    region: "区域 {id}",
    decodePreview: "解码预览",
    restoredResult: "恢复结果",
    restoredHint: "恢复后可见的原始内容",
    restoredRegions: "已恢复 {count} 个区域",
    waitingForRegions: "等待识别或手动框选区域",
    previewProcessing: "解码预览处理方式",
    noProcessing: "不处理",
    scalePreview: "缩放 0.8",
    jpegTranscode: "JPEG 再编码",
    jpeg720: "JPEG 再编码 720",
    simulating: "正在模拟",
    preciseAdjustment: "精确调整",
    moveResizeHint: "拖动框可移动，拖动四角可缩放",
    dragEmpty: "拖拽空白处",
    createSelection: "创建选区",
    dragSelection: "拖动选区",
    move: "移动",
    delete: "删除",
    addRegionHint: "拖拽空白处补画区域",
    removeFalsePositive: "移除误识别",
    rescan: "重新识别",
    localOnly: "所有处理均在本地完成",
    setPassword: "设置密码（可选）",
    restorePassword: "恢复密码（可选）",
    passwordPlaceholder: "留空使用默认密码 qzrzz",
    processing: "正在处理…",
    generateMosaic: "生成可逆马赛克",
    generateRestored: "生成恢复图片",
    close: "关闭",
    complete: "处理完成",
    mosaicGenerated: "可逆马赛克已生成",
    imageRestored: "图片已恢复",
    browserOnly: "结果仍只保存在当前浏览器中，请下载到设备。",
    resultPreview: "处理结果预览",
    downloadPng: "下载 PNG",
    statusWaiting: "等待导入图片",
    statusDetected: "自动识别 {count} 个区域，请核对或手动补画",
    statusAdded: "已添加 {count} 个区域",
    statusDraw: "拖拽画出需要保护的区域",
    setWidth: "设置宽度",
    keepOriginalSize: "不改变原图尺寸",
    originalNoScale: "原图 {width} × {height} px，无需放大",
    outputSize: "输出 {width} × {height} px",
    invalidWidth: "请输入大于 0 的宽度尺寸",
    invalidFile: "请选择 PNG、JPEG、WebP 等图片文件",
    maskingPreviewFailed: "打码预览生成失败",
    jpegPreviewFailed: "JPEG 预览编码失败",
    decodePreviewFailed: "解码预览生成失败",
    generateFailed: "生成失败，请重试",
    restoreFailed: "恢复失败，请重试",
    exportFailed: "无法导出 PNG",
} as const

const en: Record<keyof typeof zh, string> = {
    pageTitle: "Q_____c Reversible Mosaic",
    brandSubtitle: "REVERSIBLE MOSAIC TOOL",
    languageSwitch: "切换到中文",
    workMode: "Work mode",
    encode: "Encode",
    decode: "Decode",
    algorithmVersion: "Algorithm version",
    algorithm: "Algorithm",
    newTask: "New task",
    selectionCoordinates: "Selection coordinates",
    selectionX: "Selection X coordinate",
    selectionY: "Selection Y coordinate",
    width: "W",
    height: "H",
    selectionWidth: "Selection width",
    selectionHeight: "Selection height",
    preScale: "Pre-scale",
    preScaleSize: "Pre-scale size",
    noPreScale: "Keep original size",
    customSize: "Custom size",
    customWidth: "Custom output width",
    widthLabel: "Width",
    undo: "Undo",
    redo: "Redo",
    deleteSelection: "Delete selection",
    changeImage: "Change image",
    selectImage: "Select image",
    dropImage: "Drop an image",
    fileSupport: "PNG, JPEG and WebP supported. Processing stays on this device.",
    maskingEditor: "Mosaic editor",
    frequencyImage: "Frequency image",
    updatingMask: "Updating mosaic",
    maskingHint: "Draw regions to preview the mosaic in real time",
    calibrationHint: "Select and calibrate detected regions",
    updating: "Updating",
    manualAdjustment: "Manual",
    region: "Region {id}",
    decodePreview: "Decode preview",
    restoredResult: "Restored result",
    restoredHint: "Original content visible after restoration",
    restoredRegions: "Restored {count} regions",
    waitingForRegions: "Waiting for detection or a manual selection",
    previewProcessing: "Decode preview processing",
    noProcessing: "Original",
    scalePreview: "Scale 0.8",
    jpegTranscode: "JPEG transcode",
    jpeg720: "JPEG transcode 720",
    simulating: "Simulating",
    preciseAdjustment: "Precise adjustment",
    moveResizeHint: "Drag the box to move it; drag a corner to resize",
    dragEmpty: "Drag empty area",
    createSelection: "Create selection",
    dragSelection: "Drag selection",
    move: "Move",
    delete: "Delete",
    addRegionHint: "Drag an empty area to add a region",
    removeFalsePositive: "Remove false positive",
    rescan: "Scan again",
    localOnly: "All processing happens locally",
    setPassword: "Set password (optional)",
    restorePassword: "Restore password (optional)",
    passwordPlaceholder: "Leave blank to use default password qzrzz",
    processing: "Processing…",
    generateMosaic: "Generate reversible mosaic",
    generateRestored: "Generate restored image",
    close: "Close",
    complete: "Complete",
    mosaicGenerated: "Reversible mosaic generated",
    imageRestored: "Image restored",
    browserOnly: "The result exists only in this browser. Download it to keep it.",
    resultPreview: "Result preview",
    downloadPng: "Download PNG",
    statusWaiting: "Waiting for an image",
    statusDetected: "Detected {count} regions. Review or add regions manually.",
    statusAdded: "Added {count} regions",
    statusDraw: "Drag to mark regions you want to protect",
    setWidth: "Set width",
    keepOriginalSize: "Keep original image size",
    originalNoScale: "Original {width} × {height} px; no resize needed",
    outputSize: "Output {width} × {height} px",
    invalidWidth: "Enter a width greater than 0",
    invalidFile: "Select a PNG, JPEG, WebP, or another image file",
    maskingPreviewFailed: "Could not generate the mosaic preview",
    jpegPreviewFailed: "Could not encode the JPEG preview",
    decodePreviewFailed: "Could not generate the decode preview",
    generateFailed: "Generation failed. Try again.",
    restoreFailed: "Restoration failed. Try again.",
    exportFailed: "Could not export the PNG",
}

export type MessageKey = keyof typeof zh

const messages: Record<Locale, Record<MessageKey, string>> = { "zh-CN": zh, en }

/** 获取用户首次打开编辑器时应使用的界面语言。 */
export function getInitialLocale(): Locale {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === "zh-CN" || stored === "en") return stored
    return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en"
}

/**
 * 翻译界面文本并替换动态参数。
 * @param locale 当前界面语言
 * @param key 文本键
 * @param parameters 待写入文本模板的动态参数
 */
export function translate(
    locale: Locale,
    key: MessageKey,
    parameters: Record<string, string | number> = {}
): string {
    return Object.entries(parameters).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        messages[locale][key]
    )
}

/**
 * 保存并应用界面语言。
 * @param locale 需要应用的语言
 */
export function applyLocale(locale: Locale) {
    window.localStorage.setItem(STORAGE_KEY, locale)
    document.documentElement.lang = locale
    document.title = translate(locale, "pageTitle")
}
