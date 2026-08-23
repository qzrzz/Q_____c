import fs from "node:fs/promises"
import path from "node:path"

const outputDirectory = "./extension/dist"

/** 运行子进程，并在失败时带上可读的构建错误。 @param command 要执行的命令与参数 @param cwd 命令工作目录 */
async function run(command: string[], cwd = ".") {
    const process = Bun.spawn(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    if ((await process.exited) !== 0) throw new Error(`${command.join(" ")} 构建失败`)
}

await fs.rm(outputDirectory, { recursive: true, force: true })
await fs.mkdir(outputDirectory, { recursive: true })

const result = await Bun.build({
    entrypoints: [
        "./extension/src/background.ts",
        "./extension/src/content.ts",
        "./extension/src/popup.ts",
    ],
    outdir: outputDirectory,
    target: "browser",
    format: "esm",
    naming: "[name].[ext]",
    minify: false,
})
if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error("扩展脚本构建失败")
}

await Promise.all([
    fs.copyFile("./extension/manifest.json", path.join(outputDirectory, "manifest.json")),
    fs.copyFile("./extension/popup.html", path.join(outputDirectory, "popup.html")),
    fs.copyFile("./extension/popup.css", path.join(outputDirectory, "popup.css")),
    fs.copyFile("./web/icons/icon-pix.png", path.join(outputDirectory, "icon-pix.png")),
])

await run(["bun", "run", "build", "--", "--outDir", "../extension/dist/editor"], "./editor")
console.log("\x1b[36m✓ Q_____c 浏览器扩展已构建到 extension/dist\x1b[0m")
