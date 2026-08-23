import { hi } from "../src/index"

test("hi function works", () => {
    expect(hi("Tester")).toBe("Hello, Tester!")
})
