const log = require("./loggers");
const { expectedResponse, modelFromVersion, ResponseError, checkErrorResponse } = require("./models");
const { timeoutPromise } = require("./utils");
const { options: defaultOptions } = require("./config");

/**
 * Public {@link MessageQueue} item.
 */
class Message {
  /**
   * Construct a public Message.
   * @param {string} message request message.
   * @param {string} msgPrefix message prefix for logging purposes. Avoids logging the (very) long sendir data.
   * @param {number} timestamp message enqueue timestamp.
   * @param reject message reject function
   */
  constructor(message, msgPrefix, timestamp, reject) {
    this.message = message;
    this.msgPrefix = msgPrefix;
    this.timestamp = timestamp;
    this.reject = reject;
  }
}

/**
 * Internal {@link MessageQueue} item.
 */
class MsgItem {
  // internal promise for message correlation
  msgResolve = null;
  msgReject = null;

  /**
   * Construct a new internal MsgItem.
   *
   * @param {number} id unique message identifier.
   * @param {string} message request message.
   * @param resolve
   * @param reject
   * @param queueTimerId
   * @param {number} sendTimeout message request timeout in milliseconds.
   */
  constructor(id, message, resolve, reject, queueTimerId, sendTimeout) {
    this.id = id;
    this.message = message;
    // message prefix for logging purposes. Avoids logging the (very) long sendir data.
    this.msgPrefix = message.split(",", 3).join(",").trim();
    this.expected = expectedResponse(message);
    // promise for client call
    this.resolve = resolve;
    this.reject = reject;
    this.queueTimerId = queueTimerId;
    this.sendTimeout = sendTimeout;
    this.timestamp = Date.now();
    this.processed = false;
  }
}

/**
 * This queue is tailored to Global Caché message patterns.
 *
 * It keeps track of messages and helps to resolve a request message from a received response or error message. There's
 * special handling for `sendir`, `stopir` and `busyir` messages, to properly resolve requests.
 *
 * Since not all Global Caché messages include a correlation ID, except for `sendir`, the resolving logic is best effort
 * only. This is especially true for certain device error responses, which don't include any request message information.
 *
 * - The queue can be paused and resumed for when the device connection is not available.
 * - New messages are by default enqueued at the end of the queue (FIFO).
 * - A priority option allows to send the request as fast as possible, i.e. at the next processing step.
 *   This is intended to be used for `stopir` request, when an IR transmission must be stopped as soon as possible.
 *
 * A queue item contains two timeout values:
 * 1. queue timeout: how long a request may be queued before it is sent to the device.
 * 2. send timeout: timeout after sending the message to receive a response.
 *
 * This queue has no direct dependencies on how messages are sent or received from a device. Sending a message is done
 * with the help of a callback function, which has to be specified in the constructor. Received messages must be
 * forwarded to the corresponding methods:
 * - {@link MessageQueue#handleResponse}: for normal response messages
 * - {@link MessageQueue#handleErrorResponse}: for error response messages
 */
class MessageQueue {
  #msgId = 0;
  #taskFunc;
  #list = [];
  #active = 0;
  #paused = false;
  #options = { ...defaultOptions };

  /**
   * Construct a new message queue.
   *
   * @param taskFunc callback function to call when a message item is processed. This is usually the "message send"
   *                 function, like writing the request message to a socket.
   */
  constructor(taskFunc) {
    this.#taskFunc = taskFunc;
  }

  /**
   * Pause message processing. Pending and new requests will no longer be sent.
   */
  pause() {
    log.debug("Pausing queue");
    this.#paused = true;
  }

  /**
   * Resume message processing. Start sending all pending and new requests.
   */
  resume() {
    if (!this.#paused) {
      return;
    }
    log.debug("Resuming queue");
    this.#paused = false;
    process.nextTick(() => {
      this.#run();
    });
  }

