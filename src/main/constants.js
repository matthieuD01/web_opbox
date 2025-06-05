// registers.js

// Vendor and product IDs for OPBOX
VENDOR_ID = 0x0547;
PRODUCT_ID = 0x1003;

// Control transfer commands bmRequest Type
USB_OUT = 0x40;
USB_IN = 0xC0;

USB_IN_ENDPOINT = 0x86; // endpoint to read measurement data

// Direct Orders Description Table

OPBOX_SN_ORDER = 0xD0;  // Retrieves the device serial number.
// Value=0, Index=0, Length=2, IN
// Data[0]: SN_YEAR (0–255)
// Data[1]: SN_NO (0–255)

RESET_ORDER = 0xD1;  // Resets all device registers to their default values.
// Value=0, Index=0, Length=1, OUT

FIFO_RESET_ORDER = 0xD2;  // Clears all stored frames in memory and resets FIFO.
// Value=0, Index=0, Length=0, OUT

DIRECT_SW_TRIG_ORDER = 0xD3;  // A faster and simpler way to initiate measurement via software.
// Value=0, Index=0, Length=0, OUT

RESERVED_ORDER = 0xD4;  // Reserved for future commands or functionality.
// Value=0, Index=0, Length=0, OUT

DIRECT_FRAME_READY_ORDER = 0xD5;  // Indicates measurement status.
// Value=0, Index=0, Length=1, IN
// Data[0]:
//   0x00 - Memory empty or less frames than specified in PACKET_LENGTH register.
//   0x01 - New packet ready (specified number of frames are stored and ready).

PULSE_AMPLITUDE_ORDER = 0xD6;  // Configures pulse amplitude (0...63 corresponds to 0...360V).
// Value=Pulse Amplitude (0...63), Index=1, Length=1, OUT
// NOTE: Requires initialization after reset.

USB_MODE_ORDER = 0xD7;  // Checks USB speed mode status.
// Value=0, Index=0, Length=1, IN
// Data[0]:
//   0x00 - Device enumerated in Full-Speed mode (12 Mbps).
//   0x01 - Device enumerated in High-Speed mode (480 Mbps).


READ_REGISTER   = 0xE1;
WRITE_REGISTER  = 0xE0;

DEV_REV_REG = 0x00; // Register for Device Revision Information
POWER_CTRL_REG  = 0x02;       // Register for power control
PACKET_LEN_REG  = 0x04;
FRAME_IDX_REG   = 0x06;
FRAME_CNT_REG   = 0x08;       // Register for number of frames in memory
CAPT_REG_REG    = 0x0A;
TRIGGER_REG     = 0x10;    // Register for trigger settings
TRG_OVERRUN_REG = 0x12;
XY_DIVIDER_REG  = 0x14;
TIMER_REG       = 0x16;
TIMER_CAPT_REG  = 0x18;
ANALOG_CTRL_REG = 0x1A;
PULSER_TIME_REG = 0x1C;
BURST_REG       = 0x1E;
MEASURE_REG     = 0x20;
DELAY_REG = 0x22;           // Register for delay setting
DEPTH_L_REG = 0x24;         // Depth low word register (2 least significant bytes)
DEPTH_H_REG = 0x26;         // Depth high word register (15 most significant bytes)
CONST_GAIN_REG = 0x28;      // Register for DAC Gain setting
// Skipping everything linked with peak detectors and encoders.


// Bit definitions
POWER_ENABLE_BIT = 0x01; // 0000 0001 in binary: when writing this to power control register, enables power.
POWER_OK_BIT = 0x10;     // 0001 0000 in binary: this is a control bit. The 5th bit when reading the power control register is 0 if no power and 1 if power

// You can export them as properties of an object:
module.exports = {
  VENDOR_ID,
  PRODUCT_ID,
  USB_OUT,
  USB_IN,
  USB_IN_ENDPOINT,
  OPBOX_SN_ORDER,
  RESET_ORDER,
  FIFO_RESET_ORDER,
  DIRECT_SW_TRIG_ORDER,
  RESERVED_ORDER,
  DIRECT_FRAME_READY_ORDER,
  PULSE_AMPLITUDE_ORDER,
  USB_MODE_ORDER,
  READ_REGISTER,
  WRITE_REGISTER,
  DEV_REV_REG,
  POWER_CTRL_REG,
  PACKET_LEN_REG,
  FRAME_IDX_REG,
  FRAME_CNT_REG,
  CAPT_REG_REG,
  TRIGGER_REG,
  TRG_OVERRUN_REG,
  XY_DIVIDER_REG,
  TIMER_REG,
  TIMER_CAPT_REG,
  ANALOG_CTRL_REG,
  PULSER_TIME_REG,
  BURST_REG,
  MEASURE_REG,
  DELAY_REG,
  DEPTH_L_REG,
  CONST_GAIN_REG,

  POWER_ENABLE_BIT,
  POWER_OK_BIT,
};
