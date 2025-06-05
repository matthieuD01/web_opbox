// usb_helpers.js
// Example helper module for USB control transfers & power-on logic

// These constants should match your device’s protocol
const registers = require('./constants.js');
const { Trigger, Measure, AnalogCtrl, PulserTime } = require('./dataclass.js')
const { getDeviceParameters } = require('./opbox_capabilities.js');
// We'll store the device reference here after initialization
let device;

// devParams contains a dictionnary of all range of parameters. 
const devParams = getDeviceParameters(version = 'OpBox 2.1');
// expParams contains the actual, running device settings (gain, range, delay, ...)
const expParams = {};

const triggerReg = new Trigger();
const analogCtrlReg = new AnalogCtrl();
const measureReg = new Measure();
const pulserTimeReg = new PulserTime();

/**
 * initUsbDevice - sets up our local reference to a USB device object
 *
 * @param {Object} usbDevice - the result of usb.findByIds(...), after .open() and .claim()
 */
function initUsbDevice(usbDevice) {
  device = usbDevice;
}

/**
 * ctrlIn - read data from a register or address via control transfer IN
 * 
 * @param {number} registerAddr - which register (wIndex)
 * @param {number} length - how many bytes to read
 * @param {function} callback - callback(error, data)
 */
function ctrlIn(registerAddr, length, callback) {
  if (!device) {
    return callback(new Error(`Error: device not initialized in usb_helpers.js.`));
  }
  device.controlTransfer(
    registers.USB_IN,        // bmRequestType
    registers.READ_REGISTER, // bRequest
    0,             // wValue
    registerAddr,  // wIndex
    length,        // data_or_length
    (err, data) => {
      if (err) {
        console.log('Error reading register:', err);
        return callback(err);
      }
      //console.log('Control IN succesful: ', data);
      callback(null, data);
    });
}

/**
 * ctrlOut - write data to a register or address via control transfer OUT
 * 
 * @param {number} registerAddr - which register (wIndex)
 * @param {Buffer|TypedArray} data - the bytes to send
 * @param {function} callback - callback(error)
 */
function ctrlOut(registerAddr, data, callback) {
  if (!device) {
    return callback(new Error(`Error: device not initialized in usb_helpers.js.`));
  }
  let buffer;
  if (typeof data === 'number') {
    console.log(`Making ${data} a buffer...`);
    buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(data, 0);
  } else if (Buffer.isBuffer(data)) {
    buffer = data;
  } else {
    console.log('Data type: ', typeof data)
    return callback(new Error(`Error: data must be a Buffer or number in usb_helpers.js.`));
  }
  console.log(`ctrl_out: registerAddr: ${registerAddr}, buffer: `, buffer);

  device.controlTransfer(
    registers.USB_OUT,       // bmRequestType
    registers.WRITE_REGISTER,// bRequest
    0,             // wValue
    registerAddr,  // wIndex
    buffer,        // data
    (err, data) => {
      if (err) {
        console.log('Error CtrlOut: ', err);
      }
      //console.log('Control OUT succesful');
      callback(null);
    }
  );
}

/** 
 * directOrderCommand: performs a low-level control transfer
 * direction: 'in' or 'out'
 * order:     the bRequest code
 * value:     the wValue
 * index:     the wIndex
 * lengthOrData: if direction='in', this is the number of bytes to read;
 *               if direction='out', this is a Buffer (or typed array) of bytes to send
 */
