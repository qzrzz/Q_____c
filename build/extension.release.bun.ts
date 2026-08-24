import fs from "node:fs/promises"
import path from "node:path"
import chalk from "chalk"

const dryRun = Bun.argv.includes("--dry-run")
const manifestPath = "./extension/manifest.json"

/** 运行发布相关命令；失败时提供可定位的错误信息。 @param command 要执行的命令与参数 */
async function run(command: string[]) {
    const process = Bun.spawn(command, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    })
    if ((await process.exited) !== 0) throw new Error(`${command.join(" ")} 执行失败`)
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { name: string; version: string }
const tag = `v${manifest.version}`
const archivePath = path.resolve(`./extension/Q_____c-可逆马赛克-chrome-extension-${tag}.zip`)
const releaseDescription = "Q_____c 可逆马赛克浏览器插件。下载并解压后，可在 Chrome 或 Chromium 的扩展管理页通过“加载已解压的扩展程序”安装。"

console.log(chalk.cyan(`◉ 正在构建 ${manifest.name} ${tag}`))
if (!dryRun) await run(["bun", "run", "extension:build"])

if (dryRun) {
    console.log(chalk.yellow(`将创建 ${tag} 并上传 ${archivePath}`))
    process.exit(0)
}

await fs.rm(archivePath, { force: true })
await run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", "./extension/dist", archivePath])

const releaseExists = Bun.spawn(["gh", "release", "view", tag], { stdout: "ignore", stderr: "ignore" })
if ((await releaseExists.exited) === 0) {
    console.log(chalk.yellow(`◉ ${tag} 已存在，正在更新附件`))
    await run(["gh", "release", "upload", tag, archivePath, "--clobber"])
} else {
    console.log(chalk.green(`◉ 正在创建 GitHub Release ${tag}`))
    await run([
        "gh",
        "release",
        "create",
        tag,
        archivePath,
        "--title",
        `${manifest.name} 浏览器插件 ${tag}`,
        "--notes",
        releaseDescription,
        "--generate-notes",
    ])
}

console.log(chalk.green(`✓ GitHub Release ${tag} 发布完成`))
