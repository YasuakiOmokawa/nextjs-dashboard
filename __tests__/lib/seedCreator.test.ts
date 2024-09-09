import { createSeed } from "@/app/lib/seedCreator/main";

console.log = vi.fn(); // mock console

describe("createSeed", () => {
  describe("allSeeds flag", () => {
    beforeAll(() => {
      vi.mock("@/app/lib/seedCreator/findAndRefind", () => {
        return {
          findAndRefind: vi.fn().mockReturnValue("mocked findAndRefind"),
        };
      });
      vi.mock("@/app/lib/seedCreator/createAllSeeds", () => {
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
      await createSeed({ allSeeds: true, logTables: true });

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
      await createSeed({ allSeeds: false, logTables: true });

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
      vi.mock("@/app/lib/seedCreator/createSeedFile", () => {
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
      await createSeed({ seedFile: true, logTables: false });

      expect(console.log).toHaveBeenNthCalledWith(1, "mocked createSeedFile");
      expect(console.log).toHaveBeenNthCalledWith(2, "Done ---");
    });

    test("do not call createSeedFile() when flag is false", async () => {
      await createSeed({ seedFile: false, logTables: false });

      expect(console.log).toHaveBeenNthCalledWith(1, "Done ---");
    });
  });
});
