const dgram = require("dgram");
const log = require("./loggers");

/**
 * Split a received discovery beacon from a Global Caché device and return all key / value pairs as a Map.
 *
 * @param {string} beacon received beacon message.
 * @return {Map<string, string> | null} key / value map of the beacon, null if the beacon could not be parsed.
 */
function splitBeacon(beacon) {
  // this regex might be a bit restrictive, but works with GC-100 & iTach devices.
  // Attention: GC-100 doesn't include a leading dash for all key names! (E.g. Config-Name, Config-URL).
  const BEACON_REGEX = /<-?([\w-]+)=([\w-.:/]+)>/g;

  if (!beacon.startsWith("AMXB")) {
    log.warn("Invalid discovery beacon");
    return null;
  }

  const result = new Map();
  let match;

  while ((match = BEACON_REGEX.exec(beacon)) !== null) {
    if (match.length !== 3) {
      log.warn("Invalid beacon format");
      continue;
    }
    result.set(match[1], match[2]);
  }

  return result;
}

// TODO add abort signal to stop discovery
/**
 * Discover Global Caché devices for the specified duration, then return all found devices.
 *
 * @param {number} duration - The duration to run the server in milliseconds.
 * @returns {Promise<Map<string, Map<string, string>>>} - A promise that resolves with a map of found devices.
 */
async function discover(duration = 60000) {
  return new Promise((resolve, reject) => {
    const devices = new Map();

    // Create a new TCP server
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.bind(9131, () => {
      socket.addMembership("239.255.250.250");
    });

    socket.on("error", (err) => {
      reject(err);
      socket.close();
    });

    socket.on("message", (msg, remoteInfo) => {
      const beacon = msg.toString();
      if (beacon) {
        log.msgTrace(`[${remoteInfo.address}:${remoteInfo.port}] ${beacon}`);
        const parsedBeacon = splitBeacon(beacon);
        parsedBeacon.set("address", remoteInfo.address);
        const id = parsedBeacon.get("UUID");
        if (id !== undefined) {
          devices.set(id, parsedBeacon);
        }
      }
    });

    socket.on("listening", () => {
      const serverAddress = socket.address();

      log.info(
        `Starting discovery of Global Caché devices on ${serverAddress.address}:${serverAddress.port} for ${
          duration / 1000
        }s`
      );
    });

    // Set a timeout to close the server after the specified duration
    setTimeout(() => {
      socket.close(() => {
        resolve(devices);
      });
    }, duration);
  });
}

module.exports = {
  splitBeacon,
  discover
};
