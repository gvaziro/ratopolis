import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PHONE_MQ, SHORT_MQ, isPhoneLayout, isShortLayout, usePhoneLayout, useShortLayout } from "./layoutMode";

function Probe() {
  return createElement("i", null, `${usePhoneLayout()}|${useShortLayout()}`);
}

describe("layoutMode (v3 ENG-12)", () => {
  it("is false on the server, in the hooks and outside React", () => {
    expect(renderToString(createElement(Probe))).toBe("<i>false|false</i>");
    expect(isPhoneLayout()).toBe(false);
    expect(isShortLayout()).toBe(false);
  });

  it("phone = narrow or short; short = landscape phone", () => {
    expect(PHONE_MQ).toBe("(max-width: 767px), (max-height: 520px)");
    expect(SHORT_MQ).toBe("(max-height: 520px)");
  });
});
