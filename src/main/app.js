/* 
NodeForwarder: an USB-to-HTTP proxy, adapted from the original serial-to-HTTP proxy code.
Replaces the serialport-based logic with direct USB communication.

Requirements:
   -- usb -> npm install usb
   -- express -> npm install express
   -- socket.io -> npm install socket.io
   -- cors -> npm install cors
   -- better-sqlite3 -> npm install better-sqlite3
   -- body-parser -> npm install body-parser

To start: node nodeforwader.js [HTTP PORT]

HTTP endpoints (sample):
  - http://[yourip]:[port]/read   -> returns the accumulated buffer
  - http://[yourip]:[port]/write/[STRING] -> writes a string to the USB device
  - http://[yourip]:[port]/connect -> triggers a device connect handshake
  - http://[yourip]:[port]/disconnect -> attempts to close the USB device
  - etc.
*/

const parts = process.argv;
if (parts.length < 3) {
  console.log(
    "usage: node nodeforwader.js [HTTP PORT]"
  );
  process.exit(1);
}

const hp = parseInt(parts[2]) || 3000; // default 3000
const registers = require('./constants');

// ------------------------------------------------------------------------
//  1) Bring in the required modules
// ------------------------------------------------------------------------
const bodyParser = require('body-parser');
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { createServer } = require('http');
const socketIo = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const usb = require('usb');
const handler = require('../../static/handler.js');
const { version } = require('../../package.json');

// ------------------------------------------------------------------------
//  2) Basic Express + Socket.IO server setup
// ------------------------------------------------------------------------
const app = express();
const server = createServer(app);
const io = socketIo(server, { cors: { methods: ["GET", "POST"] } });


// Imports USB helper functions
const {
  initUsbDevice,
  ctrlIn,
  ctrlOut,
  directOrderCommand,
  softwareTrigger,
  setGain,
  setDelay,
  setRange,
  setStandardConfig,
  setAnalogInput_PE,
  setAnalogInput_TT,
  setPulseLength,
} = require('./usbController'); // path to your helper file

const {
  readAllParameters,
  bytes2bits,
  bytes2dec,
  float32ToFloat16Bits,
  float32ArrayToFloat16Buffer,
} = require('../utils/helperFunctions');

const { disconnect, allowedNodeEnvironmentFlags } = require('process');

server.listen(hp, () => {
  console.log(`HTTP server running on port ${hp}`);
});

// Make sure ./files directory exists
const dirPath = path.join(__dirname, 'files');
if (!fs.existsSync(dirPath)) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// Enable CORS and static serving
app.use(cors());
app.use('/static', express.static('static'));

// Body parsers
app.use(bodyParser.urlencoded({ extended: true })); // Post forms
app.use(bodyParser.json());                         // JSON forms (e.g. axios)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------------------------------------------------------------
//  3) Global variables
// ------------------------------------------------------------------------
let lastDataSent = {};

const sampling_rate = 100e6;
const cooloff = 100;
let lastupdate = Date.now();
const timeoutDelay = 50;
const dbCooloff = 5000; // By default, save data in the db every 5 seconds
let lastDbUpdate = Date.now();
const systemstate = {};
const observedState = new Proxy(systemstate, handler);

observedState.onChange = (change) => {
  // When observedState is changed, verify everything is in order, and broadcast the final, correct state.
  console.log('Change detected in observedState:', change);
  if (change.property === 'usbConnected') {
    if (change.newValue === true && observedState.usbConnected === false) {
      connectToUsbDevice();
    } else if (change.newValue === false && observedState.usbConnected === true) {
      disconnectUsbDevice();
    }
  };

  // If expName is modified but experiment is already running, return expName to its old value.
  if (change.property === 'expName' && observedState['expStatus'] == true) {
    observedState.expName = change.oldValue;
  };

  if (observedState['expName'] == undefined) observedState['fn'] = '';
  if (observedState['expStatus'] == true && observedState['fn'] == "") { observedState['expStatus'] = false };
  console.log('Broadcasting updated systemstate, depth = ', observedState.depth);
  io.emit('systemstate', observedState);
};

