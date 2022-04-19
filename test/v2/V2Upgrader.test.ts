import crypto from "crypto";
import {
  FiatTokenV1Instance,
  FiatTokenV2Instance,
  FiatTokenProxyInstance,
} from "../../@types/generated";
import { signTransferAuthorization } from "./GasAbstraction/helpers";
import { MAX_UINT256, ACCOUNTS_AND_KEYS } from "../helpers/constants";
import { hexStringFromBuffer, expectRevert } from "../helpers";

const FiatTokenProxy = artifacts.require("FiatTokenProxy");
const FiatTokenV1 = artifacts.require("FiatTokenV1");
const FiatTokenV2 = artifacts.require("FiatTokenV2");
const V2Upgrader = artifacts.require("V2Upgrader");

contract("V2Upgrader", (accounts) => {
  let fiatTokenProxy: FiatTokenProxyInstance;
  let proxyAsV1: FiatTokenV1Instance;
  let proxyAsV2: FiatTokenV2Instance;
  let v1Implementation: FiatTokenV1Instance;
  let v2Implementation: FiatTokenV2Instance;
  let originalProxyAdmin: string;
  const [minter, lostAndFound, alice, bob] = accounts.slice(9);

  beforeEach(async () => {
    fiatTokenProxy = await FiatTokenProxy.deployed();
    proxyAsV1 = await FiatTokenV1.at(fiatTokenProxy.address);
    proxyAsV2 = await FiatTokenV2.at(fiatTokenProxy.address);
    v1Implementation = await FiatTokenV1.deployed();
    v2Implementation = await FiatTokenV2.deployed();
    originalProxyAdmin = await fiatTokenProxy.admin();

    await proxyAsV1.configureMinter(minter, 1000e6, {
      from: await proxyAsV1.masterMinter(),
    });
    await proxyAsV1.mint(minter, 100e6 + 2e5, { from: minter });
  });

  describe("upgrade", () => {
    it("upgrades, transfers proxy admin role to newProxyAdmin, runs tests, and self-destructs", async () => {
      // Run the test on the contracts deployed by Truffle to ensure the Truffle
      // migration is written correctly
      const upgrader = await V2Upgrader.deployed();
      const upgraderOwner = await upgrader.owner();

      expect(await upgrader.proxy()).to.equal(fiatTokenProxy.address);
      expect(await upgrader.implementation()).to.equal(
        v2Implementation.address
      );
      expect(await upgrader.helper()).not.to.be.empty;
      expect(await upgrader.newProxyAdmin()).to.equal(originalProxyAdmin);
      expect(await upgrader.newName()).to.equal("Inclusion USD");
      expect(await upgrader.lostAndFound()).to.equal(lostAndFound);

      // Transfer 0.2 USD to the contract
      await proxyAsV1.transfer(upgrader.address, 2e5, { from: minter });

      // Transfer 100 USD to the FiatTokenProxy contract
      await proxyAsV1.transfer(proxyAsV2.address, 100e6, { from: minter });

      // Transfer admin role to the contract
      await fiatTokenProxy.changeAdmin(upgrader.address, {
        from: originalProxyAdmin,
      });

      // Call upgrade
      await upgrader.upgrade({ from: upgraderOwner });

      // The proxy admin role is transferred back to originalProxyAdmin
      expect(await fiatTokenProxy.admin()).to.equal(originalProxyAdmin);

      // The implementation is updated to V2
      expect(await fiatTokenProxy.implementation()).to.equal(
        v2Implementation.address
      );

      // Test that things work as expected
      expect(await proxyAsV2.name()).to.equal("Inclusion USD");
      expect((await proxyAsV2.balanceOf(upgrader.address)).toNumber()).to.equal(
        0
      );
      expect((await proxyAsV2.balanceOf(upgraderOwner)).toNumber()).to.equal(
        2e5
      );

      const [user, user2] = ACCOUNTS_AND_KEYS;
      await proxyAsV2.transfer(user.address, 2e5, { from: upgraderOwner });
      expect((await proxyAsV2.balanceOf(user.address)).toNumber()).to.equal(
        2e5
      );

      // Test Gas Abstraction
      const nonce = hexStringFromBuffer(crypto.randomBytes(32));

      const invalidAuthorization = signTransferAuthorization(
        user.address,
        minter,
        1e5,
        0,
        MAX_UINT256,
        nonce,
        await proxyAsV2.DOMAIN_SEPARATOR(),
        user2.key // Signed with someone else's key
      );
      // Fails when given an invalid authorization
      await expectRevert(
        proxyAsV2.transferWithAuthorization(
          user.address,
          minter,
          1e5,
          0,
          MAX_UINT256,
          nonce,
          invalidAuthorization.v,
          invalidAuthorization.r,
          invalidAuthorization.s,
          { from: minter }
        ),
        "invalid signature"
      );

      const validAuthorization = signTransferAuthorization(
        user.address,
        minter,
        1e5,
        0,
        MAX_UINT256,
        nonce,
        await proxyAsV2.DOMAIN_SEPARATOR(),
        user.key
      );

      // Succeeds when given a valid authorization
      await proxyAsV2.transferWithAuthorization(
        user.address,
        minter,
        1e5,
        0,
        MAX_UINT256,
        nonce,
        validAuthorization.v,
        validAuthorization.r,
        validAuthorization.s,
        { from: minter }
      );

      expect((await proxyAsV2.balanceOf(user.address)).toNumber()).to.equal(
        1e5
      );
      expect((await proxyAsV2.balanceOf(minter)).toNumber()).to.equal(1e5);

      // the USD tokens held by the proxy contract are transferred to the lost
      // and found address
      expect(
        (await proxyAsV2.balanceOf(proxyAsV2.address)).toNumber()
      ).to.equal(0);
      expect((await proxyAsV2.balanceOf(lostAndFound)).toNumber()).to.equal(
        100e6
      );

      // token proxy contract is blacklisted
      expect(await proxyAsV2.isBlacklisted(proxyAsV2.address)).to.equal(true);

      // mint works as expected
      await proxyAsV2.configureMinter(minter, 1000e6, {
        from: await proxyAsV2.masterMinter(),
      });
      await proxyAsV2.mint(alice, 1000e6, { from: minter });
      expect((await proxyAsV2.balanceOf(alice)).toNumber()).to.equal(1000e6);
      await expectRevert(
        proxyAsV2.mint(alice, 1, { from: alice }),
        "caller is not a minter"
      );

      // transfer works as expected
      await proxyAsV2.transfer(bob, 200e6, { from: alice });
      expect((await proxyAsV2.balanceOf(alice)).toNumber()).to.equal(800e6);
      expect((await proxyAsV2.balanceOf(bob)).toNumber()).to.equal(200e6);
      await expectRevert(
        proxyAsV2.transfer(proxyAsV2.address, 1, { from: alice }),
        "account is blacklisted"
      );

      // approve/transferFrom work as expected
      await proxyAsV2.approve(bob, 250e6, { from: alice });
      expect((await proxyAsV2.allowance(alice, bob)).toNumber()).to.equal(
        250e6
      );
      await proxyAsV2.transferFrom(alice, bob, 250e6, { from: bob });
      expect((await proxyAsV2.allowance(alice, bob)).toNumber()).to.equal(0);
      expect((await proxyAsV2.balanceOf(alice)).toNumber()).to.equal(550e6);
      expect((await proxyAsV2.balanceOf(bob)).toNumber()).to.equal(450e6);
      await expectRevert(
        proxyAsV2.approve(proxyAsV2.address, 1, { from: alice }),
        "account is blacklisted"
      );

      // burn works as expected
      expect((await proxyAsV2.balanceOf(minter)).toNumber()).to.equal(1e5);
      await proxyAsV2.burn(1e5, { from: minter });
      expect((await proxyAsV2.balanceOf(minter)).toNumber()).to.equal(0);
      await expectRevert(
        proxyAsV2.burn(1, { from: alice }),
        "caller is not a minter"
      );
    });

    it("reverts if there is an error", async () => {
      fiatTokenProxy = await FiatTokenProxy.new(v1Implementation.address, {
        from: originalProxyAdmin,
      });
      //const fiatTokenV1_1 = await FiatTokenV1_1.new();
      const upgraderOwner = accounts[0];

      const upgrader = await V2Upgrader.new(
        fiatTokenProxy.address,
        proxyAsV1.address, // provide V1 implementation instead of V2
        originalProxyAdmin,
        "Inclusion USD",
        lostAndFound,
        { from: upgraderOwner }
      );

      // Transfer 0.2 USD to the contract
      await proxyAsV1.transfer(upgrader.address, 2e5, { from: minter });

      // Transfer admin role to the contract
      await fiatTokenProxy.changeAdmin(upgrader.address, {
        from: originalProxyAdmin,
      });

      // Upgrade should fail because initializeV2 function doesn't exist on V1
      await expectRevert(upgrader.upgrade({ from: upgraderOwner }), "revert");

      // The proxy admin role is not transferred
      expect(await fiatTokenProxy.admin()).to.equal(upgrader.address);

      // The implementation is left unchanged
      expect(await fiatTokenProxy.implementation()).to.equal(
        v1Implementation.address
      );
    });
  });

  describe("abortUpgrade", () => {
    it("transfers proxy admin role to newProxyAdmin and self-destructs", async () => {
      fiatTokenProxy = await FiatTokenProxy.new(v1Implementation.address, {
        from: originalProxyAdmin,
      });
      const upgraderOwner = accounts[0];
      const upgrader = await V2Upgrader.new(
        fiatTokenProxy.address,
        v2Implementation.address,
        originalProxyAdmin,
        "Inclusion USD",
        lostAndFound,
        { from: upgraderOwner }
      );

      // Transfer 0.2 USD to the contract
      await proxyAsV1.transfer(upgrader.address, 2e5, { from: minter });

      // Transfer admin role to the contract
      await fiatTokenProxy.changeAdmin(upgrader.address, {
        from: originalProxyAdmin,
      });

      // Call abortUpgrade
      await upgrader.abortUpgrade({ from: upgraderOwner });

      // The proxy admin role is transferred back to originalProxyAdmin
      expect(await fiatTokenProxy.admin()).to.equal(originalProxyAdmin);

      // The implementation is left unchanged
      expect(await fiatTokenProxy.implementation()).to.equal(
        v1Implementation.address
      );
    });
  });
});