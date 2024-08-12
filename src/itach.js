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
  #queue;
  #socket = new net.Socket();
  #reconnectingTCP;
  #connectionTimer;
  #reconnectionTimer;
  #currentReconnectInterval = defaultOptions.reconnectInterval;

  constructor(options = undefined) {
    super();
    // overlay custom options
    this.setOptions(options);
    this.#queue = createQueue(
      (message) =>
        new Promise((resolve, reject) => {
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
        }),
      1
    );
    this.#queue.pause();

    this.#socket.setEncoding("utf8");

    const that = this;
    this.#reconnectingTCP = new ReconnectingSocket({
      backoff: {
        initialDelay: this.#options.reconnectInterval,
        maxDelay: this.#options.reconnectIntervalMax
      },
      create() {
        // since the socket is reused, remove all old listeners from last connection attempt
        that.#socket.removeAllListeners("close");
        that.#socket.removeAllListeners("error");
        that.#socket.removeAllListeners("connect");
        // Indicate the socket is exhausted/failed/done.
        that.#socket.once("close", this.close);
        // Capture errors.  The last one will be available in `onfail`
        that.#socket.once("error", this.error);
        // Notify the socket is open/connected/ready for use
        that.#socket.once("connect", this.open);

        // Attention: ReconnectingSocket only acts on the wrapped Socket and doesn't bring its own connection timeout function!
        // EHOSTDOWN or EHOSTUNREACH errors might take 30s or more. This is system dependent.
        if (that.#connectionTimer) {
          clearTimeout(that.#connectionTimer);
        }
        that.#connectionTimer = setTimeout(() => {
          setImmediate(() => {
            console.debug("Connection timeout");
            that.#socket.destroy(
              // TODO custom error / error code Error: read ETIMEDOUT
              new Error(
                `Connection timeout to ${that.#options.host}:${that.#options.port} (${that.#options.connectionTimeout}ms).`
              )
            );
          });
        }, that.#options.connectionTimeout);

        // Node.js bug? keepAlive and keepAliveInitialDelay options should be supported with connect() options in Node.js > v16.50.0,
        // but doesn't work with v22.2.0!
        // However, using setKeepAlive works fine...
        that.#socket.setKeepAlive(that.#options.tcpKeepAlive, that.#options.tcpKeepAliveInitialDelay);
        that.#socket.connect({
          host: that.#options.host,
          port: that.#options.port
        });

        return that.#socket;
      },
      destroy(socket) {
        console.debug("ReconnectingSocket callback: destroy");
        // Clean up and stop a socket when reconnectingTCP.stop() is called
        socket.destroy();
      },
      onopen(socket, firstOpen) {
        console.debug("ReconnectingSocket callback: onopen, first:", firstOpen);
        // remove connection timer
        if (that.#connectionTimer) {
          clearTimeout(that.#connectionTimer);
          that.#connectionTimer = undefined;
        }

        // auto-reconnect if connection drops
        that.#socket.on("error", (error) => {
          that.#queue.pause();
          that.emit("error", error);

          // socket.once("error", (e) => {
          console.error("Connection dropped! Start reconnection in %dms", that.#options.reconnectInterval, error);
          that.#reconnectionTimer = setTimeout(that.connect.bind(that), that.#options.reconnectInterval);
        });

        // ready to send any pending requests
        that.#queue.resume();
        that.emit("connect");
      },
      onclose(socket) {
        console.debug("ReconnectingSocket callback: onclose");
        // Remove event listeners, stop intervals etc.
        if (that.#connectionTimer) {
          clearTimeout(that.#connectionTimer);
          that.#connectionTimer = undefined;
        }
        that.#queue.pause();
        that.emit("close");
      },
      onfail(err) {
        console.error("ReconnectingSocket error", err);
        // Handle the final error that was emitted that caused retry to stop.
        that.#queue.pause();
        that.emit("error", err);
      }
    });

    this.#reconnectingTCP.on("info", (msg) => {
      console.info("Socket:", msg);
    });
    this.#reconnectingTCP.on("state", (state) => {
      console.info("Socket state:", state);
    });
  }

  setOptions(opts) {
    if (opts === undefined) {
      return;
    }
    Object.entries(opts).forEach(([key, value]) => {
      this.#options[key] = value;
    });
    this.#currentReconnectInterval = this.#options.reconnectInterval;
  }

  close(opts) {
    this.setOptions(opts);
    this.#queue.pause();
    this.#queue.clear();

    if (this.#connectionTimer) {
      clearTimeout(this.#connectionTimer);
      this.#connectionTimer = undefined;
    }
    if (this.#reconnectionTimer) {
      clearTimeout(this.#reconnectionTimer);
      this.#reconnectionTimer = undefined;
    }

    this.#reconnectingTCP.stop();

    /*
    // TODO does this make sense to auto-reconnect after a manual close?
    if (this.#options.reconnect) {
      this.#reconnectionTimer = setTimeout(this.connect.bind(this), this.#options.reconnectInterval);
    }
     */
  }

  /**
   * Connects to a device and optionally changes options before connecting.
   *
   * @param {Object} opts An options Object (see setOptions method)
   */
  connect(opts) {
    this.setOptions(opts);
    this.#reconnectingTCP.start();
  }

  send(data) {
    return this.#queue.push(data.endsWith("\r") ? data : data + "\r", this.#options.sendTimeout);
  }
  raw(data) {
    this.#socket.write(data);
  }

  async getDevices() {
    const response = await this.send("getdevices");
    const devices = response
      .replaceAll("\nendlistdevices", "")
      .split("\n")
      .map((x) => (x.startsWith("device,") ? x.substring(7) : x));

    return devices;
  }

  _recalculateReconnectInterval() {
    const interval = Math.round(this.#currentReconnectInterval * this.#options.reconnectBackoffFactor);
    this.#currentReconnectInterval =
      interval > this.#options.reconnectIntervalMax ? this.#options.reconnectIntervalMax : interval;
  }

  get reconnectInterval() {
    return this.#currentReconnectInterval;
  }
}

module.exports = {
  UnifiedClient,
  discover,
  retrieveDeviceInfo,
  ProductFamily,
  productFamilyFromVersion,
  modelFromVersion
};
