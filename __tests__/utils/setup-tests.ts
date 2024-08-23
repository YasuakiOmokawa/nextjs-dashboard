beforeAll(() => {
  vi.mock("next/font/google", () => ({
    Inter: () => ({
      style: {
        fontFamily: "mocked",
      },
    }),
    Lusitana: () => ({
      style: {
        fontFamily: "mocked",
      },
    }),
    Bungee_Spice: () => ({
      style: {
        fontFamily: "mocked",
      },
    }),
  }));
});
