const { UnifiedClient } = require("../src/itach");


const client = new UnifiedClient();

const GC100 = false;

const host = GC100 ? "172.16.16.184" : "172.16.16.129";
const irModule = GC100 ? "4:1" : "1:1";
const tcpKeepAlive = !GC100;

client.on("connect", async () => {
  console.debug("[sendir] Connected to device");
  try {
    console.info("Version:", await client.send("getversion\r"));
    console.info("Devices:", await client.getDevices());
    console.info("Network:", await client.send("get_NET,0:1"));
    let cmd = `sendir,${irModule},1,38000,1,69,340,169,20,20,20,20,20,64,20,20,20,20,20,20,20,20,20,20,20,64,20,64,20,20,20,64,20,64,20,64,20,64,20,64,20,20,20,64,20,64,20,64,20,20,20,20,20,20,20,20,20,64,20,20,20,20,20,20,20,64,20,64,20,64,20,64,20,1544,340,85,20,3663`;
    console.info("irsend :", await client.send(cmd));

    cmd = `sendir,${irModule},2,38000,1,69,340,169,20,20,20,20,20,64,20,20,20,20,20,20,20,20,20,20,20,64,20,64,20,20,20,64,20,64,20,64,20,64,20,64,20,20,20,64,20,64,20,64,20,20,20,20,20,20,20,20,20,64,20,20,20,20,20,20,20,64,20,64,20,64,20,64,20,1544,340,85,20,3663`;
    console.info("irsend fire & forget", client.send(cmd).catch(reason => {
      console.error("irsend 1st failed:", reason);
    }));

    cmd = `sendir,${irModule},3,38000,10,69,340,169,20,20,20,20,20,64,20,20,20,20,20,20,20,20,20,20,20,64,20,64,20,20,20,64,20,64,20,64,20,64,20,64,20,20,20,64,20,64,20,64,20,20,20,20,20,20,20,20,20,64,20,20,20,20,20,20,20,64,20,64,20,64,20,64,20,1544,340,85,20,3663`;
    console.info("irsend fire & forget", client.send(cmd).catch(reason => {
      console.error("irsend 2nd failed:", reason);
    }));

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

client.connect({ host, reconnect: true, tcpKeepAlive, tcpKeepAliveInitialDelay: 10000 });
