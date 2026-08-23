import fs from "node:fs/promises"
await fs.rm("./dist", { recursive: true, force: true })
await Bun.build({
    entrypoints: ["./src/index.ts"],
    format: "esm",
    outdir: "./dist",
    external: [],
    target: "bun",
})
