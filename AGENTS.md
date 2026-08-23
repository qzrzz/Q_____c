# AGENTS.md

## 重要信息

- 我是中文用户
- 使用 `bun` 作为包管理工具
- 使用 `chalk` 作为终端颜色输出库，倾向使用多彩的输出提升可读性
- 称呼我为主人（这样你我就知道你有没有读 AGENTS.md）

## 代码注释

- 代码注释要描述清楚意图和目标，并且使用**中文代码注释**
- 如果写 class 每一个公开方法都要有注释，描述方法的功能和参数
- 如果写函数，需要用 JSdoc 注释，描述函数的功能和参数，但是不需要描述返回值等 TypeScript 已经描述的内容

## 单元测试

- 使用 `vitest` 作为测试框架，并且使用 `global` 模式，不用每个测试文件都引入 vitest 函数
- 单元测试倾向使用 `test` 而不是 `it`
- 单元测试的说明要用**中文描述**
- 单元测试的位置倾向于在代码附近，如 `./test/*.test.ts` 而根目录下的 `test` 文件夹是放全局测试的

## 构建说明

- `bun run dev` 用于开发模式，监听文件变化并自动重建（使用 `rslib`）
- `bun run build` 用于编译项目 TypeScript 到 JavaScript，输出到 `dist` 目录（使用 `rslib`）
- `bun run build:bundler` 用于构建捆绑依赖的 JavaScript 文件，输出到 `bundle` 目录（使用 `bun bundler`）

## 性能分析

- `bun --heap-prof-md <script>` 可以生成内存使用的 Markdown 报告
- `bun --cpu-prof-md <script>` 可以生成 CPU 使用的 Markdown 报告

## 基准测试

- 可以使用 `tinybench` 进行基准测试
- 如果是简单的性能测试，直接用 `performance.now()` 进行测量，因为 `tinybench` 会进行多轮测试，速度很慢