function updateObservedState(msg) {
  console.log('Updating observedState with ', msg);
  for (const key in msg) {
    if (msg.hasOwnProperty(key)) {
      console.log('Updating observedState with ', key, msg[key]);
      observedState[key] = msg[key];
    }
  }
  observedState.usbBusy = false;
}

async function updateInputs(msg) {
  if (observedState.usbBusy) {
    console.log('USB is busy, waiting for it to finish...');
    return setImmediate(() => updateInputs(msg));
  }
  observedState.usbBusy = true;
  console.log('Received input from socket ', msg);
  if (msg.gain) {  // Check if the gain key is present
    if (msg.gain !== observedState.gain) {
      try {
        await setGain(msg.gain);  // Wait for setGain to finish
        observedState.gain = msg.gain;
        console.log("Gain set successfully to", observedState.gain);
        // You can continue processing after the gain is set
      } catch (err) {
        console.error("Error setting gain:", err);
        // Optionally, handle the error (e.g., notify the user)
      }
    }
  }

  if (msg.delay !== undefined) {  // Check if the gain key is present
    if (msg.delay !== observedState.delay) {
      try {
        await setDelay(msg.delay);  // Wait for setGain to finish
        observedState.delay = msg.delay;
        console.log("Delay set successfully to", observedState.delay);
        // You can continue processing after the gain is set
      } catch (err) {
        console.error("Error setting delay:", err);
        // Optionally, handle the error (e.g., notify the user)
      }
    }
  }

  if (msg.range !== undefined) {  // Check if the gain key is present
    if (msg.range !== observedState.range) {
      try {
        await setRange(msg.range);  // Wait for setGain to finish
        observedState.range = msg.range;
        setDepth();
        console.log("Range set successfully to", observedState.range, ' depth is ', observedState.depth);
        // You can continue processing after the gain is set
      } catch (err) {
        console.error("Error setting range:", err);
        // Optionally, handle the error (e.g., notify the user)
      }
    }
  }
  observedState.usbBusy = false;
  // console.log('Emitting systemstate, depth = ', observedState.depth);
  // io.emit('systemstate', observedState);
}

io.on('connection', (socket) => {
  now = Date.now();
  // On first connect, give them the current buffer
  console.log('New client connected.')
  socket.emit('waveform', lastDataSent);
  // Also the current state
  socket.emit('systemstate', observedState);

  socket.on('systemstate', (msg) => {
    // Throttle updates
    console.log('Received systemstate from socket');
    if (Date.now() - cooloff > lastupdate) {
      updateObservedState(msg);
      lastupdate = Date.now();
    }
  });

  socket.on('input', msgRaw => {
    console.log('Received input from socket');
    if (Date.now() - cooloff > lastupdate) {
      const msg = JSON.parse(msgRaw);
      updateInputs(msg);
      lastupdate = Date.now()
    }
  })

  socket.on('transfercommand', (command) => {
    console.log('Received transfer command from socket');
    if (Date.now() - cooloff > lastupdate) {
      parseTransferCommand(command);
      lastupdate = Date.now();
    }
  });
});


