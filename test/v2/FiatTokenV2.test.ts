import { behavesLikeRescuable } from "../v1/Rescuable.behavior";
import { FiatTokenV2Instance, RescuableInstance } from "../../@types/generated";
import { usesOriginalStorageSlotPositions } from "../helpers/storageSlots.behavior";
import { hasSafeAllowance } from "./safeAllowance.behavior";
import { hasGasAbstraction } from "./GasAbstraction/GasAbstraction.behavior";
import { makeDomainSeparator } from "./GasAbstraction/helpers";
import { expectRevert } from "../helpers";

const FiatTokenV2 = artifacts.require("FiatTokenV2");

contract("FiatTokenV2", (accounts) => {
  const fiatTokenOwner = accounts[9];
  let fiatToken: FiatTokenV2Instance;

  beforeEach(async () => {
    fiatToken = await FiatTokenV2.new();
    await fiatToken.initialize(
      "Inclusion USD",
      "USDI",
      "USD",
      6,
      fiatTokenOwner,
      fiatTokenOwner,
      fiatTokenOwner,
      fiatTokenOwner
    );
  });

  behavesLikeFiatTokenV2(accounts, () => fiatToken, fiatTokenOwner);
});

export function behavesLikeFiatTokenV2(
  accounts: Truffle.Accounts,
  getFiatToken: () => FiatTokenV2Instance,
  fiatTokenOwner: string
): void {
  const [, user, lostAndFound] = accounts;
  const newName = "Inclusion USD";

  describe("domain separator", () => {
    let domainSeparator: string;
    let fiatToken: FiatTokenV2Instance;

    beforeEach(async () => {
      fiatToken = getFiatToken();
      await fiatToken.initializeV2(newName, lostAndFound, {
        from: fiatTokenOwner,
      });
      domainSeparator = makeDomainSeparator(
        "Inclusion USD",
        "2",
        1, // hardcoded to 1 because of ganache bug: https://github.com/trufflesuite/ganache/issues/1643
        fiatToken.address
      );
    });

    it("has the expected domain separator", async () => {
      expect(await fiatToken.DOMAIN_SEPARATOR()).to.equal(domainSeparator);
    });

    behavesLikeRescuable(getFiatToken as () => RescuableInstance, accounts);

    usesOriginalStorageSlotPositions({
      Contract: FiatTokenV2,
      accounts,
    });

    hasSafeAllowance(getFiatToken, fiatTokenOwner, accounts);

    hasGasAbstraction(
      getFiatToken,
      () => domainSeparator,
      fiatTokenOwner,
      accounts
    );
  });

  describe("initializeV2", () => {
    let fiatToken: FiatTokenV2Instance;

    beforeEach(async () => {
      fiatToken = getFiatToken();
      await fiatToken.configureMinter(fiatTokenOwner, 1000000e6, {
        from: fiatTokenOwner,
      });
      await fiatToken.mint(user, 100e6, { from: fiatTokenOwner });
    });

    it("transfers locked funds to a given address", async () => {
      // send tokens to the contract address
      await fiatToken.transfer(fiatToken.address, 100e6, { from: user });

      expect(
        (await fiatToken.balanceOf(fiatToken.address)).toNumber()
      ).to.equal(100e6);

      // initialize v2.1
      await fiatToken.initializeV2(newName, lostAndFound, {
        from: fiatTokenOwner,
      });

      expect(
        (await fiatToken.balanceOf(fiatToken.address)).toNumber()
      ).to.equal(0);

      expect((await fiatToken.balanceOf(lostAndFound)).toNumber()).to.equal(
        100e6
      );
    });

    it("blocks transfers to the contract address", async () => {
      await fiatToken.initializeV2(newName, lostAndFound, {
        from: fiatTokenOwner,
      });

      expect(await fiatToken.isBlacklisted(fiatToken.address)).to.equal(true);

      await expectRevert(
        fiatToken.transfer(fiatToken.address, 100e6, { from: user }),
        "account is blacklisted"
      );
    });

    it("disallows calling initializeV2 twice", async () => {
      await fiatToken.initializeV2(newName, lostAndFound, {
        from: fiatTokenOwner,
      });

      await expectRevert(
        fiatToken.initializeV2(newName, lostAndFound, { from: fiatTokenOwner })
      );
    });

    it("returns the version string", async () => {
      expect(await fiatToken.version()).to.equal("2");
    });
  });
}
