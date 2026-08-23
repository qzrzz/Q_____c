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

document.querySelector<HTMLButtonElement>("#open-editor")!.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("editor/index.html") })
})

void hydrateForm()
