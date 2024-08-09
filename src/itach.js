const net = require("net");
const { EventEmitter } = require("events");
const { discover } = require("./discover");
const { options: defaultOptions } = require("./config");
const { createQueue, checkErrorResponse } = require("./utils");
const { ProductFamily, productFamilyFromVersion, modelFromVersion, retrieveDeviceInfo } = require("./models");

class UnifiedClient extends EventEmitter {
  #options;
  #queue;
  #socket;
  #connectionTimer;
  #reconnectionTimer;
  #connected = false;

  constructor(options = undefined) {
    super();
    // copy is required, otherwise different instances share the same object reference!
    // shallow copy is sufficient for the options object
    this.#options = { ...defaultOptions };
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
    if (this.#socket) {
      this.#socket.destroy();
    }
    this.#connected = false;
    if (this.#connectionTimer) {
      clearTimeout(this.#connectionTimer);
    }
    if (this.#reconnectionTimer) {
      clearTimeout(this.#reconnectionTimer);
    }
    // TODO does this make sense to auto-reconnect after a manual close?
    if (this.#options.reconnect) {
      this.#reconnectionTimer = setTimeout(this.connect.bind(this), this.#options.reconnectInterval);
    }
  }

  /**
   * Connects to a device and optionally changes options before connecting.
   *
   * @param {Object} opts An options Object (see setOptions method)
   * @return {boolean} false if already connected, true if connection has started.
   */
  connect(opts) {
    if (this.#connected || (this.#socket && this.#socket.readyState === "opening")) {
      console.debug("Already connected or connecting, socket state:", this.#socket ? this.#socket.readyState : "none");
      return false;
    }

    this.setOptions(opts);

    console.debug(
      "Connecting %s:%s (connected=%s, readyState=%s)",
      this.#options.host,
      this.#options.port,
      this.#connected,
      this.#socket ? this.#socket.readyState : ""
    );

    if (this.#connectionTimer) {
      clearTimeout(this.#connectionTimer);
    }
    this.#connectionTimer = setTimeout(() => {
      setImmediate(() => {
        console.debug("Connection timeout");
        this.#socket.destroy(
          new Error(
            `Connection timeout to ${this.#options.host}:${this.#options.port} (${this.#options.connectionTimeout}ms).`
          )
        );

        if (this.#reconnectionTimer) {
          console.debug("clearTimeout reconnectTimer");
          clearTimeout(this.#reconnectionTimer);
        }

        if (this.#options.reconnect) {
          console.debug("Start reconnection in", this.#options.reconnectInterval);
          this.#reconnectionTimer = setTimeout(
            this.connect.bind(this),
            this.#options.reconnectInterval // TODO backoff factor
          );
        }
      });
    }, this.#options.connectionTimeout);

    if (this.#socket === undefined) {
      this.#socket = net.connect({
        host: this.#options.host,
        port: this.#options.port
      });
      this.#socket.setEncoding("utf8");
      // TODO further tests with keep-alive, might not work with GC-100
      this.#socket.setKeepAlive(true, 30000);

      this.#socket.on("connect", () => {
        this.#connected = true;
        clearTimeout(this.#connectionTimer);
        // TODO reset connection interval when using backoff factor
        this.#queue.resume();
        this.emit("connect");
      });

      this.#socket.on("close", () => {
        this.#connected = false;
        this.#queue.pause();
        this.emit("close");
      });

      this.#socket.on("error", (error) => {
        this.#queue.pause();
        this.emit("error", error);

        if (this.#options.reconnect) {
          console.debug("Start reconnection in", this.#options.reconnectInterval);
          this.#reconnectionTimer = setTimeout(
            this.connect.bind(this),
            this.#options.reconnectInterval // TODO backoff factor
          );
        }
      });
    } else {
      this.#socket.connect({ host: this.#options.host, port: this.#options.port });
      this.#socket.setKeepAlive(true, 30000);
    }

    return true;
  }

  send(data) {
    return this.#queue.push(data.endsWith("\r") ? data : data + "\r", this.#options.sendTimeout);
  }

  async getDevices() {
    const response = await this.send("getdevices");
    const devices = response
      .replaceAll("\nendlistdevices", "")
      .split("\n")
      .map((x) => (x.startsWith("device,") ? x.substring(7) : x));

    return devices;
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