  /**
   * Clear queue and reject all pending messages.
   */
  clear() {
    log.debug("Clearing queue (%d items)", this.#list.length);
    let queueItem;
    while (typeof (queueItem = this.#list.shift()) !== "undefined") {
      const err = new ResponseError("Message send queue cleared", "QUEUE_CLEARED");
      if (queueItem.msgReject) {
        queueItem.msgReject(err);
      } else {
        queueItem.reject(err);
      }
    }

    this.#list.length = 0;
  }

  /**
   * Clear queue, drop all queued messages immediately **without** rejecting any messages.
   *
   * ⚠️ Use with caution: may leave item Promises in limbo! Intended for unit tests only.
   */
  _drop() {
    for (const item of this.#list) {
      clearTimeout(item.queueTimerId);
    }
    this.#list.length = 0;
  }

  /**
   * Add a new request to the queue. By default, the message is put at the end of the queue.
   *
   * @param {string} request request message to send.
   * @param {Object} [params] optional named parameters.
   * @param {number} [params.sendTimeout] request message timeout in milliseconds.
   * @param {number} [params.queueTimeout] queue timeout in milliseconds before the request needs to be sent.
   * @param {boolean} [params.priority=false] handle message as a priority message and put it at the start of the queue.
   * @return {Promise<string, Error>} the response message from the device, or an {@link Error} if message communication
   *         failed or an error response was returned.
   * @throws {ResponseError} if the message could not be sent, or an error response was received. For queue processing
   *   errors, the following `code` values are defined:
   *   - `QUEUE_TIMEOUT`: queue timeout expired, message could not be sent within the queue timeout.
   *   - `SEND_TIMEOUT`: message request timeout, no response received within the timeout.
   *   - `QUEUE_CLEARED`: the queue was cleared and all pending messages were removed, e.g. if the client disconnects.
   */
  async push(request, { sendTimeout = 1000, queueTimeout = 500, priority = false } = {}) {
    this.#msgId += 1;
    const msgId = this.#msgId;
    const that = this;

    if (request.startsWith("sendir")) {
      for (let i = 0; i < this.#list.length; i++) {
        if (this.#list[i].message === request) {
          this.#list[i].msgResolve("repeatir"); // custom response, NOT an official GC message!
          break;
        }
      }
    }

    return new Promise((resolve, reject) => {
      const timerId = setTimeout(() => {
        that.#removeItemByMsgId(msgId);
        const msg = `Request ${msgId} is expired (${queueTimeout}ms)`;
        log.debug(msg);
        reject(new ResponseError(msg, "QUEUE_TIMEOUT"));
      }, queueTimeout);

      const item = new MsgItem(msgId, request, resolve, reject, timerId, sendTimeout);
      log.debug(
        "Queueing new %srequest %d (pos: %d): %s",
        priority ? "priority " : "",
        item.id,
        priority ? 0 : this.#list.length,
        item.msgPrefix
      );
      if (priority) {
        this.#list.unshift(item);
      } else {
        this.#list.push(item);
      }
      this.#run();
    });
  }

  async #run() {
    const unprocessed = this.#unprocessedItemCount();
    if (this.#paused || this.#active >= 1 || unprocessed === 0) {
      log.debug(
        "queue processing stopped (paused=%s, active=%d, unprocessed=%d, items=%d)",
        this.#paused,
        this.#active,
        unprocessed,
        this.#list.length
      );
      return;
    }

    const queueItem = this.#nextUnprocessedItem();
    if (!queueItem) {
      return;
    }

    this.#active += 1;
    try {
      queueItem.processed = true;
      if (queueItem.queueTimerId) {
        clearTimeout(queueItem.queueTimerId);
      }

      if (queueItem.sendTimeout) {
        const msgTask = new Promise((resolve, reject) => {
          queueItem.msgResolve = resolve;
          queueItem.msgReject = reject;
          this.#taskFunc(queueItem.message);
        });

        queueItem.resolve(
          this.#removeQueueItemWrapper(
            queueItem.id,
            timeoutPromise({
              promise: msgTask,
              timeout: queueItem.sendTimeout,
              error: new ResponseError(
                `Send timeout: message ${queueItem.id} (${queueItem.msgPrefix}) didn't complete within ${queueItem.sendTimeout}ms.`,
                "SEND_TIMEOUT"
              )
            })
          )
        );
      } else {
        queueItem.resolve(this.#taskFunc(queueItem.message));
      }
    } catch (error) {
      this.#removeItemByMsgId(queueItem.id);
      queueItem.reject(error);
    } finally {
      this.#active -= 1;
      process.nextTick(() => {
        this.#run();
      });
    }
  }

  /**
   * A Promise wrapper to remove the message item from the queue after it has been resolved or rejected.
   *
   * @param {number} id message identifier
   * @param {Promise} promise Argument to be resolved by this Promise. Can also be a Promise or a thenable to resolve.
   * @return {Promise} A Promise  that is resolved with the given value, or the promise passed as value, if the value was a promise object.
   */
  async #removeQueueItemWrapper(id, promise) {
    try {
      return await Promise.resolve(promise);
    } finally {
      const request = this.#removeItemByMsgId(id);
      if (request) {
        log.debug("Removed request %d (%s)", request.id, request.msgPrefix);
      }
    }
  }

