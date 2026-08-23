import { Bench } from "tinybench"

const bench = new Bench({ name: "simple benchmark", time: 100 })

bench.add("faster task", () => {})

await bench.run()

console.log(bench.name)
console.table(bench.table())
