const net = require("net");
const { EventEmitter } = require("events");
const { discover } = require("./discover");
const { options: defaultOptions } = require("./config");
const { createQueue, checkErrorResponse } = require("./utils");
const { ProductFamily, productFamilyFromVersion, modelFromVersion, retrieveDeviceInfo } = require("./models");
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

  constructor(options = undefined) {
    super();
    // overlay custom options
    this.setOptions(options);
    this.#queue.pause();
    this.#socket.setEncoding("utf8");
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
    this.#reconnectSocket.start();
  }

  send(data) {
    return this.#queue.push(data.endsWith("\r") ? data : data + "\r", this.#options.sendTimeout);
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
      let response = "";
      this.#socket.removeAllListeners("data");
      this.#socket.on("data", (data) => {
        response += data;
        const responseEndIndex = response.lastIndexOf("\r");
        if (responseEndIndex === -1) {
          return; // Message not finished
        }

        // multiline response with multiple \r!
        if (response.startsWith("device,") && !response.endsWith("endlistdevices\r")) {
          return; // Message not finished
        }

        try {
          checkErrorResponse(response, responseEndIndex);
        } catch (e) {
          reject(e);
          return;
        }

        if (response.startsWith("busyIR")) {
          // TODO retest if still working! https://stackoverflow.com/questions/5911211/settimeout-inside-javascript-class-using-this
          // TODO retest if request timeout is working
          const that = this;
          setTimeout(() => that.#socket.write(message), this.#options.retryInterval);
        } else {
          resolve(response.substring(0, responseEndIndex).replaceAll("\r", "\n").trim());
        }
      });
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

class ConnectionError extends Error {
  constructor(message, code, address, port, cause = undefined) {
    super(message);
    this.code = code;
    this.address = address;
    this.port = port;
    this.cause = cause;
    Error.captureStackTrace(this, ConnectionError);
  }
}

module.exports = {
  UnifiedClient,
  ConnectionError,
  discover,
  retrieveDeviceInfo,
  ProductFamily,
  productFamilyFromVersion,
  modelFromVersion
};