async function parseTransferCommand(command) {
  const { command_type, registerAddr, data, length, direction, order, value, index, lengthOrData } = command;

  switch (command_type) {
    case 'ctrl_out':
      console.log("Received ctrl_out command from socket...:", command);
      if (registerAddr === undefined || !Array.isArray(data)) {
        return io.emit('response', "Missing or invalid fields: 'registerAddr', 'data'");
      }

      const bufferData = Buffer.from(data);
      if (registerAddr === DEPTH_REG) {
        // Update to take into account any modifications to range, delay, gain.
        observedState.depth = data;
        console.log('Depth modified to ', observedState.depth);
      }

      try {
        await ctrlOut(registerAddr, bufferData)
        console.log('ctrl_out successful')
        io.emit('response', { message: "ctrl_out successful" });
      } catch (err) {
        console.error("ctrlOut error:", err);
        io.emit('response', "Error writing via control transfer");
      }
      break;

    case 'ctrl_in':
      console.log("Received ctrl_in from socket:", command);
      if (registerAddr === undefined || !Number.isInteger(length)) {
        return io.emit('response', "Missing or invalid fields: 'registerAddr', 'length'");
      }
      try {
        const data = await ctrlIn(registerAddr, length);
        console.log('ctrl_in successful')
        const resultArray = Array.from(data);
        io.emit('response', { message: "ctrl_in successful", data: resultArray });
      } catch (err) {
        console.error("ctrlIn error:", err);
        io.emit('response', "Error reading via control transfer");
      }
      break;

    case 'direct_order_command':
      console.log("Socket direct_order_command to USB:", command);
      if (!direction || order === undefined || value === undefined || index === undefined || lengthOrData === undefined) {
        return io.emit('response', "Missing one or more fields in body.");
      }
      try {
        const data = await directOrderCommand(direction, order, value, index, lengthOrData);
        if (direction.toLowerCase() === "in") {
          const resultArray = Array.from(data);
          console.log('direct_order_command IN OK', resultArray)
          io.emit('response', { message: "direct_order_command IN OK", data: resultArray });
        } else {
          io.emit('response', { message: "direct_order_command OUT OK" });
        }
      } catch (err) {
        console.error(err);
        io.emit('response', "direct_order_command error");
      }
      break;

    default:
      io.emit('response', "Invalid command_type");
  }
};

// ------------------------------------------------------------------------
//  4) USB device logic (from usbcontroller.js style)
// ------------------------------------------------------------------------

// Adjust these to your device's vendor/product IDs.
const VENDOR_ID = 0x0547;   // Example: Optel Opbox Vendor ID
const PRODUCT_ID = 0x1003;  // Example: Opbox Product ID
let inEndpoint;
let usbDevice;
let iface;

async function connectToUsbDevice() {
  try {
    usbDevice = usb.findByIds(VENDOR_ID, PRODUCT_ID);
    if (!usbDevice) {
      console.error("USB device not found");
      observedState.usbConnected = false;
      return;
    }
    console.log("USB Device found. Connecting...");

    usbDevice.open();

    // You might need to set the config index to 1 (some devices have multiple configurations)
    await new Promise((resolve, reject) => {
      usbDevice.setConfiguration(1, (error) => {
        if (error) {
          console.error("Failed to set configuration:", error);
          observedState.usbConnected = false;
          return reject(error);
        }
        console.log("USB configuration set");
        return resolve()
      })
    });
  } catch (error) {
    console.error("USB connection error:", error);
    observedState.usbConnected = false;
  }
  const iface = usbDevice.interface(0);
  if (!iface) {
    throw new Error('Interface not found');
  }
  iface.claim();
  inEndpoint = iface.endpoints.find(ep =>
    ep.descriptor.bEndpointAddress === registers.USB_IN_ENDPOINT);
  if (!inEndpoint) {
    throw new Error(`IN endpoint with address ${IN_ENDPOINT_ADDRESS} not found`);
  }

  console.log('Connected to USB device. Now setting standard configuration.')
  // Now pass the device into our helper module
  initUsbDevice(usbDevice);
  // Set OpBox Standard Configuration: resets device, powers it on, and sets standard parameters
  try {
    const expParams = await setStandardConfig();
    updateObservedState(expParams);
    setDepth();
    console.log('USB Device powered on and configured.')
    observedState.usbConnected = true;
    setImmediate(pollUsbData);
  } catch (err) {
    console.error("Error setting standard configuration:", err);
    observedState.usbConnected = false;
    disconnectUsbDevice();
  }
  console.log('observedState: ', observedState)
}

function disconnectUsbDevice() {
  if (!usbDevice) {
    console.log("No USB device to disconnect");
    observedState.usbConnected === false;
    return;
  }
  try {
    if (iface) {
      try {
        iface.release(true, () => {
          console.log("Interface released");
        });
      } catch (releaseErr) {
        console.error("Error releasing interface:", releaseErr);
      }
    }
    usbDevice.close();
    console.log("USB device closed.");
    observedState.usbConnected = false;
    usbDevice = null;
    iface = null;
  } catch (error) {
    console.error("Error disconnecting USB device:", error);
  }
}

