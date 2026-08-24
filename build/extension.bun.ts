import fs from "node:fs/promises"
import { watch } from "node:fs"
import path from "node:path"
import chalk from "chalk"

const outputDirectory = "./extension/dist"
const watchMode = Bun.argv.includes("--watch")
const staticFiles = ["manifest.json", "popup.html", "popup.css", "font.css"]

/** 运行子进程，并在失败时带上可读的构建错误。 @param command 要执行的命令与参数 @param cwd 命令工作目录 */
async function run(command: string[], cwd = ".") {
    const process = Bun.spawn(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    if ((await process.exited) !== 0) throw new Error(`${command.join(" ")} 构建失败`)
}

/** 复制扩展清单、弹窗资源与嵌入式字体样式、图标到可加载目录。 */
async function copyStaticFiles() {
    await Promise.all([
        ...staticFiles.map((file) =>
            fs.copyFile(path.join("./extension", file), path.join(outputDirectory, file))
        ),
        fs.copyFile("./web/icons/icon-pix.png", path.join(outputDirectory, "icon-pix.png")),
    ])
}

/** 构建内置 editor；监听模式下持续更新扩展目录中的 editor 页面。 */
async function buildEditor() {
    const command = ["bun", "run", "build", "--", "--outDir", "../extension/dist/editor"]
    if (!watchMode) return run(command, "./editor")

    command.push("--watch")
    const process = Bun.spawn(command, { cwd: "./editor", stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    void process.exited.then((exitCode) => {
        if (exitCode !== 0) console.error(chalk.red(`editor 监听构建已退出（${exitCode}）`))
    })
}

if (!watchMode) await fs.rm(outputDirectory, { recursive: true, force: true })
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
    watch: watchMode
        ? {
              onRebuild(error) {
                  if (error) console.error(chalk.red("扩展脚本重新构建失败"), error)
                  else console.log(chalk.green("✓ 扩展脚本已重新构建"))
              },
          }
        : undefined,
})
if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error("扩展脚本构建失败")
}

await copyStaticFiles()

await buildEditor()

if (watchMode) {
    // 静态文件不在 Bun bundler 的模块依赖图中，单独监听并同步到扩展目录。
    watch("./extension", { recursive: true }, (_event, filename) => {
        if (!filename || filename.includes("dist")) return
        void copyStaticFiles().then(() => console.log(chalk.green("✓ 扩展静态资源已同步")))
    })
    console.log(chalk.cyan("◉ Q_____c 扩展开发监听已启动，修改后请在浏览器扩展页重新加载。"))
    await new Promise<never>(() => undefined)
}

console.log(chalk.cyan("✓ Q_____c 浏览器扩展已构建到 extension/dist"))
