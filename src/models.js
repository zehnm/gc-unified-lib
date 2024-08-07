const net = require("net");
const { checkErrorResponse } = require("./utils");

const ProductFamily = {
  UNKNOWN: "Unknown",
  GC100: "GC-100",
  ITACH: "iTach",
  FLEX: "Flex",
  GLOBAL_CONNECT: "Global Connect"
};

const Models = new Map([
  ["3.0-6", "GC-100-06"],
  ["3.0-12", "GC-100-12"],
  ["3.0-18", "GC-100-18"],
  ["3.1-6", "GC-100-06"],
  ["3.1-12", "GC-100-12"],
  ["3.1-18", "GC-100-18"],
  ["3.2-6", "GC-100-06"],
  ["3.2-12", "GC-100-12"],
  ["3.2-18", "GC-100-18"],

  ["710-1005-", "iTachIP2IR"],
  ["710-1009-", "iTachIP2SL"],
  ["710-1008-", "iTachIP2CC"],
  ["710-1001-", "iTachWF2IR"],
  ["710-1007-", "iTachWF2SL"],
  ["710-1010-", "iTachWF2CC"],

  ["710-2000-", "Flex-WF"],
  ["710-3000-", "Flex-IP"],

  ["710-4001-", "Global Connect IR"],
  ["710-4002-", "Global Connect SL"],
  ["710-4003-", "Global Connect RL"],
  ["710-4004-", "Global Connect SW"]
]);

const PortType = {
  ETHERNET: "ETHERNET",
  WIFI: "WIFI",
  MODULE: "MODULE",
  IR: "IR",
  SERIAL: "SERIAL",
  RELAY: "RELAY",
  SENSOR: "SENSOR",
  RELAYSENSOR: "RELAYSENSOR",
  IR_BLASTER: "IR_BLASTER",
  IRTRIPORT: "IRTRIPORT",
  IRTRIPORT_BLASTER: "IRTRIPORT_BLASTER",
  SWITCH: "SWITCH",
  SENSOR_DIGITAL: "SENSOR_DIGITAL",
  IR_IN: "IR_IN",
  IR_OUT: "IR_OUT",
  SERIAL_RS232: "SERIAL_RS232",
  SERIAL_RS485: "SERIAL_RS485",
  RELAY_SPST_3A: "RELAY_SPST_3A",
  SWITCH_HDMI_3_1: "SWITCH_HDMI_3:1"
};

const IrPortMode = {
  IR: "IR",
  BL2_BLASTER: "BL2_BLASTER",
  IR_NOCARRIER: "IR_NOCARRIER",
  IR_BLASTER: "IR_BLASTER",
  IRTRIPORT: "IRTRIPORT",
  IRTRIPORT_BLASTER: "IRTRIPORT_BLASTER",
  SENSOR: "SENSOR",
  SENSOR_NOTIFY: "SENSOR_NOTIFY",
  SERIAL: "SERIAL",
  RECEIVER: "RECEIVER",
  LED_LIGHTING: "LED_LIGHTING"
};

/**
 * Determine Global Caché product family from version string.
 *
 * @param {string} version Device version.
 * @return {string} Product family name or "Unknown".
 */
function productFamilyFromVersion(version) {
  if (version.startsWith("710-1")) {
    return ProductFamily.ITACH;
  } else if (version.startsWith("710-2") || version.startsWith("710-3")) {
    return ProductFamily.FLEX;
  } else if (version.startsWith("710-4")) {
    return ProductFamily.GLOBAL_CONNECT;
  } else if (version.startsWith("version,")) {
    return ProductFamily.GC100;
  } else {
    return ProductFamily.UNKNOWN;
  }
}

/**
 * Determine device model from version string.
 *
 * @param {string} version Device version.
 * @return {string} Model name or empty string if unknown.
 */
function modelFromVersion(version) {
  let model;
  if (version.startsWith("710-")) {
    model = Models.get(version.substring(0, 9));
  } else if (version.startsWith("version,")) {
    model = Models.get(version.substring(version.lastIndexOf(",") + 1));
  }

  if (model !== undefined) {
    return model;
  }

  return "";
}

class DeviceInfo {
  /**
   * Constructs a new DeviceInfo.
   *
   * @param {string} host
   * @param {number} port
   * @param {string} version
   * @param {Array<IrPort>} irPorts
   */
  constructor(host, port, version, irPorts) {
    this.host = host;
    this.port = port;
    this.productFamily = productFamilyFromVersion(version);
    this.model = modelFromVersion(version);
    // handle GC100 prefix
    if (version.startsWith("version,")) {
      this.version = version.substring(version.lastIndexOf(",") + 1);
    } else {
      this.version = version;
    }
    this.irPorts = irPorts;
  }

  get name() {
    if (this.model.length > 0) {
      return this.model;
    }

    return `${this.productFamily} ${this.version}`;
  }

  get address() {
    return `${this.host}:${this.port}`;
  }
}

class DeviceModule {
  /**
   * Constructs a new device module.
   * If a module has multiple ports, then each port represents a DeviceModule.
   *
   * @param {number} module the module address
   * @param {number } port the module port
   * @param {PortType} portType the port type
   */
  constructor(module, port, portType) {
    this.module = module;
    this.port = port;
    this.portType = portType;
  }
}

class IrPort {
  /**
   * Constructs a new IrPort.
   *
   * @param {number} module module address
   * @param {number} port port/connector address
   * @param {IrPortMode} mode port I/O mode
   */
  constructor(module, port, mode) {
    this.module = module;
    this.port = port;
    this.mode = mode;
  }
}

const DeviceInfoState = {
  VERSION: "version",
  DEVICES: "devices",
  MODULES: "modules"
};

