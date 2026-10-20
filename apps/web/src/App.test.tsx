// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.js";

describe("Evently app shell", () => {
  it("renders the foundation landing screen", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Evently" })).toBeTruthy();
  });
});
