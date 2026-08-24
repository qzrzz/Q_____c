import {
    DEFAULT_SETTINGS,
    loadSettings,
    parseSiteList,
    saveSettings,
    type AlgorithmId,
    type DecodeMode,
    type SiteMode,
} from "./shared/settings"

const form = document.querySelector<HTMLFormElement>("#settings-form")!
const sites = document.querySelector<HTMLTextAreaElement>("#sites")!
const algorithm = document.querySelector<HTMLSelectElement>("#algorithm")!
const password = document.querySelector<HTMLInputElement>("#password")!
const status = document.querySelector<HTMLOutputElement>("#status")!
const sitesField = document.querySelector<HTMLElement>("#sites-field")!
const runCurrentPageButton = document.querySelector<HTMLButtonElement>("#run-current-page")!

/** 依照网站范围选项启用或禁用网站列表输入框。 */
function refreshSitesField() {
    const siteMode = (form.elements.namedItem("site-mode") as RadioNodeList).value
    const enabled = siteMode === "listed"
    sites.disabled = !enabled
    sitesField.classList.toggle("is-disabled", !enabled)
}

/** 读取已保存的设置并回填到设置面板。 */
async function hydrateForm() {
    const settings = await loadSettings()
    const siteMode = form.elements.namedItem("site-mode") as RadioNodeList
    const decodeMode = form.elements.namedItem("decode-mode") as RadioNodeList
    siteMode.value = settings.siteMode
    decodeMode.value = settings.decodeMode
    sites.value = settings.sites.join("\n")
    algorithm.value = settings.algorithm
    password.value = settings.password === DEFAULT_SETTINGS.password ? "" : settings.password
    refreshSitesField()
}

form.addEventListener("change", (event) => {
    if ((event.target as HTMLInputElement).name === "site-mode") refreshSitesField()
})

form.addEventListener("submit", async (event) => {
    event.preventDefault()
    const siteMode = (form.elements.namedItem("site-mode") as RadioNodeList).value as SiteMode
    const decodeMode = (form.elements.namedItem("decode-mode") as RadioNodeList).value as DecodeMode
    await saveSettings({
        siteMode,
        sites: parseSiteList(sites.value),
        decodeMode,
        algorithm: algorithm.value as AlgorithmId,
        password: password.value || DEFAULT_SETTINGS.password,
    })
    status.value = "已保存，打开的页面会即时更新。"
})

/** 打开内置打码工具标签页。 */
function openEditor() {
    chrome.tabs.create({ url: chrome.runtime.getURL("editor/index.html") })
}

document.querySelectorAll<HTMLButtonElement>(".open-editor, #open-editor").forEach((button) => {
    button.addEventListener("click", openEditor)
})

/** 在当前标签页手动启动一次图片扫描，并以按钮方式呈现识别结果。 */
async function runOnCurrentPage() {
    runCurrentPageButton.disabled = true
    runCurrentPageButton.textContent = "正在扫描…"
    status.value = "正在向当前页面发送扫描请求…"
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
        if (!tab.id) throw new Error("未找到当前标签页")
        const result = await chrome.tabs.sendMessage(tab.id, { type: "q_____c-run-current-page" }) as {
            ok?: boolean
            imageCount?: number
            eligibleImageCount?: number
            error?: string
        }
        if (!result?.ok) throw new Error(result?.error || "当前页面暂不支持运行")
        status.value = `已开始扫描 ${result.imageCount ?? 0} 张图片；其中 ${result.eligibleImageCount ?? 0} 张超过 300px。识别完成后会显示图标按钮。`
        runCurrentPageButton.textContent = "已启动扫描 ✓"
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        status.value = `无法在此页面运行：${message}`
        runCurrentPageButton.textContent = "无法运行"
    } finally {
        window.setTimeout(() => {
            runCurrentPageButton.disabled = false
            runCurrentPageButton.innerHTML = "重新扫描 <span aria-hidden=\"true\">→</span>"
        }, 1400)
    }
}

runCurrentPageButton.addEventListener("click", () => void runOnCurrentPage())

void hydrateForm()