function directOrderCommand(direction, order, value, index, lengthOrData, callback) {
  if (!device) {
    return callback(new Error(`Error: device not initialized in usb_helpers.js.`));
  }

  let usbDir;
  if (direction.toLowerCase() === 'in') {
    usbDir = USB_IN;
    if (! typeof lengthOrData === 'number') {
      return callback(new Error(`Error: lengthOrData must be a Number in directOrderCommand in usb_helpers.js`));
    }
  } else if (direction.toLowerCase() === 'out') {
    usbDir = USB_OUT;
    if (!Buffer.isBuffer(lengthOrData)) {
      return callback(new Error(`Error: lengthOrData must be a Buffer in directOrderCommand OUT in usb_helpers.js`));
    }
  } else {
    return callback(new Error(`Error: direction must be "in" or "out" in usb_helpers.js`));
  }
  if (order === 0xD6) {
    console.log('Attempting StartSW()..');
  }
  //console.log('Sending direct order command');
  device.controlTransfer(
    usbDir,
    order,
    value,
    index,
    lengthOrData,
    (err, data) => {
      if (err) {
        console.error('Direct order command failed:', err);
        return callback(err);
      }
      //console.log('Direct order command successful');
      callback(null, data);
    }
  );
}


/**
 * powerOnDevice - example logic that:
 *   1) writes 0x01 to a power register
 *   2) polls until 0x10 bit is set in the register
 * 
 * callback-based approach
 */
async function powerOnDevice() {
  // 1) Write 0x01 to the power control register
  console.log("Powering on device...");
  return new Promise((resolve, reject) => {
    ctrlOut(registers.POWER_CTRL_REG, 1, async (err) => {
      if (err) {
        console.log("Error powering on device:", err);
        return reject(err);
      }
      console.log("Power command sent successfully.");
      // 2) Poll for power bit
      try {
        console.log("Polling for power bit...");
        await pollForPowerOk();
        resolve();
      } catch (err) {
        console.log("Error polling for power bit:", err);
        return reject(err);
      }
    });
  });
}

/** 
 * pollForPowerOk - helper to keep checking the register
 */
function pollForPowerOk() {
  return new Promise((resolve, reject) => {
    function checkPower() {
      ctrlIn(registers.POWER_CTRL_REG, 2, (err, data) => {
        if (err) {
          console.error("Error reading power register: ", err);
          return reject(err);
        }
        // check if data[0] has the 0x10 bit set
        console.log("Power register data: ", data, data[0]);
        if ((data[0] & 0x10) !== 0) {
          console.log("Device powered on!");
          return resolve();
        } else {
          console.log("Power bit OFF, retrying...");
          setTimeout(checkPower, 100);
        }
      });
    }
    checkPower();
  });
}

function softwareTrigger() {
  if (!device) {
    return Promise.reject(
      new Error(`Device not initialized.`)
    );
  }
  return new Promise((resolve, reject) => {
    directOrderCommand('out', registers.DIRECT_SW_TRIG_ORDER, 0, 0, Buffer.alloc(0), (err, readyData) => {
      if (err) {
        console.error("Error with DIRECT_SW_TRIG_ORDER", err);
        return reject(err);
      }
      //console.log('Measurement triggered...')
      return resolve();
    });
  });
}

function resetOpbox() {
  if (!device) {
    return Promise.reject(
      new Error(`USB Device not initialized.`)
    );
  }
  console.log('Resetting Opbox....');
  return new Promise((resolve, reject) => {
    directOrderCommand('out', registers.RESET_ORDER, 0, 0, Buffer.alloc(0), (err, data) => {
      if (err) {
        console.error("Error with RESET_ORDER", err);
        return reject(err);
      } else {
        console.log('Device registers reset. Now resetting buffer...')
      }
      directOrderCommand('out', registers.FIFO_RESET_ORDER, 0, 0, Buffer.alloc(0), (err) => {
        if (err) {
          console.error("Error with FIFO_RESET_ORDER", err);
          return reject(err);
        }
        console.log('Device internal buffer reset.')
        return resolve();
      });
    });
  });
}

function setGain(gain) {
  if (gain > devParams.max_gain) {
    return Promise.reject(
      new Error(`Gain parameter is too high. Maximum accepted gain is ${devParams.max_gain}dB. You tried setting gain at ${gain}`)
    );
  }
  if (gain < devParams.min_gain) {
    return Promise.reject(
      new Error(`Gain parameter is too low. Minimum accepted gain is ${devParams.min_gain}dB. You tried setting gain at ${gain}`)
    );
  }
  CONST_GAIN = Math.trunc(2 * (gain + 32))
  return new Promise((resolve, reject) => {
    // Assuming GAIN_REGISTER is defined (e.g., a constant that tells which register to write to)
    ctrlOut(registers.CONST_GAIN_REG, CONST_GAIN, (err) => {
      if (err) {
        return reject(err);
      }
      expParams.gain = gain
      return resolve();  // Gain was set successfully.
    });
  });
}

