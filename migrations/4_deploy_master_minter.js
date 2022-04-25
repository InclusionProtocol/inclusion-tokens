const fs = require("fs");
const path = require("path");
const some = require("lodash/some");

const MasterMinter = artifacts.require("MasterMinter.sol");
const FiatTokenProxy = artifacts.require("FiatTokenProxy.sol");

let masterMinterAddress = "";
let proxyContractAddress = "";

// Read config file if it exists
if (fs.existsSync(path.join(__dirname, "..", "config.js"))) {
  ({
    MASTERMINTER_ADDRESS: masterMinterAddress,
    PROXY_CONTRACT_ADDRESS: proxyContractAddress,
  } = require("../config.js"));
}

module.exports = async (deployer, network) => {
  if (some(["development", "coverage"], (v) => network.includes(v))) {
    // DO NOT USE THESE ADDRESSES IN PRODUCTION
    masterMinterAddress = "0x3e5e9111ae8eb78fe1cc3bb8915d5d461f3ef9a9";
    proxyContractAddress = (await FiatTokenProxy.deployed()).address;
  }
  proxyContractAddress =
    proxyContractAddress || (await FiatTokenProxy.deployed()).address;

  console.log(`FiatTokenProxy: ${proxyContractAddress}`);

  console.log("Deploying MasterMinter contract...");
  await deployer.deploy(MasterMinter, proxyContractAddress);

  const masterMinter = await MasterMinter.deployed();
  console.log("✅  Deployed MasterMinter at", masterMinter.address);

  console.log("Reassigning owner to", masterMinterAddress);
  await masterMinter.transferOwnership(masterMinterAddress);
};
