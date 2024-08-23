import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

describe("Page", () => {
  test("render strong message", () => {
    render(<Page />);
    expect(screen.getByRole("strong").textContent).toBe("Welcome to Acme.");
  });
});