function setDelay(delay) {
  const max_delay_cycles = devParams.max_delay;
  const max_delay_us = 1e6 * max_delay_cycles / devParams.sampling_rate;
  const DELAY = Math.trunc(delay * 1e-6 * devParams.sampling_rate);
  if (DELAY > max_delay_cycles) {
    return Promise.reject(
      new Error(`Delay parameter is too high. Maximum accepted delay is ${max_delay_cycles} sampling cycles, or ${max_delay_us}us at the default sampling rate of ${devParams.sampling_rate * 1e-6}MHz. You tried setting delay at ${delay}us = ${DELAY} cycles.`)
    );
  }
  if (DELAY < 0) {
    return Promise.reject(
      new Error(`Delay cannot be negative. Minimum accepted delay is 0. You tried setting delay at ${delay}us.`)
    );
  }
  return new Promise((resolve, reject) => {
    // Assuming GAIN_REGISTER is defined (e.g., a constant that tells which register to write to)
    ctrlOut(registers.DELAY_REG, DELAY, (err) => {
      if (err) {
        return reject(err);
      }
      expParams.delay = delay;
      return resolve();  // Gain was set successfully.
    });
  });
}

function setRange(range) {
  const max_range_cycles = Math.trunc((devParams.buffer_size / expParams.sample_averaging) - devParams.header_size)
  const max_range_us = 1e6 * max_range_cycles / devParams.sampling_rate
  const min_range_us = 1e6 / devParams.sampling_rate
  DEPTH = Math.trunc(range * devParams.sampling_rate / 1e6)
  console.log('DEPTH set to ', DEPTH)
  if (DEPTH > max_range_cycles) {
    return Promise.reject(
      new Error(`Depth is too high. The measurement depth (or range) (number of sample points per measurement) cannot exceed ${max_range_cycles} samples = ${max_range_us} us with the default sampling rate of ${1e-6 * devParams.sampling_rate}MHz and sample averaging over ${expParams.sample_averaging} cycles. You tried setting depth at ${DEPTH} cycles = ${DEPTH * 1e6 / devParams.sampling_rate}us.`)
    );
  }
  if (DEPTH < 1) {
    return Promise.reject(
      new Error(`Depth cannot be below 1. The minimum measurement depth (or range) (number of sample points per measurement) is 1 cycle = ${min_range_us}us with the default sampling rate of ${1e-6 * devParams.sampling_rate}MHz. You tried setting depth at ${DEPTH} cycles = ${DEPTH * 1e6 / devParams.sampling_rate}us.`)
    );
  }

  return new Promise((resolve, reject) => {
    // Assuming GAIN_REGISTER is defined (e.g., a constant that tells which register to write to)
    const d = Buffer.alloc(4);  // Allocate 4 bytes
    d.writeUInt32LE(DEPTH);     // Write DEPTH in little-endian order
    ctrlOut(registers.DEPTH_L_REG, d, (err) => {
      if (err) {
        return reject(err);
      }
      expParams.range = range
      return resolve();  // Gain was set successfully.
    });
  });
}

function setAnalogCtrl() {
  console.log('AnalogCtrlReg is currently: ', analogCtrlReg.value)
  return new Promise((resolve, reject) => {
    ctrlOut(registers.ANALOG_CTRL_REG, analogCtrlReg.value, (err) => {
      if (err) {
        console.log(`Failed to set Analog control register to ${analogCtrlReg.value}`)
        return reject(err);
      }
      console.log(`Analog control register set to ${analogCtrlReg.value}`)
      return resolve();  // Gain was set successfully.
    });
  });
}