  /**
   * Process a received message, which is either a response message to a previous request, or an error response.
   *
   * @param {string} response original response message from device
   * @param {Object<string, *>} [options] optional options to fill {@link ResponseError} details like host and port.
   * @return {boolean} true if the response message could be handled, false if no corresponding request is available.
   */
  handleResponse(response, options) {
    // handle error response
    try {
      checkErrorResponse(response, response.length, options || this.#options);
    } catch (e) {
      return this.handleErrorResponse(response, e);
    }

    // handle normal response
    // TODO does busyir exist? iTach responds with busyIR, but Unified TCP API specifies busyir!
    if (response.startsWith("busyIR") || response.startsWith("busyir")) {
      // resend "sendir" command if port is busy
      const request = this.getBusyIrRequest(response);
      if (request) {
        // only resend if at least 100ms are remaining before the send timeout expires. Otherwise, we'll always run into a timeout!
        const totalTime = Date.now() - request.timestamp + this.#options.retryInterval;
        if (totalTime + 100 > this.#options.sendTimeout) {
          const err = new ResponseError(
            `${response} - aborting sendir retry, send timeout reached (interval: ${this.#options.retryInterval}ms, remaining: ${this.#options.sendTimeout - totalTime}ms)`,
            "BUSY_IR",
            this.#options
          );
          // log.debug("[socket] %s: aborting sendir retry, send timeout reached (interval: %dms, remaining: %dms)", response, this.#options.retryInterval, this.#options.sendTimeout - totalTime);
          request.reject(err);
        } else {
          log.info("%s: retrying %s in %dms", response, request.msgPrefix, this.#options.retryInterval);
          const that = this;
          setTimeout(() => that.#taskFunc(request.message), this.#options.retryInterval);
        }
        return true;
      }
    } else {
      return this.handleNormalResponse(response);
    }

    log.info("Ignoring %s: no pending request found", response);
    return false;
  }

  /**
   * Process a response message.
   *
   * @param {string} response original response message from device
   * @return {boolean} true if the response message could be handled, false if no corresponding request is available.
   */
  handleNormalResponse(response) {
    if (response.startsWith("stopir")) {
      const original = "sendir" + response.substring(6);
      const pendingRequest = this.#filterRequests(original);
      for (const msgItem of pendingRequest) {
        log.debug("Resolved request of %s (%s): %d", response, original, msgItem.id);
        if (msgItem.msgResolve) {
          msgItem.msgResolve(response);
        } else {
          msgItem.resolve(response);
        }
      }
    }

    const request = this.#resolve(response);
    if (!request) {
      log.info("Could not resolve request from:", response);
      return false;
    }

    log.debug("Resolved request %d from: %s", request?.id, response);

    if (request.msgResolve) {
      request.msgResolve(response);
    } else {
      log.warn("Resolved request %d doesn't have a message resolver. Message most likely didn't get sent!", request.id);
      request.resolve(response);
    }

    return true;
  }

  /**
   * Process an error response.
   *
   * @param {string} response original response message from device
   * @param {ResponseError} err resolved ResponseError from the message
   * @return {boolean} true if the error response could be handled, false if no corresponding request is available.
   */
  handleErrorResponse(response, err) {
    const request = this.#resolveError(response, err);
    if (!request) {
      log.info("Could not resolve request from error response:", response);
      return false;
    }

    log.debug("resolved request %d from error response: %s", request?.id, response);
    if (request.msgReject) {
      request.msgReject(response);
    }

    return true;
  }

  /**
   * Resolve a corresponding request of a given response message. The resolved request is removed from the queue.
   *
   * @param {string} response the response message, may not be an error response!
   * @return {MsgItem, undefined}
   */
  #resolve(response) {
    for (let i = 0; i < this.#list.length; i++) {
      if (response.startsWith(this.#list[i].expected)) {
        const request = this.#remove(i);
        this.#removeOlderRequests(request);
        return request;
      }
    }

    // check for special responses, e.g. version information
    if (modelFromVersion(response).length !== 0) {
      for (let i = 0; i < this.#list.length; i++) {
        if (this.#list[i].message.startsWith("getversion")) {
          const request = this.#remove(i);
          this.#removeOlderRequests(request);
          return request;
        }
      }
    }

    return undefined;
  }

  #unprocessedItemCount() {
    let count = 0;
    for (let i = 0; i < this.#list.length; i++) {
      if (!this.#list[i].processed) {
        count++;
      }
    }
    return count;
  }

  /**
   * Return the next unprocessed item in the queue.
   * @return {MsgItem, undefined}
   */
  #nextUnprocessedItem() {
    for (let i = 0; i < this.#list.length; i++) {
      if (!this.#list[i].processed) {
        return this.#list[i];
      }
    }
    return undefined;
  }

  /**
   * Queue cleanup after a successful response. Clean up all older requests of the same request type.
   *
   * @param {string} request
   */
  #removeOlderRequests(request) {
    if (!request || this.#list.length === 0) {
      return;
    }
    const parts = request.message.split(",", 2);
    const prefix = parts.join(",");

    // removing elements in an array only works in descending order
    for (let i = this.#list.length - 1; i >= 0; i--) {
      if (this.#list[i].message.startsWith(prefix) && this.#list[i].timestamp < request.timestamp) {
        const removed = this.#remove(i);
        log.debug("removed old request:", removed?.id);
      }
    }
  }

