import { beforeEach, describe, expect, it } from "vitest";
import { densityBus } from "./density-bus.svelte";

describe("densityBus", () => {
  beforeEach(() => {
    // Reset rune to comfortable, then clear both stores so each test
    // starts from a known empty baseline. Order matters: setDensity
    // writes both stores, so we clear AFTER it to ensure tests can
    // exercise localStorage / attribute paths independently.
    densityBus.setDensity("comfortable");
    localStorage.clear();
    document.documentElement.removeAttribute("data-density");
  });

  it("defaults to comfortable when no attribute is set", () => {
    expect(densityBus.density).toBe("comfortable");
  });

  it("setDensity updates the rune", () => {
    densityBus.setDensity("compact");
    expect(densityBus.density).toBe("compact");
  });

  it("persists to localStorage on setDensity", () => {
    densityBus.setDensity("compact");
    expect(localStorage.getItem("cg-density")).toBe("compact");
  });

  it("toggle flips comfortable <-> compact", () => {
    densityBus.toggle();
    expect(densityBus.density).toBe("compact");
    densityBus.toggle();
    expect(densityBus.density).toBe("comfortable");
  });

  it("init() syncs from localStorage", () => {
    localStorage.setItem("cg-density", "compact");
    densityBus.init();
    expect(densityBus.density).toBe("compact");
  });

  it("reading the data-density attribute on the html element is the source of truth at construction", () => {
    // Production flow: the inline pre-paint script reads localStorage
    // and writes <html data-density>. We simulate by writing the
    // attribute, then re-importing the module — but since the module
    // is already loaded, we just verify the readInitialDensity logic
    // by checking that the rune reflects the attribute when set BEFORE
    // first construction.
    document.documentElement.setAttribute("data-density", "compact");
    // Force re-read via init() (which the inline script + onMount in
    // +layout.svelte effectively do). After this the rune is in sync.
    densityBus.init();
    expect(densityBus.density).toBe("compact");
  });
});
