import { readAllTables } from "@/app/lib/seeds/seedCreator";

console.log = vi.fn();

describe("readAllTables", () => {
  describe("seedFile flag", () => {
    beforeAll(() => {
      vi.mock("@/app/lib/seeds/createSeedFile", () => {
        return {
          createSeedFile: vi
            .fn()
            .mockImplementation(() => console.log("mocked createSeedFile")),
        };
      });
    });

    afterEach(() => {
      console.log = vi.fn(); // reset console
    });

    test("calls createSeedFile() when flag is true", async () => {
      await readAllTables({ seedFile: true, logTables: false });

      expect(console.log).toHaveBeenNthCalledWith(1, "mocked createSeedFile");
      expect(console.log).toHaveBeenNthCalledWith(2, "Done ---");
    });

    test("do not call createSeedFile() when flag is false", async () => {
      await readAllTables({ seedFile: false, logTables: false });

      expect(console.log).toHaveBeenNthCalledWith(1, "Done ---");
    });
  });
});