function setDepth() {
  const depth = Math.trunc(observedState.range * sampling_rate / 1e6);
  observedState.depth = depth;
  console.log('Depth is ', observedState.depth);
  return depth;
}

function parseData(data) {
  const n_samples = Math.floor(data.length / (observedState.depth + 54))
  //console.log(`Parsing data with `, data.length, ` samples and ${n_samples} acquisitions to average.`)
  //console.log('observedState.depth is ', observedState.depth);
  if (n_samples !== observedState.sample_averaging) {
    console.error(`Sample averaging or depth mismatch. Expected ${observedState.sample_averaging} acquisitions of ${observedState.depth} samples, but got array of length ${data.length}.`)
    return [0, 0, 0];
  }
  const allSamples = Array.from({ length: n_samples }, () => new Uint8Array(observedState.depth));
  const measSize = observedState.depth + 54;

  let header = null;

  for (let i = 0; i < n_samples; i++) {
    const start = i * measSize;
    const end = (i + 1) * measSize;
    const measData = data.slice(start, end);
    const headerBytes = measData.slice(0, 54);
    const sampleBytes = measData.slice(54);
    if (i === 0) {
      header = headerBytes;
    }
    const samples = new Uint8Array(sampleBytes);
    allSamples[i] = samples;
    if (i === n_samples) {
      if ((i + 1) * measSize !== data.length) {
        throw new Error("Data length mismatch");
      }
    }
  }

  const averagedData = new Float32Array(observedState.depth);
  //const averagedData = new Array(observedState.depth);
  for (let i = 0; i < observedState.depth; i++) {
    let sum = 0;
    for (let j = 0; j < n_samples; j++) {
      sum += allSamples[j][i];
    }
    // Average the sample point-wise
    averagedData[i] = sum / n_samples;
    // Rescale between -1 and 1, with 128 => 0
    averagedData[i] = (averagedData[i] - 128) / 127;
  }
  //console.log(averagedData.slice(0, 100));
  return [header, averagedData, allSamples];
}

function parseHeader(headerBytes) {
  if (headerBytes.length !== 54) {
    throw new Error(`Header length is incorrect. Expected 54 bytes, got ${headerBytes.length} bytes.`);
  }

  const header = {};
  const data = headerBytes;

  header['Start of Frame'] = String.fromCharCode(data[0]);  // Byte 1
  header['FrameIdx'] = data.readUInt16LE(1);  // Bytes 2-3
  header['TimeStamp'] = data.readUInt16LE(4);  // Bytes 4-5
  header['TriggerOverrun'] = data.readUInt16LE(6);  // Bytes 6-7
  header['TriggerOverrunSource'] = data[8];  // Byte 8
  header['GPI Captured'] = data[9];  // Byte 9
  header['Encoder 1 Position'] = data.readUInt32LE(10);  // Bytes 10-13
  header['Encoder 2 Position'] = data.readUInt32LE(14);  // Bytes 14-17
  header['Peak Detectors Status'] = data[18];  // Byte 18

  // For 3-byte fields, manually construct a 4-byte integer using bitwise operations
  // header['PDA RefPos'] = data[20] | (data[21] << 8) | (data[22] << 16);  // Bytes 20-22
  // header['PDA MaxVal'] = data[24];  // Byte 24
  // header['PDA MaxPos'] = data[26] | (data[27] << 8) | (data[28] << 16);  // Bytes 26-28
  // header['PDB RefPos'] = data[30] | (data[31] << 8) | (data[32] << 16);  // Bytes 30-32
  // header['PDB MaxVal'] = data[34];  // Byte 34
  // header['PDB MaxPos'] = data[36] | (data[37] << 8) | (data[38] << 16);  // Bytes 36-38
  // header['PDC RefPos'] = data[40] | (data[41] << 8) | (data[42] << 16);  // Bytes 40-42
  // header['PDC MaxVal'] = data[44];  // Byte 44
  // header['PDC MaxPos'] = data[46] | (data[47] << 8) | (data[48] << 16);  // Bytes 46-48

  // DataCount as a 3-byte field
  header['DataCount'] = data[50] | (data[51] << 8) | (data[52] << 16);  // Bytes 50-52
  header['End of Header'] = String.fromCharCode(data[53]);  // Byte 54

  return header;
}


