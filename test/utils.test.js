const test = require("ava");
const sinon = require("sinon");
const { timeoutPromise } = require("../src/utils");

test("timeoutPromise times out if task takes longer than timeout", async (t) => {
  const taskFunc = sinon.stub().returns(1);

  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(taskFunc());
    }, 10);
  });

  try {
    const result = await timeoutPromise({ promise, timeout: 1, error: "timeout" });
    t.fail(`timeout rejection expected, but got: ${result}`);
  } catch (e) {
    t.true(taskFunc.notCalled);
  }
});

test("timeoutPromise resolves if task is faster than timeout", async (t) => {
  const taskFunc = sinon.stub().returns(1);

  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(taskFunc());
    }, 10);
  });

  try {
    const result = await timeoutPromise({ promise, timeout: 10, error: "timeout" });
    t.is(taskFunc.callCount, 1);
    t.is(result, 1);
  } catch (e) {
    t.fail(`resolve expected, but got: ${e}`);
  }
});
