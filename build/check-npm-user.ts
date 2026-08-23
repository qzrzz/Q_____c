// 检查当前 NPM 用户名，让用户确认后再继续
import { execSync } from "child_process"
import readline from "readline"

// 获取当前 NPM 用户名
function getNpmUsername(): string | null {
    try {
        const username = execSync("npm whoami  --registry https://registry.npmjs.org/").toString().trim()
        return username
    } catch (error) {
        return null
    }
}

// 提示用户确认
async function promptUser(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close()
            resolve(answer)
        })
    })
}

async function checkNpmUser() {
    const username = getNpmUsername()
    if (!username) {
        console.error("无法获取当前 NPM 用户名，请确保已登录 NPM。")
        process.exit(1)
    }

    const answer = await promptUser(
        `当前 NPM 用户名为 "${username}"。是否继续？(y/n): `
    )

    if (answer.toLowerCase() !== "y") {
        console.log("操作已取消。")
        process.exit(1)
    }
}

checkNpmUser()