function calculateMean(array) {
  const sum = array.reduce((acc, val) => acc + val, 0);
  return sum / array.length;
}

function calculateStdDev(array) {
  const mean = calculateMean(array);
  const variance = array.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / array.length;
  return Math.sqrt(variance);
}

async function processData() {
  const data = await readBulkData();

  if (!data) {
    console.log("No data returned from USB.")
    return;
  }

  const [headerRaw, averagedData, allSamples] = parseData(data);
  header = parseHeader(headerRaw);
  metadata = { 'gain': observedState.gain, 'delay': observedState.delay, 'range': observedState.range, 'depth': observedState.depth, 'sample_averaging': observedState.sample_averaging, 'trigger_voltage': observedState.voltage };
  const t_dic0 = Date.now()
  const dic = await readAllParameters();
  //console.log(`Reading all registers took ${Date.now() - t_dic0}ms`)
  lastDataSent = { data: Array.from(averagedData), header: header, metadata: metadata, registers: dic }
  // Broadcasts the parsed header and data
  // console.log('Sending updated waveform.... Last sent ', Date.now() - lastsent, 'ms ago');
  lastsent = Date.now();

  io.emit('waveform', { data: Array.from(averagedData), header: header, metadata: metadata });

  if (observedState.expRunning === true && Date.now() - lastDbUpdate > dbCooloff) {
    console.log('Saving to db.... Last update ', Date.now() - lastDbUpdate, 'ms ago');
    dataBuffer = float32ArrayToFloat16Buffer(averagedData);
    lastDbUpdate = Date.now();
    const dbName = observedState.expName;
    const payload = {
      version: version,        // Web app version from package.json
      time: Date.now() / 1000, // Current UNIX time in seconds
      amps: dataBuffer,
      metadata: JSON.stringify(metadata),
    }
    saveToDatabase(dbName, payload);
  }
}

let lastsent = Date.now();
function readBulkData() {
  // Logs the start of the data reading process
  const buffer_size = (54 + observedState.depth) * observedState.sample_averaging
  // Returns a Promise to handle the asynchronous USB transfer
  return new Promise((resolve, reject) => {
    inEndpoint.transfer(buffer_size, (error, data) => {
      if (error) {
        if (error.message.includes('LIBUSB_TRANSFER_CANCELLED')) {
          // Logs and handles transfer cancellation due to device disconnect
          console.log('LIBUSB_TRANSFER_CANCELLED ', error);
        } else {
          // Logs and handles other transfer errors
          console.error("Failed to read data from USB device:", error);
        }
        // Rejects the Promise with the error
        return reject(error);
      }
      if (data && data.length > 0) {
        //console.debug('Read data from USB device successfully.');
        resolve(data);
      } else {
        console.debug('No data to process...');
        resolve(null)
      }
    });
  });
}

let last_polled = Date.now();
function pollUsbData() {
  // If USB is disconnected, then stop polling.
  if (!observedState.usbConnected) {
    return;
  }
  // If USB device is busy, then wait and try again.
  if (observedState.usbBusy) {
    return setImmediate(pollUsbData);
  }
  observedState.usbBusy = true;
  last_polled = Date.now()
  directOrderCommand('in', DIRECT_FRAME_READY_ORDER, 0, 0, 1, async (err, readyData) => {
    if (err) {
      console.error("Error checking PACKET_READY_FLAG:", err);
      // Schedule next poll attempt
      observedState.usbBusy = false;
      setImmediate(pollUsbData);
      return;
    }
    // If readyData[0] is 1, the device has data for us
    if (readyData && readyData[0] === 1) {
      // PACKET_READY_FLAG is True, data ready to be read.
      //console.log('PACKET_READY_FLAG is 1, reading data....')
      // const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      // await delay(1000);
      try {
        await processData();
      } catch (err) {
        console.error("Error reading bulk data:", err);
      }
    }
    else if (readyData && readyData[0] === 0) {
      await softwareTrigger();
    }
    observedState.usbBusy = false;
    setImmediate(pollUsbData);
  });
}


