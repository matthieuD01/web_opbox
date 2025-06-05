# Smush OpBox Web Application

An oscilloscope-like web application to control the OpBox, an ultrasound testing device, built using Node.js, Express, and Socket.IO.

## Table of Contents

- [Features](#features)
- [Folder Structure](#folder-structure)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Features

- **USB Device Control**: Interact with the Optel OpBox in its 2.1 version to read acoustics data.
- **Web Interface**: A web-based interface to control the USB device.
- **Real-time Data Visualization**: Use Plotly for real-time waveform visualization.
- **Socket.IO Integration**: Real-time communication between the client and server.
- **Database Integration**: Store data in an SQLite database. (to be added)

## Folder Structure
```
smush_opbox/
├── src/
│   ├── main/
│   │   ├── app.js                 # Main script to start the webapp
│   │   ├── constants.js           # USB device constant definitions
│   │   ├── dataclass.js           # Dataclass definitions for OpBox's registers
│   │   ├── opbox_capabilites.js   # Parameter limits for OpBox 2.1
│   │   ├── usbController.js       # Logic to control the USB device
│   ├── utils/
│   │   ├── helperFunctions.js     # Utility functions to read and parse all registers
│   ├── views/
│   │   ├── index2.html             # HTML file for the webpage
├── static/
│   ├── handler.js             # Proxy handler for observedState
│   ├── jquery.js              # jQuery library
├── node_modules/
├── package.json
├── README.md
```

## Installation

1. **Clone the repository**:
   ```sh
   git clone https://gogs.ceec.echem.io/matthieu/smush_opbox
   cd smush_opbox
   ```

2. **Install the dependencies**:
   ```sh
   npm install
   ```

## Usage

1. **Start the application**:
   ```sh
   npm start PORT
   ```
    This is will start the application and run at [localhost:PORT](http://localhost:PORT) and [YOURIP:PORT](http://YOURIP:PORT). 
    You might want to run it sandboxed in a container, and include in your systemd if you are running on Linux.

2. **Open your browser and navigate to**:
   ```
   http://localhost:PORT
   http://YOURIP:PORT
   ```

3. **Interact with the web interface**:
   - Use the sliders to adjust gain, range, and delay.
   - Disconnect and reconnect to the USB device.
   - Switch between reflection mode (pulse-echo) and transmission mode.
   - View real-time data visualization in the chart.
   - Start an experiment, that will be saved to '/home/pi/acoustics_data/{expName}.db' (see initializeDatabase in app.js)
   - Send control transfer commands to the device (advanced users only, refer to OpBox manual).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.