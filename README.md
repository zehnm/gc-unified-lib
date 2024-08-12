# gc-unified-lib

Simple Node.js module to send commands to Global Caché devices supporting the Unified TCP API. Should handle
reconnection (if connection lost), resending (on busyIR), etc., but not abstract away the Unified TCP API.

Note: Only tested with GC-100-12 and IP2IR devices, but it should work with any of the Global Caché product family devices.

## Installation

```shell
npm install https://github.com/zehnm/gc-unified-lib.git
```

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
    - `options.backoff` - backoff options from [MathieuTurcotte/node-backoff](https://github.com/MathieuTurcotte/node-backoff#readme).  
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
      failed. error event will be emitted.
    - `options.reconnectDelay` - (Default: 200) Delay (in milliseconds) for initial reconnection attempt if a connection has been dropped after connection has been established. 
    - `options.retryInterval`- (Default: 99) Time (in milliseconds) between resending attempts (when busyIR is received)
    - `options.sendTimeout` - (Default: 500) Time (in milliseconds) after which a sent command will be assumed lost
    - `options.tcpKeepAlive` - (Default: false) Enable/ disable the native TCP keep-alive functionality
    - `options.tcpKeepAliveInitialDelay` - (Default: 30000) Set the delay in milliseconds between the last data packet received and the first keepalive probe. Setting 0 will leave the value unchanged from the default (or previous) setting.

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

## TODO

- Rename itach module, goal is to support the complete product family.

## Links

- Unified TCP API: <https://www.globalcache.com/files/docs/api-gc-unifiedtcp.pdf>
- iTach API: <http://www.globalcache.com/files/docs/API-iTach.pdf>
