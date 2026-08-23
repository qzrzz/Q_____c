declare const chrome: {
    runtime: {
        getURL(path: string): string
        id: string
        lastError?: { message?: string }
        sendMessage(message: unknown, callback: (response: unknown) => void): void
        onMessage: {
            addListener(
                callback: (
                    message: unknown,
                    sender: unknown,
                    sendResponse: (response: unknown) => void
                ) => boolean | void
            ): void
        }
    }
    storage: {
        sync: {
            get(keys: string[] | null, callback: (items: Record<string, unknown>) => void): void
            set(items: Record<string, unknown>, callback?: () => void): void
        }
        onChanged: {
            addListener(callback: (changes: Record<string, unknown>, areaName: string) => void): void
        }
    }
    tabs: {
        create(options: { url: string }): void
    }
    declarativeNetRequest: {
        updateSessionRules(options: {
            removeRuleIds: number[]
            addRules: Array<{
                id: number
                priority: number
                action: {
                    type: "modifyHeaders"
                    requestHeaders: Array<{
                        header: string
                        operation: "set"
                        value: string
                    }>
                }
                condition: {
                    requestDomains: string[]
                    initiatorDomains: string[]
                    resourceTypes: string[]
                }
            }>
        }): Promise<void>
    }
}
