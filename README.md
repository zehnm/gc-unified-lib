# gc-unified-lib

Simple Node.js module to send commands to Global Caché devices supporting the Unified TCP API. Should handle
reconnection (if connection lost), resending (on busyIR), etc.. but not abstract away the Unified TCP API.

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

client.connect({host: "itach", reconnect: true});
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
    - `options.reconnectInterval` - (Default: 3000) Time (in milliseconds) between reconnection attempts
    - `options.reconnectIntervalMax` - (Default: 10000) Maximum time (in milliseconds) between reconnection attempts when using a `reconnectBackoffFactor`
    - `options.reconnectBackoffFactor` - (Default: 1.5) Increase `reconnectIntervall` duration by the specified factor until `reconnectIntervalMax` is reached.
    - `options.connectionTimeout` - (Default: 3000) Timeout (in milliseconds) when connection attempt is assumed to be
      failed. error event will be emitted.
    - `options.retryInterval`- (Default: 99) Time (in milliseconds) between resending attempts (when busyIR is received)
    - `options.sendTimeout` - (Default: 500) Time (in milliseconds) after which a sent command will be assumed lost
    - `options.tcpKeepAlive` - (Default: false) Enable/ disable the native TCP keep-alive functionality
    - `options.tcpKeepAliveInitialDelay` - (Default: 30000) Set the delay in milliseconds between the last data packet received and the first keepalive probe. Setting 0 will leave the value unchanged from the default (or previous) setting.

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

- `connect` - Connection to device has been established and commands will now be sent
- `close` - Connection to device has been closed
- `error` - Some error with the socket connection

_Example_

```js
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
