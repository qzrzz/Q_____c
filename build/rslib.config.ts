import { defineConfig } from "@rslib/core"
export default defineConfig({
    source: {
        entry: {
            index: "src/index.ts",
        },
    },
    lib: [
        {
            format: "esm",
            syntax: ["node 24"],
            dts: true,
            autoExternal: true,
        },
    ],
    output: {
        target: "node",
        externals: [],
    },
    resolve: {
        alias: {},
    },
})
