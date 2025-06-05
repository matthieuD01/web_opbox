function getDeviceParameters(version = 'OpBox 2.1') {
  // Check the version; throw an error if it isn’t supported.
  if (version !== 'OpBox 2.1') {
    throw new Error("Current software implements parameters only for the OpBox 2.1 version. Or something. Maybe it's 2.2. Docs are unclear, I have to ping them and make sure. self.version should be 'OpBox 2.x'");
  }

  // Create an object to hold the device parameters
  const params = {};

  params.sampling_rate = 100e6;      // 100MHz max sampling rate
  params.voltage_steps = 64;         // number of voltage steps (0-->63 = 64)
  params.max_voltage = 360;          // V
  // Calculate the minimum voltage above zero. Step 0 is 0V, so step 1 is min_voltage.
  params.min_voltage = params.max_voltage / (params.voltage_steps - 1);
  params.min_gain = -28;             // dB
  params.max_gain = 68;              // dB
  params.min_delay = 0;              // us
  params.max_delay = 65535;          // in sampling cycles
  params.buffer_size = 262144;       // bytes
  params.header_size = 54;           // bytes
  params.max_packet_length = 4854;
  params.pulse_step_time = 0.1;      // us per step of charging time
  params.max_pulse_steps = 63;       
  params.receiver_input_voltage = 0.275; // V

  // Define analog filter options as an object mapping keys to descriptions
  params.analog_filters = {
    0: "0.5 - 6 MHz",
    1: "1 - 6 MHz",
    2: "2 - 6 MHz",
    3: "4 - 6 MHz",
    4: "0.5 - 10 MHz",
    5: "1 - 10 MHz",
    6: "2 - 10 MHz",
    7: "4 - 10 MHz",
    8: "0.5 - 15 MHz",
    9: "1 - 15 MHz",
    10: "2 - 15 MHz",
    11: "4 - 15 MHz",
    12: "0.5 - 25 MHz",
    13: "1 - 25 MHz",
    14: "2 - 25 MHz",
    15: "4 - 25 MHz"
  };

  return params;
}

// Example usage:
try {
  const deviceParams = getDeviceParameters(); // defaults to 'OpBox 2.1'
  console.log(deviceParams);
} catch (error) {
  console.error("Error:", error.message);
}

module.exports = {
    getDeviceParameters,
}