// ------------------------------------------------------------------------
//  5) Express routes
// ------------------------------------------------------------------------

// Serve the smush interface (or any other UI)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'index2.html'));
});

app.get('/get_waveform', (req, res) => {
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  res.json(lastDataSent);
});

// ---------------------------------------------------------------------
// POST /ctrl_out
// ---------------------------------------------------------------------
app.post('/ctrl_out', (req, res) => {
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  const { registerAddr, data } = req.body;
  console.log("POST ctrl_out to USB:", req.body)
  if (registerAddr === undefined || !Array.isArray(data)) {
    return res.status(400).send("Missing or invalid fields: 'registerAddr', 'data'");
  }

  // Convert data (array of numbers) to a Buffer
  const bufferData = Buffer.from(data);
  if (registerAddr === DEPTH_REG) {
    observedState.depth = data;
    console.log('Depth modified to ', observedState.depth);
  }

  ctrlOut(registerAddr, bufferData, (err) => {
    if (err) {
      console.error("ctrlOut error:", err);
      return res.status(500).send("Error writing via control transfer");
    }
    res.json({ message: "ctrl_out successful" });
  });
});

// ---------------------------------------------------------------------
// POST /ctrl_in
// ---------------------------------------------------------------------
app.post('/ctrl_in', (req, res) => {
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  const { registerAddr, length } = req.body;
  console.log("POST ctrl_in to USB:", req.body)
  if (registerAddr === undefined || !Number.isInteger(length)) {
    return res.status(400).send("Missing or invalid fields: 'registerAddr', 'length'");
  }

  ctrlIn(registerAddr, length, (err, data) => {
    if (err) {
      console.error("ctrlIn error:", err);
      return res.status(500).send("Error reading via control transfer");
    }
    // 'data' should be a Buffer
    // Convert to hex string or array of bytes for response
    const resultArray = Array.from(data);
    res.json({ message: "ctrl_in successful", data: resultArray });
  });
});

// 3) POST /direct_order_command
app.post('/direct_order_command', (req, res) => {
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  const {
    direction,
    order,
    value,
    index,
    lengthOrData
  } = req.body;

  if (!direction || order === undefined || value === undefined || index === undefined || lengthOrData === undefined) {
    return res.status(400).json({ error: "Missing one or more fields in body." });
  }

  directOrderCommand(
    direction,
    order,
    value,
    index,
    lengthOrData,
    (err, data) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "direct_order_command error" });
      }
      // If direction = 'in', data might be a Buffer
      if (direction.toLowerCase() === "in") {
        const resultArray = Array.from(data);
        return res.json({ message: "direct_order_command IN OK", data: resultArray });
      } else {
        return res.json({ message: "direct_order_command OUT OK" });
      }
    }
  );
});