/**
 * Retrieve the device information and module configuration of a Global Caché device.
 *
 * @param {string} host IP address of the device
 * @param {number} port Port number
 * @param {number} connectionTimeout Connection timeout in ms
 * @param {number} readTimeout Read timeout for all requests in ms
 * @return {Promise<DeviceInfo>}
 */
async function retrieveDeviceInfo(host, port = 4998, connectionTimeout = 6000, readTimeout = 3000) {
  return new Promise((resolve, reject) => {
    let state = DeviceInfoState.VERSION;
    let version = "";
    const irPorts = [];
    let devices;
    let response = "";

    const timeoutId = setTimeout(() => {
      setImmediate(() => {
        socket.destroy(new Error("Connection timeout."));
      });
    }, connectionTimeout);

    const socket = net.connect({ host, port });
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      clearTimeout(timeoutId);
      socket.setTimeout(readTimeout);
      console.debug("Sending getversion");
      socket.write("getversion\r");
    });

    socket.on("timeout", () => {
      reject(new Error("Socket read timeout."));
      socket.destroy();
    });

    socket.on("error", (err) => {
      reject(err);
      socket.destroy();
    });

    socket.on("data", (data) => {
      response += data.toString();

      const responseEndIndex = response.lastIndexOf("\r");
      if (responseEndIndex === -1) {
        return; // Message not finished
      }

      if (response.startsWith("device,") && !response.endsWith("endlistdevices\r")) {
        // multiline response with multiple \r!
        return; // Message not finished
      }

      try {
        checkErrorResponse(response, responseEndIndex);
      } catch (e) {
        reject(e);
        socket.destroy();
        return;
      }

      if (state === DeviceInfoState.VERSION) {
        version = response.trim();
        response = "";
        state = DeviceInfoState.DEVICES;
        console.debug("Sending getdevices");
        socket.write("getdevices\r");
        return;
      } else if (state === DeviceInfoState.DEVICES) {
        devices = parseDevices(response);
        response = "";
        state = DeviceInfoState.MODULES;

        devices = filterIrOutputDevices(devices);

        const device = devices.shift();
        if (device !== undefined) {
          const request = `get_IR,${device.module}:${device.port}\r`;
          console.debug("Sending", request);

          socket.write(request);
          return;
        }
      } else if (state === DeviceInfoState.MODULES) {
        const irPort = parseIrPort(response);
        if (irPort !== null) {
          irPorts.push(irPort);
        }

        const device = devices.shift();
        if (device !== undefined) {
          response = "";
          const request = `get_IR,${device.module}:${device.port}\r`;
          console.debug("Sending", request);

          socket.write(request);
          return;
        }
      }

      resolve(new DeviceInfo(host, port, version, irPorts));

      socket.destroy();
    });
  });
}

/**
 * Parse a multiline devices response string from the `getdevices` request.
 *
 * @param {string} response response message
 * @return {Array<DeviceModule>} array of DeviceModule objects
 */
function parseDevices(response) {
  const DEVICE_REGEX = /^(\d+),(\d+) (\w+)$/;

  const deviceLines = response
    .replaceAll("\r", "\n")
    .replaceAll("\nendlistdevices", "")
    .trim()
    .split("\n")
    .map((x) => (x.startsWith("device,") ? x.substring(7) : x));

  const devices = [];
  deviceLines.forEach((device) => {
    const match = DEVICE_REGEX.exec(device);
    if (match === null || match.length !== 4) {
      console.debug("Invalid device format:", device);
      return;
    }

    const module = parseInt(match[1], 10);
    const portCount = parseInt(match[2], 10);
    const portType = match[3];

    if (isNaN(module) || isNaN(portCount)) {
      console.debug("Invalid module (%s) or port count (%s)", match[1], match[2]);
      return;
    }

    if (portCount > 0) {
      for (let port = 1; port <= portCount; port++) {
        devices.push(new DeviceModule(module, port, portType));
      }
    } else {
      devices.push(new DeviceModule(module, portCount, portType));
    }
  });

  return devices;
}

/**
 * Return all IR output devices.
 *
 * @param {Array<DeviceModule>} devices all device capabilities of a physical device.
 * @return {Array<DeviceModule>} filtered list containing only IR output devices.
 */
function filterIrOutputDevices(devices) {
  const irDevices = [];
  devices.forEach((device) => {
    if (
      device.portType === PortType.IR ||
      device.portType === PortType.IR_BLASTER ||
      device.portType === PortType.IRTRIPORT ||
      device.portType === PortType.IRTRIPORT_BLASTER ||
      device.portType === PortType.IR_OUT
    ) {
      irDevices.push(device);
    }
  });

  return irDevices;
}

/**
 * Parse an IR response message from a get_IR request.
 *
 * @param {string} response the IR response message.
 * @return {IrPort|null} parsed IR port or null if parsing failed.
 */
function parseIrPort(response) {
  const IR_REGEX = /^IR,(\d+):(\d+),(\w+)$/;

  const match = IR_REGEX.exec(response.trim());
  if (match === null || match.length !== 4) {
    console.debug("Invalid IR PORT format:", response);
    return null;
  }

  const module = parseInt(match[1], 10);
  const port = parseInt(match[2], 10);
  const mode = match[3];

  if (isNaN(module) || isNaN(port)) {
    console.debug("Invalid module (%s) or port (%s)", match[1], match[2]);
    return null;
  }

  return new IrPort(module, port, mode);
}

module.exports = {
  ProductFamily,
  PortType,
  IrPortMode,
  DeviceInfo,
  IrPort,
  retrieveDeviceInfo,
  productFamilyFromVersion,
  modelFromVersion,
  parseDevices,
  parseIrPort
};
