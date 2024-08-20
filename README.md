# gc-unified-lib

Global Caché communication library for devices supporting the Unified TCP API. Handles device discovery, reconnection
(if connection lost), resending (on busyIR), smooth continuous IR repeat mode, and error response handling. 

The library focuses on sending IR without abstracting away the Unified TCP API. Other functionality like relay control
and module configuration is still possible.

Note: Only tested with GC-100-12 and IP2IR devices, but it should work with any of the Global Caché product family devices.

## Installation

Requirements:
- Install [nvm](https://github.com/nvm-sh/nvm) (Node.js version manager) for local development
- Node.js v20.16 or newer (older versions are not tested)

Node module dependencies:
- [debug](https://www.npmjs.com/package/debug) for log output handling.
- [reconnecting-socket](https://www.npmjs.com/package/reconnecting-socket), [node-backoff](https://www.npmjs.com/package/node-backoff)
  for sockets reconnection.

This module is not yet available in the npmjs registry and must be installed from GitHub:

```shell
npm install https://github.com/zehnm/gc-unified-lib.git
```

⚠️ This installs the latest, bleeding edge development version from the GitHub repository. This can either be desired
for development, or have undesired side effects when doing `npm update` (which pulls the latest version from the default
branch).

A specific Git hash can be added to pin the version:

```shell
npm install https://github.com/zehnm/gc-unified-lib.git#$HASH
```
See npm documentation for all options.

## Example

```js
const { UnifiedClient } = require("gc-unified-lib");
const client = new UnifiedClient();

client.on("connect", async () => {
    console.log("Connected to itach");
    try {
        const result = await client.send("sendir:..")
    } catch (error) {
        // Some error happened
    }
});

client.connect({host: "192.168.1.234", reconnect: true});
```

## API

All commands are enqueued and are only sent when a connection to a device is present. The queue is paused if
connection is lost and then resumed when connection is restored.

If iTach is already busy sending IR from another connection it will retry every `options.retryInterval` until
`options.sendTimeout` is reached.

__setOptions(options)__

Changes options

_Arguments_

- `options` - (Mandatory) An options Object
    - `options.host` - (Default: null) Hostname/IP to connect to
    - `options.port` - (Default: 4998) Port to connect to
    - `options.reconnect` - (Default: false) Try to reconnect if connection is lost
    - `options.reconnectDelay` - (Default: 200) Delay (in milliseconds) for initial reconnection attempt if a connection
      has been dropped after connection has been established.
    - `options.backoff` - reconnection backoff options from [MathieuTurcotte/node-backoff](https://github.com/MathieuTurcotte/node-backoff#readme).  
       Default:
      ```js
      {
        strategy: "fibonacci",
        randomisationFactor: 0,
        initialDelay: 500,
        maxDelay: 10000,
        failAfter: null
      }
      ```
    - `options.connectionTimeout` - (Default: 3000) Timeout (in milliseconds) when connection attempt is assumed to be
      failed. Error event will be emitted.
    - `options.retryInterval`- (Default: 99) Time (in milliseconds) between resending attempts (when busyIR is received)
    - `options.queueTimeout` - (Default: 200) Maximum time (in milliseconds) a new request may remain in the queue
      before it has to be sent to the device.
    - `options.sendTimeout` - (Default: 500) Time (in milliseconds) after which a sent command will be assumed lost
    - `options.tcpKeepAlive` - (Default: false) Enable/ disable the native TCP keep-alive functionality
    - `options.tcpKeepAliveInitialDelay` - (Default: 30000) Set the delay in milliseconds between the last data packet
      received and the first keepalive probe. Setting 0 will leave the value unchanged from the default (or previous) setting.

⚠️ `options.backoff` can only be set in the `UnifiedClient()` constructor and has no effect in the `setOptions`,
   `connect()` and `close()` calls! 

_Examples_

```js
client.setOptions({host: "itachIP2IR", reconnect: true});
```

---------------------------------------

__connect(options)__

Connects to a device and optionally changes options before connecting.

_Arguments_

- `options` - An options Object (see setOptions method)

_Examples_

```js
client.connect();
```

```js
client.connect({host: "itachIP2IR", reconnect: true});
```

---------------------------------------

__close(options)__

Closes the connection to the device. Note: If reconnect is enabled the connection will not stay closed. If you
want that you have to pass in `{ reconnect: false }`.
Also note: You can change any options.

_Example_

```js
client.close();
```

```js
client.close({reconnect: false});
```

---------------------------------------

__send(data)__

Sends a Unified API command to be executed.

_Arguments_

- `data` - (Mandatory) String containing a Unified API command (carriage return not required)

_Returns_

A promise that will resolve to the result of the sent command.

_Example_

```js
try {
    const result = await client.send('sendir,1:1,1,38400,1,1,347,173,22,22,22,65,22,22,22,22,22,65,22,22,22,22,22,22,22,22,22,22,22,65,22,22,22,65,22,65,22,22,22,22,22,22,22,22,22,65,22,22,22,22,22,22,22,22,22,22,22,65,22,65,22,22,22,65,22,65,22,65,22,65,22,65,22,1657')
    console.log(result) // completeir...
} catch (error) {
    // handle error
}
```

---------------------------------------

__Events__

- `state` - Connection state events: `stopped`, `opening`, `opened`, `closing`, `closed`, `reopening`, `failed`, `connectionTimeout`.
- `connect` - Connection to device has been established and commands will now be sent
- `close` - Connection to device has been closed
- `error` - Some error with the socket connection

_Example_

```js
client.on("state", function (state) {
  log.debug("Connection state change:", state);
});

client.on("connect", function () {
    // Connection established
});

client.on("close", function () {
    // Connection closed
});

client.on("error", function (error) {
    // Error occurred
});
```

### Logging

Logging any kind of output is directed to the [debug](https://www.npmjs.com/package/debug) module.
To let the gc-unified-lib output anything, run your app with the `DEBUG` environment variable set like:

```shell
DEBUG=gclib:* node app.js
```

gc-unified-lib exposes the following log-levels:

- `gclib:msg`: TCP socket message trace
- `gclib:debug`: debugging messages
- `gclib:debug:socket`: socket related debugging messages 
- `gclib:info`: informational messages
- `gclib:warn`: warnings
- `gclib:error`: errors

If you only want to get errors and warnings reported:

```shell
DEBUG=gclib:warn,gclib:error node app.js
```

Combine those settings with your existing application if any of your other modules or libs also uses __debug__

## TODO

- Rename itach module, goal is to support the complete product family.
- IR learning support, emit events for every received sendir message.

## Links

- Unified TCP API: <https://www.globalcache.com/files/docs/api-gc-unifiedtcp.pdf>
- iTach API: <http://www.globalcache.com/files/docs/API-iTach.pdf>
