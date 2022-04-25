const fs = require("fs");
const path = require("path");
const some = require("lodash/some");

const FiatTokenProxy = artifacts.require("FiatTokenProxy");
const FiatTokenUtil = artifacts.require("FiatTokenUtil");

let proxyContractAddress = "";

// Read config file if it exists
if (fs.existsSync(path.join(__dirname, "..", "config.js"))) {
  ({ PROXY_CONTRACT_ADDRESS: proxyContractAddress } = require("../config.js"));
}

module.exports = async (deployer, network) => {
  if (
    !proxyContractAddress ||
    some(["development", "coverage"], (v) => network.includes(v))
  ) {
    proxyContractAddress = (await FiatTokenProxy.deployed()).address;
  }

  console.log(`FiatTokenProxy: ${proxyContractAddress}`);

  console.log("Deploying FiatTokenUtil contract...");
  const fiatTokenUtil = await deployer.deploy(
    FiatTokenUtil,
    proxyContractAddress
  );
  console.log("✅  Deployed FiatTokenUtil at", fiatTokenUtil.address);
};
