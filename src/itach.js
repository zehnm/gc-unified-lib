const net = require("net");
const { EventEmitter } = require("events");
const { discover } = require("./discover");
const { options: defaultOptions } = require("./config");
const { createQueue } = require("./utils");
const {
  ProductFamily,
  productFamilyFromVersion,
  modelFromVersion,
  retrieveDeviceInfo,
  expectedResponse,
  checkErrorResponse,
  ConnectionError,
  GcError,
  ResponseError
} = require("./models");
const ReconnectingSocket = require("reconnecting-socket");

class UnifiedClient extends EventEmitter {
  // copy is required, otherwise different instances share the same object reference!
  // shallow copy is sufficient for the options object
  #options = { ...defaultOptions };
  #queue = createQueue(this.#queueTask.bind(this), 1);
  #socket = new net.Socket();
  #reconnectSocket;
  #connectionTimer;
  #reconnectionTimer;
  #response = "";
  #requestQueue = new RequestQueue();

  constructor(options = undefined) {
    super();
    // overlay custom options
    this.setOptions(options);
    this.#queue.pause();
    this.#socket.setEncoding("utf8");
    this.#socket.on("data", this.#onSocketData.bind(this));
    this.#reconnectSocket = this.#createReconnectingSocket(this.#socket, this.#options, this.#queue);
    this.#reconnectSocket.on("info", (_msg) => {
      // console.debug("[socket]", msg); // TODO use debug module or similar to enable / disable log statements
    });
    this.#reconnectSocket.on("state", (state) => {
      this.emit("state", state);
    });
  }

  setOptions(opts) {
    if (opts === undefined) {
      return;
    }
    Object.entries(opts).forEach(([key, value]) => {
      this.#options[key] = value;
    });
  }

  close(opts) {
    this.setOptions(opts);
    this.#queue.pause();
    this.#queue.clear();
    this.#requestQueue.clear();

    this.#clearConnectionTimer();
    this.#clearReconnectionTimer();

    this.#reconnectSocket.stop();

    // TODO does this make sense to auto-reconnect after a manual close?
    if (this.#options.reconnect) {
      this.#reconnectionTimer = setTimeout(this.connect.bind(this), this.#options.reconnectDelay);
    }
  }

  /**
   * Connects to a device and optionally changes options before connecting.
   *
   * @param {Object} opts An options Object (see setOptions method)
   */
  connect(opts) {
    this.setOptions(opts);
    this.#reconnectSocket.stop();
    this.#reconnectSocket.start();
  }

  send(data) {
    const msg = data.endsWith("\r") ? data : data + "\r";
    if (msg.startsWith("stopir")) {
      return this.#queue.priority(msg, this.#options.sendTimeout, this.#options.queueTimeout);
    } else {
      // TODO dynamic sendTimeout calculation for sendir requests? The IR transmission duration could be calculated...
      //      Or just a different timeout for irsend might be enough to start with!
      return this.#queue.push(msg, this.#options.sendTimeout, this.#options.queueTimeout);
    }
  }

  /**
   * Get the current connection state.
   *
   * @return {string} `stopped`, `opening`, `opened`, `closing`, `closed`, `reopening`, `failed`
   */
  get state() {
    return this.#reconnectSocket.state;
  }

  async getDevices() {
    const response = await this.send("getdevices");
    const devices = response
      .replaceAll("\nendlistdevices", "")
      .split("\n")
      .map((x) => (x.startsWith("device,") ? x.substring(7) : x));

    return devices;
  }

  #onSocketData(data) {
    this.#response += data;
    const responseEndIndex = this.#response.lastIndexOf("\r");
    if (responseEndIndex === -1) {
      return; // Message not finished
    }

    // multiline response with multiple \r!
    if (this.#response.startsWith("device,") && !this.#response.endsWith("endlistdevices\r")) {
      return; // Message not finished
    }

    // message complete: process it
    const response = this.#response.substring(0, responseEndIndex).replaceAll("\r", "\n").trim();
    this.#response = "";
    this.#handleResponse(response);
  }

  #handleResponse(response) {
    console.debug("[socket] response:", response);

    // handle error response
    try {
      checkErrorResponse(response, response.length, this.#options);
    } catch (e) {
      const request = this.#requestQueue.resolveError(response, e);
      if (request) {
        request.reject(e);
      }
      return;
    }

    // handle normal response
    if (response.startsWith("busyIR")) {
      // resend "sendir" command if port is busy
      const request = this.#requestQueue.getBusyIrRequest(response);
      if (request) {
        // only resend if at least 100ms are remaining before the send timeout expires. Otherwise, we'll always run into a timeout!
        const totalTime = Date.now() - request.timestamp + this.#options.retryInterval;
        if (totalTime + 100 > this.#options.sendTimeout) {
          const err = new GcError(
            `${response} - aborting sendir retry, send timeout reached (interval: ${this.#options.retryInterval}ms, remaining: ${this.#options.sendTimeout - totalTime}ms)`,
            "BUSY_IR",
            this.#options.host,
            this.#options.port
          );
          // console.debug("[socket] %s: aborting sendir retry, send timeout reached (interval: %dms, remaining: %dms)", response, this.#options.retryInterval, this.#options.sendTimeout - totalTime);
          request.reject(err);
        } else {
          const sendirReq = request.message.split(",", 3).join(",");
          console.debug("[socket] %s: retrying %s in %dms", response, sendirReq, this.#options.retryInterval);
          const that = this;
          setTimeout(() => that.#socket.write(request.message), this.#options.retryInterval);
        }
        return;
      }
    } else {
      const request = this.#requestQueue.resolve(response);
      if (request) {
        console.debug("[socket] resolved:", request);
        request.resolve(response);
        return;
      }
    }

    console.debug("[socket] %s: ignoring, no pending request found", response);
  }

  #onSocketError(error) {
    this.#queue.pause();

    // auto-reconnect if connection drops
    if (this.#options.reconnect && !["opening", "reopening"].some((state) => this.#reconnectSocket.state === state)) {
      error = new ConnectionError(
        `Connection lost: reconnecting in ${this.#options.reconnectDelay} ms`,
        "ECONNLOST",
        this.#options.host,
        this.#options.port,
        error
      );
      this.#reconnectionTimer = setTimeout(this.connect.bind(this), this.#options.reconnectDelay);
    } else {
      if (!(error instanceof ConnectionError) && error.message && error.code) {
        const cause = error.errno && error.syscall && error.address && error.port ? undefined : error;
        error = new ConnectionError(error.message, error.code, this.#options.host, this.#options.port, cause);
      }
    }

    this.emit("error", error);
  }

  #queueTask(message) {
    return new Promise((resolve, reject) => {
      // create request id for message

      const request = new Request(message, expectedResponse(message), resolve, reject);

      this.#requestQueue.enqueue(request);

      // write request to socket
      this.#socket.write(message);
    });
  }

  #createReconnectingSocket(socket, options, queue) {
    const client = this;
    // we could also extend ReconnectingSocket, but that would expose too many internals. Therefore: wrap it!
    return new ReconnectingSocket({
      backoff: this.#options.backoff,
      create() {
        // since the socket is reused, remove all old listeners from last connection attempt
        socket.removeAllListeners("close");
        socket.removeAllListeners("error");
        socket.removeAllListeners("connect");
        // Indicate the socket is exhausted/failed/done.
        socket.once("close", this.close);
        // Capture errors.  The last one will be available in `onfail`
        socket.once("error", this.error);
        // Notify the socket is open/connected/ready for use
        socket.once("connect", this.open);

        socket.on("error", client.#onSocketError.bind(client));

        // Attention: ReconnectingSocket only acts on the wrapped Socket and doesn't bring its own connection timeout function!
        // EHOSTDOWN or EHOSTUNREACH errors might take 30s or more. This is system dependent.
        client.#clearConnectionTimer();
        client.#connectionTimer = setTimeout(() => {
          setImmediate(() => {
            client.emit("state", "connectionTimeout");
            socket.destroy(
              new ConnectionError(
                `Can't connect after ${options.connectionTimeout} ms.`,
                "ETIMEDOUT",
                options.host,
                options.port
              )
            );
          });
        }, options.connectionTimeout);

        // Node.js bug? keepAlive and keepAliveInitialDelay options should be supported with connect() options in Node.js > v16.50.0,
        // but doesn't work with v22.2.0!
        // However, using setKeepAlive works fine...
        socket.setKeepAlive(options.tcpKeepAlive, options.tcpKeepAliveInitialDelay);
        socket.connect({
          host: options.host,
          port: options.port
        });

        return socket;
      },
      destroy(socket) {
        // Clean up and stop a socket when reconnectingTCP.stop() is called
        socket.destroy();
      },
      onopen(_socket, _firstOpen) {
        // remove connection timer
        client.#clearConnectionTimer();
        // ready to send any pending requests
        queue.resume();
        client.emit("connect");
      },
      onclose(_socket) {
        // Remove event listeners, stop intervals etc.
        client.#clearConnectionTimer();
        queue.pause();
        client.emit("close");
      },
      onfail(err) {
        // Handle the final error that was emitted that caused retry to stop.
        queue.pause();
        client.emit("error", err);
      }
    });
  }

  #clearConnectionTimer() {
    if (this.#connectionTimer) {
      clearTimeout(this.#connectionTimer);
      this.#connectionTimer = undefined;
    }
  }

  #clearReconnectionTimer() {
    if (this.#reconnectionTimer) {
      clearTimeout(this.#reconnectionTimer);
      this.#reconnectionTimer = undefined;
    }
  }
}

