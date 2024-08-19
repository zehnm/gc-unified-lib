const test = require("ava");
const sinon = require("sinon");

const { MessageQueue } = require("../src/msg_queue");
const { ResponseError } = require("../src/models");

test("nothing run when paused", (t) => {
  const taskFunc = sinon.stub();
  const q = new MessageQueue(taskFunc);
  const someItem = "getversion";

  q.pause();

  q.push(someItem);
  q.push(someItem);
  q.push(someItem);
  q.drop();
  t.true(taskFunc.notCalled);
});

test("clear rejects all items", (t) => {
  const taskFunc = sinon.stub();
  const q = new MessageQueue(taskFunc);
  const someItem = "getversion";
  const promises = [];

  q.pause();

  promises.push(q.push(someItem));
  promises.push(q.push(someItem));
  promises.push(q.push(someItem));
  Promise.allSettled(promises).then((results) => {
    t.is(results.length, 3);
    for (const result of results) {
      t.is(result.status, "rejected");
      t.is(result.reason.code, "QUEUE_CLEARED");
    }
  });
  q.clear();
  t.true(taskFunc.notCalled);
});

test("runs queued items immediately", async (t) => {
  const taskFunc = sinon.stub();
  const q = new MessageQueue(taskFunc);
  const someItem = "getstate";
  const promises = [];

  promises[0] = q.push(someItem);
  promises[1] = q.push(someItem);

  q.handleResponse("state,foo");
  q.handleResponse("state,bar");

  t.deepEqual(await Promise.all(promises), ["state,foo", "state,bar"]);
  t.true(taskFunc.alwaysCalledWith(someItem));
  t.is(taskFunc.callCount, 2);
});

test("runs queued item after being paused", async (t) => {
  t.timeout(1000);

  const taskFunc = sinon.stub();
  const q = new MessageQueue(taskFunc);
  const someItem = "getstate";
  const promises = [];

  q.pause();

  promises[0] = q.push(someItem);
  promises[1] = q.push(someItem);
  promises[2] = q.push(someItem);
  promises[3] = q.push(someItem);

  t.true(taskFunc.notCalled);

  q.resume();

  // some time required to start processing messages (uses process.nextTick)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      t.is(q.handleResponse("state,1"), true);
      t.is(q.handleResponse("state,2"), true);
      t.is(q.handleResponse("state,3"), true);
      t.is(q.handleResponse("state,4"), true);
      resolve();
    }, 10);
  })
    .then(() => Promise.all(promises))
    .then((result) => {
      t.deepEqual(result, ["state,1", "state,2", "state,3", "state,4"]);
      t.true(taskFunc.alwaysCalledWith(someItem));
      t.is(taskFunc.callCount, 4);
    });
});

test("task times out if not processed", async (t) => {
  const taskFunc = sinon.stub();
  const q = new MessageQueue(taskFunc);
  const someItem = "getversion";

  q.pause();

  await t.throwsAsync(q.push(someItem, { queueTimeout: 10 }), { instanceOf: ResponseError });
});
