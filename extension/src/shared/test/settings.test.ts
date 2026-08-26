import { DEFAULT_SETTINGS, isSiteEnabled, normalizeSiteHost, parseSiteList } from "../settings"

test("规范化域名、网址与通配前缀", () => {
    expect(normalizeSiteHost("https://Images.Example.com/path")).toBe("images.example.com")
    expect(normalizeSiteHost("*.example.com")).toBe("example.com")
    expect(normalizeSiteHost("不是网址")).toBe("xn--ihq17txpmlpy")
})

test("解析网站列表时忽略空项并去重", () => {
    expect(parseSiteList("example.com\nhttps://example.com/path, cdn.example.com")).toEqual([
        "example.com",
        "cdn.example.com",
    ])
})

test("指定列表会匹配域名和子域名", () => {
    const settings = { ...DEFAULT_SETTINGS, sites: ["example.com"] }
    expect(isSiteEnabled(settings, "example.com")).toBe(true)
    expect(isSiteEnabled(settings, "cdn.example.com")).toBe(true)
    expect(isSiteEnabled(settings, "example.com.evil.test")).toBe(false)
})

test.each(["auto", "v8c", "v8", "v7", "v6", undefined, "invalid"])("loadSettings 正确读取算法 %s 并为缺省值启用自动识别", async (algorithm) => {
    const globalAny = globalThis as unknown as { chrome?: unknown }
    const originalChrome = globalAny.chrome
    globalAny.chrome = {
        storage: {
            sync: {
                get: (_keys: unknown, callback: (result: Record<string, unknown>) => void) => {
                    callback({ algorithm, password: "custom-password" })
                },
            },
        },
    }
    try {
        const { loadSettings } = await import("../settings")
        const settings = await loadSettings()
        expect(settings.algorithm).toBe(algorithm === undefined || algorithm === "invalid" ? "auto" : algorithm)
        expect(settings.password).toBe("custom-password")
    } finally {
        globalAny.chrome = originalChrome
    }
})
