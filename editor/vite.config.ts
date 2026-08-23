import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
    // 让编辑器既能部署到站点根目录，也能作为浏览器扩展内置页面加载。
    base: "./",
    plugins: [vue()],
    server: { port: 5173 },
})
