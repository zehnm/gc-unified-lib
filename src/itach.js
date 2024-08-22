const net = require("net");
const { EventEmitter } = require("events");
const { discover } = require("./discover");
const { options: defaultOptions } = require("./config");
const {
  ProductFamily,
  productFamilyFromVersion,
  modelFromVersion,
  retrieveDeviceInfo,
  ConnectionError,
  GcError,
  ResponseError
} = require("./models");
const ReconnectingSocket = require("reconnecting-socket");
const log = require("./loggers");
const { MessageQueue } = require("./msg_queue");

class UnifiedClient extends EventEmitter {
  // copy is required, otherwise different instances share the same object reference!
  // shallow copy is sufficient for the options object
  #options = { ...defaultOptions };
  #queue;
  #socket = new net.Socket();
  #reconnectSocket;
  #connectionTimer;
  #reconnectionTimer;
  #response = "";

  constructor(options = undefined) {
    super();
    this.#queue = new MessageQueue(this.#write.bind(this));
    // overlay custom options
    this.setOptions(options);
    this.#queue.pause();
    this.#socket.setEncoding("utf8");
    this.#socket.on("data", this.#onSocketData.bind(this));
    this.#reconnectSocket = this.#createReconnectingSocket(this.#socket, this.#options, this.#queue);
    this.#reconnectSocket.on("info", (msg) => {
      log.debugSocket(msg);
    });
    this.#reconnectSocket.on("state", (state) => {
      this.emit("state", state);
    });
  }

  /**
   * Change options.
   * @param {Object<string,*>} [opts]
   */
  setOptions(opts) {
    if (opts === undefined) {
      return;
    }
    Object.entries(opts).forEach(([key, value]) => {
      this.#options[key] = value;
    });
  }

  /**
   * Close device connection and clear any pending messages in the transfer queue.
   *
   * @param {Object<string,*>} [opts] new options, e.g. disabling reconnection.
   */
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
   * @param {Object<string,*>} opts An options Object (see setOptions method)
   */
  connect(opts) {
    this.setOptions(opts);
    this.#reconnectSocket.stop();
    this.#reconnectSocket.start();
  }

  /**
   * Send a new request to the device and wait for a response.
   *
   * The message is put into the transfer queue and sent as soon as the device connection is available and any previous
   * message has been sent. The `stopir` request is handled immediately and put in front of any pending messages.
   *
   * @param {string} data request message to send.
   * @return {Promise<string, Error>} the response message from the device, or an {@link Error} if message communication
   *         failed or an error response was returned. The error object is mostly a {@link GcError} or one of its
   *         subclasses.
   */
  send(data) {
    const msg = data.endsWith("\r") ? data : data + "\r";
    const priority = msg.startsWith("stopir");
    // TODO dynamic sendTimeout calculation for sendir requests? The IR transmission duration could be calculated...
    //      Or just a different timeout for irsend might be enough to start with!
    return this.#queue.push(msg, {
      sendTimeout: this.#options.sendTimeout,
      queueTimeout: this.#options.queueTimeout,
      priority
    });
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

  /**
   * Socket data callback handler.
   *
   * The received data is buffered until a complete message has been received. Messages are terminated by a
   * carriage-return (ASCII value 13). A complete messages is forwarded to #handleResponse for processing.
   * @param data
   */
  #onSocketData(data) {
    log.msgTrace("->", data.trim());
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
    // this.#handleResponse(response);
    this.#queue.handleResponse(response, this.#options);
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

    log.debugSocket(error);

    this.emit("error", error);
  }

  /**
   * Socket write callback for message queue.
   * @param {string} message
   */
  #write(message) {
    log.msgTrace("<-", message.trim());
    this.#socket.write(message);
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
