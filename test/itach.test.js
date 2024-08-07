const test = require("ava");
const sinon = require("sinon");
const itach = require("../");

const NON_EXISTING_IP = "192.168.9.234";

test.beforeEach((t) => {
  itach.removeAllListeners();
  itach.setOptions({
    host: "192.168.1.25",
    port: 4998,
    reconnect: true,
    reconnectSleep: 1000,
    sendTimeout: 500,
    retryInterval: 99,
    connectionTimeout: 3000
  });
  // t.deepEqual(itach.eventNames(), []);
  itach.on("error", console.log);
});

test.afterEach((t) => {
  itach.close({ reconnect: false });
});

// TODO Not suitable as a unit test, requires real device. Separate as integration test.
test.serial.skip("can connect to itach device", async (t) => {
  t.timeout(6000);

  const connectFunc = sinon.spy();

  itach.on("connect", connectFunc);

  itach.connect();

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

  itach.on("connect", connectFunc);
  itach.on("error", errorFunc);

  itach.connect({
    host: NON_EXISTING_IP,
    connectionTimeout: 100,
    reconnect: false
  });

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      t.is(connectFunc.callCount, 0);
      t.is(errorFunc.callCount, 1);
      const msg = errorFunc.getCall(0).args[0].message;
      t.true(msg === "Connection timeout." || msg.startsWith("Error: connect EHOSTUNREACH"));
      resolve();
    }, 5000);
  });
});

// TODO test doesn't always work, just hangs forever after reconnect attempt
test.serial("reconnects after connection times out", async (t) => {
  t.timeout(10000);

  const connectFunc = sinon.spy();
  const errorFunc = sinon.spy();

  itach.on("connect", connectFunc);
  itach.on("error", errorFunc);

  itach.connect({ host: NON_EXISTING_IP, connectionTimeout: 100 });

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      t.is(connectFunc.callCount, 0);
      t.assert(errorFunc.callCount > 1);
      const msg = errorFunc.getCall(0).args[0].message;
      t.true(msg === "Connection timeout." || msg.startsWith("Error: connect EHOSTUNREACH"));
      resolve();
    }, 5000);
  });
});

// TODO Not suitable as a unit test, requires real device. Separate as integration test.
test.serial.skip("sending sendir commands", (t) => {
  t.plan(1);

  itach.connect();

  itach.on("connect", async () => {
    const result = await itach.send(
      "sendir,1:1,1,38400,1,1,347,173,22,22,22,65,22,22,22,22,22,65,22,22,22,22,22,22,22,22,22,22,22,65,22,22,22,65,22,65,22,22,22,22,22,22,22,22,22,65,22,22,22,22,22,22,22,22,22,22,22,65,22,65,22,22,22,65,22,65,22,65,22,65,22,65,22,1657"
    );
    t.is(result, "completeir,1:1,1");
  });
});

// TODO Not suitable as a unit test, requires real device. Separate as integration test.
test.serial.skip("error when sending invalid sendir commands", (t) => {
  t.plan(2);

  itach.connect();

  itach.on("connect", async () => {
    const error = await t.throwsAsync(itach.send("sendir:"), {
      instanceOf: Error
    });
    t.is(error.message, "Invalid command. Command not found.");
  });
});

// @TODO: this test is not possible on live device since response is too fast and will never actually time out
test.serial.skip("error when sendtimeout reached", (t) => {
  t.plan(2);

  itach.connect({ sendTimeout: 1 });

  itach.on("connect", async () => {
    const error = await t.throws(itach.send("getdevices"), Error);
    t.is(error.message, "QueueTaskTimeout: Task failed to complete before timeout was reached.");
  });
});
