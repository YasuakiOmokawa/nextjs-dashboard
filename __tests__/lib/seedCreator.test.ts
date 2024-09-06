import { readAllTables } from "@/app/lib/seeds/seedCreator";

vi.mock("@/app/lib/seeds/createSeedFile", () => {
  return {
    createSeedFile: vi
      .fn()
      .mockImplementation(() => console.log("mocked createSeedFile")),
  };
});
console.log = vi.fn();

describe("readAllTables", () => {
  test("calls createSeedFile() when seedFile: true", async () => {
    await readAllTables({ seedFile: true, logTables: false });

    expect(console.log).toHaveBeenNthCalledWith(1, "mocked createSeedFile");
    expect(console.log).toHaveBeenNthCalledWith(2, "Done ---");
  });
});
