import { usesOriginalStorageSlotPositions } from "../helpers/storageSlots.behavior";
import { behavesLikeRescuable } from "./Rescuable.behavior";
import { FiatTokenV1Instance, RescuableInstance } from "../../@types/generated";

const FiatTokenV1 = artifacts.require("FiatTokenV1");

contract("FiatTokenV1", (accounts) => {
  usesOriginalStorageSlotPositions({
    Contract: FiatTokenV1,
    accounts,
  });

  describe("initialize", () => {
    let fiatToken: FiatTokenV1Instance;

    beforeEach(async () => {
      fiatToken = await FiatTokenV1.new();
      const owner = accounts[0];
      await fiatToken.initialize(
        "Inclusion USD",
        "USDI",
        "USD",
        6,
        owner,
        owner,
        owner,
        owner
      );
    });
    behavesLikeRescuable(() => fiatToken as RescuableInstance, accounts);
  });
});
