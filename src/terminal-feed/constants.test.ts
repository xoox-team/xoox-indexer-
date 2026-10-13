import { describe, expect, it } from "vitest";
import { parseAbiItem, toEventSelector } from "viem";
import { TRADE_EVENT } from "./constants";

describe("terminal router source identity", () => {
  it("declares the router Trade event with its pinned inputs and selector", () => {
    const event = parseAbiItem(`event ${TRADE_EVENT}` as string);
    if (event.type !== "event") throw new Error("Trade is not an event.");
    expect(
      event.inputs.map((input) => [
        input.name,
        input.type,
        input.indexed === true,
      ]),
    ).toEqual([
      ["trader", "address", true],
      ["tokenIn", "address", true],
      ["tokenOut", "address", true],
      ["recipient", "address", false],
      ["amountIn", "uint256", false],
      ["amountOut", "uint256", false],
    ]);
    expect(toEventSelector(`event ${TRADE_EVENT}`)).toBe(
      "0x9ae6c84f444be403f63f3a126829553edc7ac75f1e4911cfff892b274a214907",
    );
  });
});
