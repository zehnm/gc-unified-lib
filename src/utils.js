const { ERRORCODES } = require("./config");

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
      if (queueItem.timeout) {
        queueItem.resolve(
          timeoutPromise({
            promise: taskFunc(queueItem.task),
            timeout: queueItem.timeout,
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

  return {
    push: (task, timeout) =>
      new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject, timeout });
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

/**
 * Check if a Global Caché response message is an error response.
 *
 * @param response the response message.
 * @param responseEndIndex end index of the response message.
 * @throws Error is thrown in case of an error response.
 */
function checkErrorResponse(response, responseEndIndex) {
  if (response.startsWith("ERR_")) {
    // handle iTach errors
    const errorCode = response.substring(responseEndIndex - 3, responseEndIndex);
    const msg = ERRORCODES[errorCode];
    if (msg === undefined) {
      throw new Error(response.trim());
    } else {
      throw new Error(`${msg} (${response.trim()})`);
    }
  } else if (response.startsWith("ERR ")) {
    // handle Flex & Global Connect errors
    const errorCode = response.trim();
    const msg = ERRORCODES[errorCode];
    if (msg === undefined) {
      throw new Error(errorCode);
    } else {
      throw new Error(`${msg} (${response.trim()})`);
    }
  } else if (response.startsWith("unknowncommand")) {
    // handle GC-100 errors
    const errorCode = response.trim();
    const msg = ERRORCODES[errorCode];
    if (msg === undefined) {
      throw new Error(errorCode);
    } else {
      throw new Error(`${msg} (${response.substring(14).trim()})`);
    }
  }
}

module.exports = { createQueue, checkErrorResponse };
