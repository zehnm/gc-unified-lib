const { UnifiedClient } = require("../src/itach");


const client = new UnifiedClient();

client.on("connect", async () => {
  console.debug("[sendir] Connected to device");
  try {
    console.info("Version:", await client.send("getversion"));
    // console.log(await send("getdevices"));
    console.info("Devices:", await client.getDevices());
    console.info("Network:", await client.send("get_NET,0:1"));
    const cmd = 'sendir,1:1,1,38000,1,69,340,169,20,20,20,20,20,64,20,20,20,20,20,20,20,20,20,20,20,64,20,64,20,20,20,64,20,64,20,64,20,64,20,64,20,20,20,64,20,64,20,64,20,20,20,20,20,20,20,20,20,64,20,20,20,20,20,20,20,64,20,64,20,64,20,64,20,1544,340,85,20,3663';
    console.info("irsend :", await client.send(cmd));
  } catch (error) {
    console.error("[sendir] Failed to send a command.", error)
  }

  console.info("Keeping connection open. You can disconnect the network to test the reconnection function!")
  // client.close({ reconnect: false })
});

client.on("close", () => {
  console.info("[sendir] Connection closed.");
})

client.on("error", (e) => {
  console.error("[sendir]", e);
})

client.on("state", (state) => {
  console.debug("[sendir] connection state change:", state);
})

client.connect({ host: "172.16.16.127", reconnect: true, tcpKeepAlive: true, tcpKeepAliveInitialDelay: 10000 });
