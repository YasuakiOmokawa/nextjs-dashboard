import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

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

describe("Page", () => {
  test("render strong message", () => {
    render(<Page />);
    expect(screen.getByRole("strong").textContent).toBe("Welcome to Acme.");
  });
});
