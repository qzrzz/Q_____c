// 检查当前 Git 用户名和邮箱是否已配置，已配置则输出，否则提示用户进行配置
import { execSync } from "child_process"

// 获取 Git 配置的用户名和邮箱
function getGitUserConfig(): { name: string | null; email: string | null } {
    let name: string | null = null
    let email: string | null = null
    try {
        name = execSync("git config --get user.name").toString().trim()
    } catch (error) {
        name = null
    }
    try {
        email = execSync("git config --get user.email").toString().trim()
    } catch (error) {
        email = null
    }
    return { name, email }
}

function checkGitUser() {
    const { name, email } = getGitUserConfig()
    if (!name || !email) {
        console.error(
            "Git 用户名或邮箱未配置。请使用以下命令进行配置：\n" +
                'git config --global user.name "Your Name"\n' +
                'git config --global user.email "your.email@example.com"\n',
        )
        process.exit(1)
    } else {
        console.log(`当前 Git 用户名：${name}`)
        console.log(`当前 Git 用户邮箱：${email}`)
    }
}

checkGitUser()
