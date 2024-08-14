/**
 * Rejects a passed promise if it hasn't completed in time
 *
 * @return a promise that will be rejected when the timeout is reached otherwise the result of the passed promise
 */
const timeoutPromise = ({ promise, timeout, error }) => {
  let timer = null;

  return Promise.race([
    new Promise((resolve, reject) => {
      timer = setTimeout(reject, timeout, error);
      return timer;
    }),
    promise.then((value) => {
      clearTimeout(timer);
      return value;
    })
  ]);
};

const createQueue = (taskFunc, concurrency = 1) => {
  const queue = [];
  let active = 0;
  let paused = false;

  const run = async function () {
    if (paused || active >= concurrency || queue.length < 1) {
      return;
    }
    active += 1;
    const queueItem = queue.shift();
    try {
      if (queueItem.timer) {
        clearTimeout(queueItem.timer);
      }
      if (queueItem.expired) {
        // skip expired item, process next one
      } else if (queueItem.timeout) {
        queueItem.resolve(
          timeoutPromise({
            promise: taskFunc(queueItem.task),
            timeout: queueItem.timeout, // TODO adjust remaining timeout (i.e. deduct waiting time in queue) or add a separate queue waiting timeout?
            error: new Error("QueueTaskTimeout: Task failed to complete before timeout was reached.")
          })
        );
      } else {
        queueItem.resolve(taskFunc(queueItem.task));
      }
    } catch (error) {
      queueItem.reject(error);
    } finally {
      active -= 1;
      run();
    }
  };

  const createQueueItem = function (task, sendTimeout, queueTimeout, resolve, reject) {
    const timestamp = Date.now();
    const expired = false;
    const queueItem = { timestamp, expired, task, resolve, reject, timeout: sendTimeout, timer: null };
    if (queueTimeout) {
      queueItem.timer = setTimeout(() => {
        queueItem.expired = true;
        queueItem.reject(`Request is expired (${queueTimeout}ms)`);
      }, queueTimeout);
    }

    return queueItem;
  };

  return {
    push: (task, sendTimeout, queueTimeout) =>
      new Promise((resolve, reject) => {
        queue.push(createQueueItem(task, sendTimeout, queueTimeout, resolve, reject));
        run();
      }),
    priority: (task, sendTimeout, queueTimeout) =>
      new Promise((resolve, reject) => {
        queue.unshift(createQueueItem(task, sendTimeout, queueTimeout, resolve, reject));
        run();
      }),
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      run();
    },
    clear: () => {
      let queueItem;
      while (typeof (queueItem = queue.shift()) !== "undefined") {
        console.debug("Removing queue item:", queueItem);
        queueItem.reject(new Error("Clearing queue"));
      }
      queue.length = 0;
    }
  };
};

module.exports = { createQueue };