  /**
   * Resolve the request message from an error response message. The resolved request is removed from the queue.
   *
   * ⚠️ this is a quick and dirty logic only: simply the oldest request is returned!
   * @param {string} response the error response.
   * @param {ResponseError} _err the extracted ResponseError.
   * @return {MsgItem, undefined}
   */
  #resolveError(response, _err) {
    // TODO more sophisticated error resolving is required if connector address is included! (only for iTach)
    return this.#list.shift();
  }

  /**
   * Filter requests which have a given request message prefix. The returned requests are not removed from the queue.
   *
   * @param {string} prefix the request message prefix.
   * @return {Array<MsgItem>}
   */
  #filterRequests(prefix) {
    return this.#list.filter((request) => request.message.startsWith(prefix));
  }

  /**
   * Get corresponding request of a busyIR response. The resolved request is NOT removed from the queue!
   *
   * @param {string} response busyIR response message.
   * @return {Message|undefined}
   */
  getBusyIrRequest(response) {
    // TODO does sendir always return connector address? Different information in iTach (yes) vs Unified TCP API (no) docs!
    const parts = response.split(",");
    // TODO does busyir exist? iTach responds with busyIR, but Unified TCP API specifies busyir!
    if (parts[0] !== "busyIR" && parts[0] !== "busyir") {
      return undefined;
    }

    if (parts.length === 3) {
      // filter out original, active sendir request. Matching request is most likely the next one with the same connector address
      const sameAddress = "sendir," + parts[1];
      const activeRequest = sameAddress + "," + parts[2];
      const requests = this.#filterRequests(sameAddress);
      for (const req of requests) {
        if (!req.message.startsWith(activeRequest)) {
          return new Message(req.message, req.msgPrefix, req.timestamp, req.msgReject ? req.msgReject : req.reject);
        }
      }
    } else {
      // best effort: assume oldest sendir is still active
      const requests = this.#filterRequests("sendir");
      if (requests.length > 1) {
        const req = requests[1];
        return new Message(req.message, req.msgPrefix, req.timestamp, req.msgReject ? req.msgReject : req.reject);
      }
    }

    return undefined;
  }

  /**
   * Remove and return a message item by message identifier.
   *
   * @param {number} id message identifier
   * @return {MsgItem|undefined}
   */
  #removeItemByMsgId(id) {
    for (let i = 0; i < this.#list.length; i++) {
      if (this.#list[i].id === id) {
        return this.#remove(i);
      }
    }
  }

  /**
   * Remove and return a request item at a given index.
   *
   * @param  {number} index position of the item to remove.
   * @return {MsgItem|undefined}
   */
  #remove(index) {
    if (index >= this.#list.length) {
      return undefined;
    }
    log.debug("Removing item index: %d (queue length: %d)", index, this.#list.length);
    if (index === 0) {
      return this.#list.shift();
    } else if (index === this.#list.length - 1) {
      return this.#list.pop();
    } else {
      return this.#list.splice(index, 1).pop();
    }
  }
}

module.exports = { MessageQueue, Message };