function setAnalogFilters(filter) {
  analogCtrlReg.AnalogFilter = filter
  analogCtrlReg.setValue()
  console.log(`Analog filter value set to ${filter}. CtrlReg is now: ${analogCtrlReg.value}`)
  return (setAnalogCtrl())
}

function setAttenHilo(attenHilo = 0) {
  /**
   * This function sets the input Attenuator (-20dB) or PostAmplifier (+24dB)
   * attenHilo = 0 – 0dB – Attenuator and PostAmplifier are turned off
   * attenHilo = 1 – +24dB – PostAmplifier turned on
   * attenHilo = 2 – - 20dB – Attenuator turned on
   */
  if (attenHilo < 0) attenHilo = 0;
  if (attenHilo > 2) attenHilo = 1;

  if (attenHilo === 0) {
    analogCtrlReg.InputAttenuator = 0b0;
    analogCtrlReg.PostAmplifier = 0b0;
    analogCtrlReg.setValue();
  } else if (attenHilo === 1) {
    analogCtrlReg.InputAttenuator = 0b0;
    analogCtrlReg.PostAmplifier = 0b1;
    analogCtrlReg.setValue();
  } else if (attenHilo === 2) {
    analogCtrlReg.InputAttenuator = 0b1;
    analogCtrlReg.PostAmplifier = 0b0;
    analogCtrlReg.setValue();
  }
  return (setAnalogCtrl())
}

function setAnalogInput_TT() {
  analogCtrlReg.AnalogInput = 0b1
  analogCtrlReg.setValue()
  try {
    setAnalogCtrl();
    console.log('Set analog input to transmission mode.')
    expParams.transmission = true;
    return Promise.resolve();
  } catch (err) {
    console.error('Error setting analog input to transmission mode: ', err);
    // If the key exists, then the mode was previously set and it has not changed.
    // If it does not already exist, then the mode was not set, but its default value (after a hard reset) is transmission.
    if (!expParams.hasOwnProperty('transmission')) {
      expParams.transmission = true;
    }
    return Promise.reject(err);
  }
}

function setAnalogInput_PE() {
  analogCtrlReg.AnalogInput = 0b0
  analogCtrlReg.setValue()
  try {
    setAnalogCtrl();
    console.log('Set analog input to pulse-echo mode.')
    expParams.transmission = false;
    return Promise.resolve();
  } catch (err) {
    console.error('Error setting analog input to pulse-echo mode: ', err);
    // If the key exists, then the mode was previously set and it has not changed.
    // If it does not already exist, then the mode was not set, but its default value (after a hard reset) is transmission.
    if (!expParams.hasOwnProperty('transmission')) {
      expParams.transmission = true;
    }
    return Promise.reject(err);
  }
}

function setMeasure() {
  return new Promise((resolve, reject) => {
    ctrlOut(registers.MEASURE_REG, measureReg.value, (err) => {
      if (err) {
        console.log(`Failed to set Measure register to ${measureReg.value}`)
        return reject(err);
      }
      console.log(`Measure register set to ${measureReg.value}`)
      return resolve();  // Gain was set successfully.
    });
  });
}

function setSamplingFreq(samplingFreq) {
  if (samplingFreq < 0) {
    return Promise.reject(
      new Error(`Sampling frequency cannot be negative. You tried setting the sampling frequency at ${samplingFreq} (see OpBox Registers Definitions).`)
    );
  }
  else if (samplingFreq > 15) {
    return Promise.reject(
      new Error(`Sampling frequency is too high. Maximum accepted sampling frequency is 15. You tried setting the sampling frequency at ${samplingFreq} (see OpBox Registers Definitions).`)
    );
  }

  measureReg.SamplingFreq = samplingFreq
  measureReg.setValue()
  return (setMeasure())
}

function setPulserTimeReg() {
  return new Promise((resolve, reject) => {
    ctrlOut(registers.PULSER_TIME_REG, pulserTimeReg.value, (err) => {
      if (err) {
        console.log(`Failed to set PulserTime register to ${pulserTimeReg.value}`)
        return reject(err);
      }
      console.log(`PulserTime register set to ${pulserTimeReg.value}`)
      return resolve();
    });
  });
}

