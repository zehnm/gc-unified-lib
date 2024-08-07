const net = require("net");
const { EventEmitter } = require("events");
const itach = new EventEmitter();
const { options } = require("./config");
const { createQueue, checkErrorResponse } = require("./utils");
let socket, reconnectionTimer;

let connected = false;

const queue = createQueue(
  (message) =>
    new Promise((resolve, reject) => {
      let response = "";
      socket.removeAllListeners("data");
      socket.on("data", (data) => {
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
          setTimeout(() => socket.write(message), options.retryInterval);
        } else {
          resolve(response.substring(0, responseEndIndex));
        }
      });
      socket.write(message);
    }),
  1
);

queue.pause();

itach.setOptions = (opts) => {
  if (opts === undefined) {
    return;
  }
  Object.entries(opts).forEach(([key, value]) => {
    options[key] = value;
  });
};

itach.close = (opts) => {
  itach.setOptions(opts);
  queue.pause();
  socket.destroy();
  connected = false;
  if (options.reconnect) {
    if (reconnectionTimer) {
      clearTimeout(reconnectionTimer);
    }
    reconnectionTimer = setTimeout(itach.connect, options.reconnectInterval);
  }
};

/**
 * Connects to a device and optionally changes options before connecting.
 *
 * @param {Object} opts An options Object (see setOptions method)
 * @return {boolean} false if already connected, true if connection has started.
 */
itach.connect = (opts) => {
  if (connected || (socket && socket.readyState === "opening")) {
    console.debug("Already connected or connecting, socket state:", socket ? socket.readyState : "none");
    return false;
  }

  itach.setOptions(opts);

  const connectionTimeout = setTimeout(() => {
    setImmediate(() => {
      socket.destroy("Connection timeout.");
      if (reconnectionTimer) {
        clearTimeout(reconnectionTimer);
      }
      if (options.reconnect) {
        reconnectionTimer = setTimeout(itach.connect, options.reconnectInterval);
      }
    });
  }, options.connectionTimeout);

  if (socket === undefined) {
    socket = net.connect({ host: options.host, port: options.port });
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      connected = true;
      clearTimeout(connectionTimeout);
      queue.resume();
      itach.emit("connect");
    });

    socket.on("close", () => {
      connected = false;
      queue.pause();
      itach.emit("close");
    });

    socket.on("error", (error) => {
      queue.pause();
      itach.emit("error", new Error(error));
    });
  } else {
    socket.connect({ host: options.host, port: options.port });
  }

  return true;
};

itach.send = (data) => {
  return queue.push(data.endsWith("\r") ? data : data + "\r", options.sendTimeout);
};

module.exports = itach;