app.post('/input', async (req, res) => {
  console.log('Received input parameters from POST endpoint.');
  console.log('Input data is ', req.body);
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  try {
    await updateInputs(req.body)
    console.log('Input request successful. observedState gain, delay, range = ', observedState.gain, observedState.delay, observedState.range);
    return res.json({ message: "Parameters set successfully." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error setting parameters with /input endpoint" });
  }
});

app.post('/set_pulse_echo_mode', async (req, res) => {
  console.log('Received pulse-echo mode request');
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  try {
    await setAnalogInput_PE();
    observedState.transmission = false;
    console.log('Pulse-echo mode request successful. observedState.transmission = ', observedState.transmission);
    return res.json({ message: "Pulse-Echo mode set successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error setting pulse-echo mode" });
  }
});

app.post('/set_transmission_mode', async (req, res) => {
  console.log('Received transmission mode request');
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  try {
    await setAnalogInput_TT();
    observedState.transmission = true;
    console.log('Transmission mode request successful. observedState.transmission = ', observedState.transmission);
    return res.json({ message: "Transmission mode set successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error setting transmission mode" });
  }
});

app.post('/set_pulse_time', async (req, res) => {
  console.log('Received pulse_time request', req.body.value);
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  const new_pulse_time = parseFloat(req.body.value)
  try {
    await setPulseLength(new_pulse_time);
    observedState.pulseTime = new_pulse_time;
    console.log('Pulse length request successful. observedState.pulseTime = ', observedState.pulseTime);
    return res.json({ message: `Pulse time set successfully to ${observedState.pulseTime}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error setting transmission mode" });
  }
});

app.get('/registers', async (req, res) => {
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  try {
    const dic = await readAllParameters();
    console.log(dic);
    res.json(dic); // Send JSON response
  } catch (error) {
    console.error(error);
    res.status(500).send('Error retrieving parameters');
  }
});

app.get('/disconnectUSB', async (req, res) => {
  console.log('Attempting to disconnect USB device following GET request.');
  if (!observedState.usbConnected) {
    res.status(400).send("Error: USB device is not connected");
    return;
  }
  try {
    await disconnectUsbDevice();
    dic = { "text": "USB device disconnected following GET request.", "usbConnected": observedState.usbConnected };
    res.json(dic); // Send JSON response
  } catch (error) {
    console.error(error);
    res.status(500).send('Error disconnecting USB device.');
  }
});

app.get('/connectUSB', async (req, res) => {
  console.log('Attempting to connect USB device following GET request.');
  if (observedState.usbConnected) {
    res.send("USB device is already connected.");
    return;
  }
  try {
    await connectToUsbDevice();
    dic = { "text": "USB device connected following GET request.", "usbConnected": observedState.usbConnected };
    res.json(dic); // Send JSON response
  } catch (error) {
    console.error(error);
    res.status(500).send('Error connecting to USB device');
  }
});

// ------------------------------------------------------------------------
//  7) Database logic (unchanged from original, for storing JSON payloads)
// ------------------------------------------------------------------------
function initializeDatabase(dbName) {
  const dbPath = path.resolve('/home/pi/acoustics_data', `${dbName}.db`);
  console.log('dBPath is ', dbPath);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS acoustics (
      version  VARCHAR(10),       -- up to ~10 chars
      time     FLOAT PRIMARY KEY,  -- float in Python => REAL
      amps     BLOB,       -- for binary data
      metadata TEXT        -- store string/JSON
    )
  `);
  console.log('Database initialized at ', dbPath);
  return db;
}

function writeRow(db, row) {
  const insert = db.prepare(`
    INSERT INTO acoustics (version, time, amps, metadata)
    VALUES (@version, @time, @amps, @metadata)
  `);

  insert.run(row);

  const { count } = db.prepare("SELECT count(*) as count FROM acoustics").get();
  return count
}

const dbInstances = {};
function getDatabase(dbName) {
  if (!dbInstances[dbName]) {
    dbInstances[dbName] = initializeDatabase(dbName);
  }
  return dbInstances[dbName];
}

function ensureColumns(db, json) {
  const existingColumns = db
    .prepare(`PRAGMA table_info(data)`)
    .all()
    .map((col) => col.name);

  const newColumns = Object.keys(json).filter((key) => !existingColumns.includes(key));
  newColumns.forEach((key) => {
    const type = getSQLiteType(json[key]);
    db.exec(`ALTER TABLE data ADD COLUMN '${key}' ${type};`);
  });
}

function saveToDatabase(dbName, payload) {
  if (!payload['time']) {
    throw new Error('JSON packet must include a "time" field.');
  }
  const db = getDatabase(dbName);
  writeRow(db, payload);
}

// ------------------------------------------------------------------------
//  8) Optionally auto-connect to the USB device on startup
// ------------------------------------------------------------------------

// Default values for these parameters. To be gotten directly from usb_helpers standard config.
connectToUsbDevice(); // If you want immediate attempt to connect on server start
