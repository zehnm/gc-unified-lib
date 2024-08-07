const { discover } = require("../src/discover");
const { retrieveDeviceInfo } = require("../src/models");

discover(45000).then((devices) => {
  console.info("Found devices:", devices);

  devices.forEach(device => {
    const address = device.get("address");
    console.info("Retrieving device info from", address);
    retrieveDeviceInfo(address).then((deviceInfo) => {
        console.info(deviceInfo);
      },
      (reason) => {
        console.error("Failed to retrieve device info:", reason);
      }
    );
  });
});
