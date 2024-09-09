import { readAllTables } from "@/app/lib/seeds/seedCreator";

console.log = vi.fn(); // mock console

describe("readAllTables", () => {
  describe("allSeeds flag", () => {
    beforeAll(() => {
      vi.mock("@/app/lib/seeds/findAndRefind", () => {
        return {
          findAndRefind: vi.fn().mockReturnValue("mocked findAndRefind"),
        };
      });
      vi.mock("@/app/lib/seeds/createAllSeeds", () => {
        return {
          createAllSeeds: vi
            .fn()
            .mockImplementation(() => console.log("mocked createAllSeeds")),
        };
      });
    });

    afterEach(() => {
      console.log = vi.fn(); // reset console
    });

    test("calls findAndRefind() and createAllSeeds() when flag is true", async () => {
      await readAllTables({ allSeeds: true, logTables: true });

      expect(console.log).toHaveBeenNthCalledWith(
        1,
        "Start -->",
        "mocked findAndRefind",
        "<-- End"
      );
      expect(console.log).toHaveBeenNthCalledWith(2, "mocked createAllSeeds");
      expect(console.log).toHaveBeenNthCalledWith(3, "Done ---");
    });

    test("do not call findAndRefind() and createAllSeeds() when flag is false", async () => {
      await readAllTables({ allSeeds: false, logTables: true });

      expect(console.log).toHaveBeenNthCalledWith(
        1,
        "Start -->",
        {},
        "<-- End"
      );
      expect(console.log).toHaveBeenNthCalledWith(2, "Done ---");
    });
  });

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