async function setPulseLength(pulseTime) {
  pulserTimeReg.PulseTime = Math.trunc(pulseTime * 10);
  pulserTimeReg.setValue();
  try {
    await setPulserTimeReg();
    console.log('Pulse length set to ', pulseTime)
    expParams.pulseTime = pulseTime  // Pulse time in us
    return Promise.resolve();
  } catch (err) {
    console.error('Error setting pulse length: ', err);
    return Promise.reject(err);
  }
}

function setPacketLength() {
  max_packet_length = devParams.max_packet_length;
  if (expParams.sample_averaging > max_packet_length) {
    return Promise.reject(
      new Error(`The maximum packet length has been exceeded. Max packet length is ${max_packet_length}, and you tried to set it to ${expParams.sample_averaging}. Packet length corresponds to the sample_averaging attribute.'`)
    );
  }
  return new Promise((resolve, reject) => {
    console.log('Setting packet length to ', expParams.sample_averaging)
    ctrlOut(registers.PACKET_LEN_REG, expParams.sample_averaging, (err) => {
      if (err) {
        return reject(err);
      }
      console.log(`Packet length set to ${expParams.sample_averaging}`);
      return resolve();
    });
  });
}

function setSampleAveraging(value = 64) {
  // Calculate max sample averaging possible with current range parameter.
  // Each sample is 1B, and the header is 54B. Buffer size is 262 144B.
  // Max acquisition buffer size is N_max*(54 + N_samples) < 262 144 
  max_sample_averaging = Math.trunc((devParams.buffer_size) / (devParams.header_size + expParams.range * 100));
  if (value > max_sample_averaging) {
    return Promise.reject(
      new Error(`Sample averaging is too high. Maximum accepted sample averaging is ${max_sample_averaging}. You tried setting sample averaging at ${value}. Reduce range or sample averaging.`)
    );
  }
  expParams.sample_averaging = value || 1;
  return (setPacketLength());
}

function setTrigger(enable = 1) {
  triggerReg.TriggerEnable = enable
  triggerReg.setValue()
  return new Promise((resolve, reject) => {
    ctrlOut(registers.TRIGGER_REG, triggerReg.value, (err) => {
      if (err) {
        console.log(`Failed to set Trigger register to ${triggerReg.value}`)
        return reject(err);
      }
      console.log(`Trigger register set to ${triggerReg.value}`)
      return resolve();
    });
  });
}

async function setStandardConfig() {
  console.log('Setting standard configuration in usb_helpers.js...')
  try {
    const range = 20;
    const gain = 20;
    const delay = 0;
    const sample_averaging = 64;
    console.log('resetOpbox()');
    await resetOpbox();
    console.log('powerOnDevice()');
    await powerOnDevice();

    console.log('setSampleAveraging(1)');
    await setSampleAveraging(sample_averaging);
    console.log('Set voltage to 360V');
    await new Promise((resolve, reject) => {
      directOrderCommand('out', registers.PULSE_AMPLITUDE_ORDER, 63, 0, Buffer.alloc(0), (err) => {
        if (err) {
          return reject(err);
        }
        expParams.voltage = 360;
        return resolve();
      });
    });
    console.log('setAnalogFilters(12)');
    await setAnalogFilters(12);
    await setAttenHilo(0);
    await setAnalogInput_TT();
    await setSamplingFreq(1);
    await setPulseLength(0.2);
    await setRange(range);
    await setGain(gain);
    await setDelay(delay);
    await setSampleAveraging(sample_averaging);
    await setTrigger(1);

    console.log(expParams)
    return expParams;
  } catch (err) {
    throw err; // Propagate the error
  }
}

// Export whatever you need
module.exports = {
  initUsbDevice,
  ctrlIn,
  ctrlOut,
  powerOnDevice,
  directOrderCommand,
  softwareTrigger,
  setGain,
  setDelay,
  setRange,
  setStandardConfig,
  setAnalogInput_PE,
  setAnalogInput_TT,
  setPulseLength
};
