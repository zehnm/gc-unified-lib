const test = require("ava");
const sinon = require("sinon");
const { createQueue, checkErrorResponse } = require("../src/utils");

test("nothing run when paused", (t) => {
  const taskFunc = sinon.stub().returns(1);
  const q = createQueue(taskFunc);
  const someItem = {};

  q.pause();

  q.push(someItem);
  q.push(someItem);
  q.push(someItem);
  t.true(taskFunc.notCalled);
});

test("runs queued item immediatly", async (t) => {
  t.plan(3);
  const taskFunc = sinon.stub().returns(1);
  const q = createQueue(taskFunc, 1, 3000);
  const someItem = {};
  const promises = [];

  promises[0] = q.push(someItem);
  promises[1] = q.push(someItem);

  t.deepEqual(await Promise.all(promises), [1, 1]);
  t.true(taskFunc.alwaysCalledWith(someItem));
  t.is(taskFunc.callCount, 2);
});

test("runs queued item after being paused", async (t) => {
  t.plan(3);
  const taskFunc = sinon.stub().returns(1);
  const q = createQueue(taskFunc, 4, 3000);
  const someItem = {};
  const promises = [];

  q.pause();

  promises[0] = q.push(someItem);
  promises[1] = q.push(someItem);
  promises[2] = q.push(someItem);
  promises[3] = q.push(someItem);

  q.resume();

  const result = await Promise.all(promises);
  t.deepEqual(result, [1, 1, 1, 1]);
  t.true(taskFunc.alwaysCalledWith(someItem));
  t.is(taskFunc.callCount, 4);
});

test("task times out if not resolved", async (t) => {
  t.plan(1);
  const taskFunc = sinon.stub().resolves(new Promise(() => {}));
  const q = createQueue(taskFunc);
  const someItem = {};

  await t.throwsAsync(q.push(someItem, 1000), { instanceOf: Error });
});

test("normal response is not an error", (t) => {
  const response = "NET,0:1,UNLOCKED,DHCP,192.168.0.100,255.255.255.0,192.168.0.1\r";
  const responseEndIndex = response.lastIndexOf("\r");

  try {
    checkErrorResponse(response, responseEndIndex);
    t.pass();
  } catch (e) {
    t.fail(`No error expected, got: ${e}`);
  }
});

const detectError = test.macro((t, input, expected) => {
  const responseEndIndex = input.lastIndexOf("\r");

  try {
    checkErrorResponse(input, responseEndIndex);
    t.fail("Error response not detected");
  } catch (e) {
    t.is(e.message, expected);
  }
});

test("detect GC-100 error", detectError, "unknowncommand 3\r", "Invalid module address (module does not exist). (3)");
test(
  "detect iTach error",
  detectError,
  "ERR_1:1,014\r",
  "Blaster command sent to non-blaster connector. (ERR_1:1,014)"
);
test("detect Flex error", detectError, "ERR SL001\r", "Invalid baud rate. (ERR SL001)");
test("detect Global Connect error", detectError, "ERR RO002\r", "Invalid logical relay state. (ERR RO002)");

test("detect undefined GC-100 error", detectError, "unknowncommand 99\r", "unknowncommand 99");
test("detect undefined iTach error", detectError, "ERR_1:1,042\r", "ERR_1:1,042");
test("detect undefined Flex error", detectError, "ERR SL009\r", "ERR SL009");
test("detect undefined Global Connect error", detectError, "ERR foobar\r", "ERR foobar");
