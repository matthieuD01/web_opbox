# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js web application that provides an oscilloscope-like interface to control the OpBox 2.1, an ultrasound testing device. The application acts as a USB-to-HTTP proxy, enabling real-time control and data visualization through a web browser.

## Commands

### Development
- `npm start [PORT]` - Start the application on specified port (defaults to 3000)
- `npm install` - Install dependencies

### Database
- Data is saved to `/home/pi/acoustics_data/{expName}.db` when experiments are running
- Uses SQLite with better-sqlite3 driver

## Architecture

### Core Components

**USB Communication Layer** (`src/main/usbController.js`):
- Handles direct USB communication with OpBox device (Vendor ID: 0x0547, Product ID: 0x1003)
- Implements control transfers for reading/writing device registers
- Manages device configuration, power-on sequences, and measurement triggers
- Key functions: `setGain()`, `setDelay()`, `setRange()`, `setStandardConfig()`

**Device Constants** (`src/main/constants.js`):
- USB endpoints, register addresses, and command definitions
- Device-specific constants like `VENDOR_ID`, `PRODUCT_ID`, register addresses

**Device Parameters** (`src/main/opbox_capabilities.js`):
- Hardware limits and capabilities for OpBox 2.1
- Sampling rate (100MHz), voltage range (0-360V), gain range (-28 to 68dB)

**Data Classes** (`src/main/dataclass.js`):
- Binary register structures: `Trigger`, `Measure`, `AnalogCtrl`, `PulserTime`
- Handle bit-level manipulation for device control

**State Management** (`static/handler.js`):
- Proxy handler for `observedState` object that triggers real-time updates
- Broadcasts state changes via Socket.IO to all connected clients

### Data Flow

1. **USB Polling**: Continuous polling of USB device for data readiness
2. **Data Processing**: Raw USB data parsed into waveforms with header information
3. **Real-time Broadcast**: Processed data sent to web clients via Socket.IO
4. **Database Storage**: Experiment data saved as Float16 binary blobs every 5 seconds

### Key State Variables

- `observedState.usbConnected` - USB device connection status
- `observedState.gain/delay/range` - Measurement parameters
- `observedState.transmission` - Mode: false=pulse-echo, true=transmission
- `observedState.expRunning` - Experiment recording status
- `observedState.usbBusy` - Prevents concurrent USB operations

### Web Interface

**Frontend** (`src/views/index2.html`):
- Real-time waveform visualization using Plotly.js
- Control sliders for gain, delay, range parameters
- Experiment controls and mode switching (pulse-echo vs transmission)
- Socket.IO client for real-time communication

**API Endpoints**:
- `/ctrl_out`, `/ctrl_in` - Direct register read/write
- `/input` - Set measurement parameters
- `/set_pulse_echo_mode`, `/set_transmission_mode` - Mode switching
- `/connectUSB`, `/disconnectUSB` - Device connection control

### Data Parsing

Raw USB data structure per measurement:
- 54-byte header (frame info, timestamps, trigger status)
- N sample bytes (where N = depth determined by range parameter)
- Multiple acquisitions averaged based on `sample_averaging` setting

Parsed data is normalized to [-1, 1] range and broadcast as Float32 arrays.

### Error Handling

- USB communication errors trigger automatic reconnection attempts
- Parameter validation against device capabilities before setting
- State synchronization prevents conflicts during USB operations

## Development Notes

- Device requires specific initialization sequence: reset → power on → configure parameters
- USB operations are callback-based; use Promises for async/await patterns
- Sample averaging and depth calculations must respect buffer size limits (262,144 bytes)
- Real-time performance depends on USB polling frequency and data processing efficiency