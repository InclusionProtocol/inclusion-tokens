import BN from "bn.js";
import { FiatTokenProxyInstance } from "../../@types/generated";

const FiatTokenProxy = artifacts.require("FiatTokenProxy");
const FiatTokenV1 = artifacts.require("FiatTokenV1");

export function usesOriginalStorageSlotPositions<
  T extends Truffle.ContractInstance
>({
  Contract,
  accounts,
}: {
  Contract: Truffle.Contract<T>;
  accounts: Truffle.Accounts;
}): void {
  describe("uses original storage slot positions", () => {
    const [name, symbol, currency, decimals] = [
      "Inclusion USD",
      "USDI",
      "USD",
      6,
    ];
    const [mintAllowance, minted, transferred, allowance] = [
      1000e6,
      100e6,
      30e6,
      10e6,
    ];
    const [
      owner,
      proxyAdmin,
      masterMinter,
      pauser,
      blacklister,
      minter,
      rescuer,
      alice,
      bob,
      charlie,
    ] = accounts;

    let fiatToken: T;
    let proxy: FiatTokenProxyInstance;

    beforeEach(async () => {
      fiatToken = await Contract.new();
      proxy = await FiatTokenProxy.new(fiatToken.address);
      await proxy.changeAdmin(proxyAdmin);

      const proxyAsFiatTokenV1 = await FiatTokenV1.at(proxy.address);
      await proxyAsFiatTokenV1.initialize(
        name,
        symbol,
        currency,
        decimals,
        masterMinter,
        pauser,
        blacklister,
        owner
      );

      await proxyAsFiatTokenV1.configureMinter(minter, mintAllowance, {
        from: masterMinter,
      });
      await proxyAsFiatTokenV1.mint(alice, minted, { from: minter });
      await proxyAsFiatTokenV1.transfer(bob, transferred, { from: alice });
      await proxyAsFiatTokenV1.approve(charlie, allowance, { from: alice });
      await proxyAsFiatTokenV1.blacklist(charlie, { from: blacklister });
      await proxyAsFiatTokenV1.pause({ from: pauser });
      await proxyAsFiatTokenV1.updateRescuer(rescuer, { from: owner });
    });

    it("retains original storage slots 0 through 13", async () => {
      const slots = new Array<string>(15);
      for (let i = 0; i < slots.length; i++) {
        slots[i] = await readSlot(proxy.address, i);
      }

      // slot 0 - owner
      expect(parseAddress(slots[0])).to.equal(owner); // owner

      // slot 1 - pauser, paused
      // values are lower-order aligned
      expect(parseInt(slots[1].slice(0, 2), 16)).to.equal(1); // paused
      expect(parseAddress(slots[1].slice(2))).to.equal(pauser); // pauser

      // slot 2 - blacklister
      expect(parseAddress(slots[2])).to.equal(blacklister); // blacklister

      // slot 3 - blacklisted (mapping, slot is unused)
      expect(slots[3]).to.equal("0");

      // slot 4 - rescuer
      expect(parseAddress(slots[4])).to.equal(rescuer);

      // slot 5 - name
      expect(parseString(slots[5])).to.equal(name);

      // slot 6 - symbol
      expect(parseString(slots[6])).to.equal(symbol);

      // slot 7 - decimals
      expect(parseUint(slots[7]).toNumber()).to.equal(decimals);

      // slot 8 - currency
      expect(parseString(slots[8])).to.equal(currency);

      // slot 9 - masterMinter, initialized
      expect(slots[9].slice(0, 2)).to.equal("01"); // initialized
      expect(parseAddress(slots[9].slice(2))).to.equal(masterMinter); // masterMinter

      // slot 10 - balances (mapping, slot is unused)
      expect(slots[10]).to.equal("0");

      // slot 11 - allowed (mapping, slot is unused)
      expect(slots[11]).to.equal("0");

      // slot 12 - totalSupply
      expect(parseUint(slots[12]).toNumber()).to.equal(minted);

      // slot 13 - minters (mapping, slot is unused)
      expect(slots[13]).to.equal("0");

      // slot 14 - minterAllowed (mapping, slot is unused)
      expect(slots[14]).to.equal("0");
    });

    it("retains original storage slots for blacklisted mapping", async () => {
      // blacklisted[alice]
      let v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(alice, 3)),
        16
      );
      expect(v).to.equal(0);

      // blacklisted[charlie]
      v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(charlie, 3)),
        16
      );
      expect(v).to.equal(1);
    });

    it("retains original storage slots for balances mapping", async () => {
      // balance[alice]
      let v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(alice, 10)),
        16
      );
      expect(v).to.equal(minted - transferred);

      // balances[bob]
      v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(bob, 10)),
        16
      );
      expect(v).to.equal(transferred);
    });

    it("retains original storage slots for allowed mapping", async () => {
      // allowed[alice][bob]
      let v = parseInt(
        await readSlot(proxy.address, address2MappingSlot(alice, bob, 11)),
        16
      );
      expect(v).to.equal(0);
      // allowed[alice][charlie]
      v = parseInt(
        await readSlot(proxy.address, address2MappingSlot(alice, charlie, 11)),
        16
      );
      expect(v).to.equal(allowance);
    });

    it("retains original storage slots for minters mapping", async () => {
      // minters[minter]
      let v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(minter, 13)),
        16
      );
      expect(v).to.equal(1);

      // minters[alice]
      v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(alice, 13)),
        16
      );
      expect(v).to.equal(0);
    });

    it("retains original storage slots for minterAllowed mapping", async () => {
      // minterAllowed[minter]
      let v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(minter, 14)),
        16
      );
      expect(v).to.equal(mintAllowance - minted);

      // minterAllowed[alice]
      v = parseInt(
        await readSlot(proxy.address, addressMappingSlot(alice, 14)),
        16
      );
      expect(v).to.equal(0);
    });
  });
}

async function readSlot(
  address: string,
  slot: number | string
): Promise<string> {
  const data = await web3.eth.getStorageAt(
    address,
    slot as number // does support string, but type definition file is wrong
  );
  return data.replace(/^0x/, "");
}

function parseAddress(hex: string): string {
  return web3.utils.toChecksumAddress(hex.padStart(40, "0"));
}

function parseString(hex: string): string {
  const len = parseInt(hex.slice(-2), 16);
  return Buffer.from(hex.slice(0, len), "hex").toString("utf8");
}

function parseUint(hex: string): BN {
  return new BN(hex, 16);
}

function encodeUint(value: number | BN): string {
  return new BN(value).toString(16).padStart(64, "0");
}

function encodeAddress(addr: string): string {
  return addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function addressMappingSlot(addr: string, pos: number): string {
  return web3.utils.keccak256("0x" + encodeAddress(addr) + encodeUint(pos));
}

function address2MappingSlot(addr: string, addr2: string, pos: number): string {
  return web3.utils.keccak256(
    "0x" + encodeAddress(addr2) + addressMappingSlot(addr, pos).slice(2)
  );
}
