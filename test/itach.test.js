const test = require("ava");
const sinon = require("sinon");
const { UnifiedClient } = require("../");

const NON_EXISTING_IP = "192.168.9.234";
const client = new UnifiedClient();

test.beforeEach((t) => {
  client.close();
  client.removeAllListeners();
  client.setOptions({
    host: "192.168.1.25",
    port: 4998,
    reconnect: true,
    sendTimeout: 500,
    retryInterval: 99,
    connectionTimeout: 3000,
    reconnectDelay: 3000
  });
  client.on("error", console.log);
});

test.afterEach((t) => {
  client.close({ reconnect: false });
});

// TODO Not suitable as a unit test, requires real device. Separate as integration test.
test.serial.skip("can connect to itach device", async (t) => {
  t.timeout(6000);

  const connectFunc = sinon.spy();

  client.on("connect", connectFunc);

  client.connect();

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      t.is(connectFunc.callCount, 1);
      resolve();
    }, 5000);
  });
});

test.serial("connection times out", async (t) => {
  t.timeout(6000);

  const connectFunc = sinon.spy();
  const errorFunc = sinon.spy();

  client.on("connect", connectFunc);
  client.on("error", errorFunc);

  client.connect({
    host: NON_EXISTING_IP,
    connectionTimeout: 100,
    reconnect: false
  });

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        t.is(connectFunc.callCount, 0);
        t.true(errorFunc.callCount >= 1);
        const err = errorFunc.getCall(0).args[0];
        t.true(err instanceof Error, "Expected an Error object");
        t.true(
          err.message.startsWith("Can't connect after") || err.code === "EHOSTUNREACH" || err.code === "EHOSTDOWN",
          `Got unexpected error: "${err}"`
        );
        resolve();
      } catch (e) {
        reject(e);
      }
    }, 5000);
  });
});

test.serial("reconnects after connection times out", async (t) => {
  t.timeout(5000);

  const connectFunc = sinon.spy();
  const errorFunc = sinon.spy();

  client.on("connect", connectFunc);
  client.on("error", errorFunc);

  client.connect({ host: NON_EXISTING_IP, connectionTimeout: 100 });

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        t.is(connectFunc.callCount, 0);
        t.assert(errorFunc.callCount > 1);
        const err = errorFunc.getCall(0).args[0];
        t.true(err instanceof Error, "Expected an Error object");
        t.true(
          err.message.startsWith("Can't connect after") || err.code === "EHOSTUNREACH" || err.code === "EHOSTDOWN",
          `Got unexpected error: "${err}"`
        );
        resolve();
      } catch (e) {
        reject(e);
      }
    }, 3000);
  });
});

// TODO Not suitable as a unit test, requires real device. Separate as integration test.
test.serial.skip("sending sendir commands", (t) => {
  t.plan(1);

  client.connect();

  client.on("connect", async () => {
    const result = await client.send(
      "sendir,1:1,1,38400,1,1,347,173,22,22,22,65,22,22,22,22,22,65,22,22,22,22,22,22,22,22,22,22,22,65,22,22,22,65,22,65,22,22,22,22,22,22,22,22,22,65,22,22,22,22,22,22,22,22,22,22,22,65,22,65,22,22,22,65,22,65,22,65,22,65,22,65,22,1657"
    );
    t.is(result, "completeir,1:1,1");
  });
});

// TODO Not suitable as a unit test, requires real device. Separate as integration test.
test.serial.skip("error when sending invalid sendir commands", (t) => {
  t.plan(2);

  client.connect();

  client.on("connect", async () => {
    const error = await t.throwsAsync(client.send("sendir:"), {
      instanceOf: Error
    });
    t.is(error.message, "Invalid command. Command not found.");
  });
});

// @TODO: this test is not possible on live device since response is too fast and will never actually time out
test.serial.skip("error when sendtimeout reached", (t) => {
  t.plan(2);

  client.connect({ sendTimeout: 1 });

  client.on("connect", async () => {
    const error = await t.throws(client.send("getdevices"), Error);
    t.is(error.message, "QueueTaskTimeout: Task failed to complete before timeout was reached.");
  });
});
