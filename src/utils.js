/**
 * Rejects a passed promise if it hasn't completed in time
 *
 * @return a promise that will be rejected when the timeout is reached otherwise the result of the passed promise
 */
const timeoutPromise = ({ promise, timeout, error }) => {
  let timer;

  return Promise.race([
    new Promise((resolve, reject) => (timer = setTimeout(reject, timeout, error))),
    promise
  ]).finally(() => clearTimeout(timer));
};

module.exports = { timeoutPromise };