/**
 * A {@link RequestQueue} item.
 */
class Request {
  constructor(message, expected, resolve, reject) {
    this.message = message;
    this.expected = expected;
    this.resolve = resolve;
    this.reject = reject;
    this.timestamp = Date.now();
  }
}

/**
 * This queue keeps track of request messages.
 *
 * Requests can be resolved on a received response message. Since not all Global Caché messages include a correlation
 * ID, except for `sendir`, the resolving logic is best effort only. This is especially true for certain device error
 * responses, which don't include any request message information.
 */
class RequestQueue {
  #list;

  constructor() {
    this.#list = [];
  }

  /**
   * Add a new request to the queue.
   * @param {Request} request
   */
  enqueue(request) {
    this.#list.push(request);
  }

  /**
   * Resolve a corresponding request of a given response message. The resolved request is removed from the queue.
   * @param {string} response the response message, may not be an error response!
   * @return {Request, undefined}
   */
  resolve(response) {
    for (let i = 0; i < this.#list.length; i++) {
      if (response.startsWith(this.#list[i].expected)) {
        const request = this.remove(i);
        this.#removeOlderRequests(request);
        return request;
      }
    }

    // check for special responses, e.g. version information
    if (modelFromVersion(response).length !== 0) {
      for (let i = 0; i < this.#list.length; i++) {
        if (this.#list[i].message.startsWith("getversion")) {
          const request = this.remove(i);
          this.#removeOlderRequests(request);
          return request;
        }
      }
    }

    return undefined;
  }

  /**
   * Queue cleanup after a successful response. Clean up all older requests of the same request type.
   * @param request
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
        const removed = this.#list.remove(i);
        console.debug("[queue] removed old request:", removed);
      }
    }
  }

  /**
   * Resolve the request message from an error response message. The resolved request is removed from the queue.
   *
   * ⚠️ this is a quick and dirty logic only: simply the oldest request is returned!
   * @param {string} response the error response.
   * @param {ResponseError} err the extracted ResponseError.
   * @return {Request, undefined}
   */
  resolveError(response, err) {
    // TODO more sophisticated error resolving is required if connector address is included! (only for iTach)
    return this.#list.shift();
  }

  /**
   * Filter requests which have a given request message prefix. The returned requests are not removed from the queue.
   *
   * @param {string} prefix the request message prefix.
   * @return {Array<Request>}
   */
  filterRequests(prefix) {
    return this.#list.filter((request) => request.message.startsWith(prefix));
  }

  /**
   * Get corresponding request of a busyIR response. The resolved request is NOT removed from the queue!
   *
   * @param {string} response busyIR response message.
   * @return {Request|undefined}
   */
  getBusyIrRequest(response) {
    // TODO does sendir always return connector address? Different information in iTach (yes) vs Unified TCP API (no) docs!
    const parts = response.split(",");
    if (parts[0] !== "busyIR") {
      return undefined;
    }

    if (parts.length === 3) {
      // filter out original, active sendir request. Matching request is most likely the next one with the same connector address
      const sameAddress = "sendir," + parts[1];
      const activeRequest = sameAddress + "," + parts[2];
      const requests = this.filterRequests(sameAddress);
      for (const request of requests) {
        if (!request.message.startsWith(activeRequest)) {
          return request;
        }
      }
    } else {
      // best effort: assume oldest sendir is still active
      const requests = this.filterRequests("sendir");
      if (requests.length > 1) {
        return requests[1];
      }
    }

    return undefined;
  }

  /**
   * Remove and return a request item at a given index.
   * @param  {number} index position of the item to remove.
   * @return {Request|undefined}
   */
  remove(index) {
    if (index >= this.#list.length) {
      return undefined;
    } else if (index === 0) {
      return this.#list.shift();
    } else if (index === this.#list.length - 1) {
      return this.#list.pop();
    } else {
      return this.#list.splice(index, 1).pop();
    }
  }

  /**
   * Remove all items.
   */
  clear() {
    this.#list.length = 0;
  }
}

module.exports = {
  UnifiedClient,
  ConnectionError,
  GcError,
  ResponseError,
  discover,
  retrieveDeviceInfo,
  ProductFamily,
  productFamilyFromVersion,
  modelFromVersion
};
