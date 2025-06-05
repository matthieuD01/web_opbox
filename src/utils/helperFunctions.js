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
} = require('../main/usbController'); // path to your helper file

const registers = require('../main/constants');

function float32ToFloat16Bits(val) {
    // Special cases first: +Infinity, -Infinity, NaN
    if (!Number.isFinite(val)) {
        // Infinity or NaN
        // IEEE754 float16 representation for Inf: 0x7C00 or 0xFC00
        if (Number.isNaN(val)) return 0xFE00;     // one NaN representation
        return val > 0 ? 0x7C00 : 0xFC00;         // +Inf : -Inf
    }
    // For normal values, we can do a bit-level hack:
    // 1) Convert float32 -> float64 bit pattern in JS, 
    // 2) Extract sign, exponent, mantissa, and round to 10 bits.
    const floatView = new Float32Array([val]);
    const intView = new Uint32Array(floatView.buffer);
    const x = intView[0];

    const sign = (x >>> 31) & 0x1;
    let exponent = ((x >>> 23) & 0xFF) - 127;     // float32 exponent - bias
    let mantissa = x & 0x7FFFFF;                  // 23-bit fraction

    if (exponent > 15) {
        // Overflow -> Infinity
        return (sign << 15) | 0x7C00;
    } else if (exponent < -14) {
        // Subnormal or zero
        if (exponent < -24) {
            // Underflow -> 0
            return (sign << 15);
        }
        // Subnormal number
        mantissa |= 0x800000;  // implicit leading 1
        // Shift right to fit into 10 bits mantissa
        let shift = -exponent - 14;
        mantissa = mantissa >> (shift + 13);  // 13 = 23 - 10
        return (sign << 15) | mantissa;
    }

    // Normalized value
    exponent = exponent + 15;               // re-bias exponent for float16
    mantissa = mantissa >> 13;             // truncate mantissa from 23 bits to 10 bits
    return (sign << 15) | (exponent << 10) | (mantissa & 0x3FF);
}

/**
 * Convert an array of float32 (JS numbers) into a Buffer 
 * that matches NumPy float16 .tobytes() ordering (little-endian).
 */
function float32ArrayToFloat16Buffer(floatArray) {
    const n = floatArray.length;
    const buffer = Buffer.allocUnsafe(n * 2); // 2 bytes per float16
    for (let i = 0; i < n; i++) {
        const bits = float32ToFloat16Bits(floatArray[i]);
        // write as little-endian 16-bit
        buffer.writeUInt16LE(bits, i * 2);
    }
    return buffer;
}



// Function to convert bytes to bits
function bytes2bits(bytes) {
    let bits = [];
    // Iterate over the bytes in reverse order
    for (let i = bytes.length - 1; i >= 0; i--) {
        let byte = bytes[i];
        // Convert the byte to an 8-character binary string, padded with zeros if needed
        let binStr = byte.toString(2).padStart(8, '0');
        // Convert the string into an array of numbers (0 or 1)
        let byteBits = binStr.split('').map(ch => parseInt(ch, 10));
        // Concatenate the bits for this byte
        bits = bits.concat(byteBits);
    }
    // Reverse the whole array so that bits[0] is the least-significant bit
    return bits.reverse();
}

function bytes2dec(bytes, i0, i1) {
    // Get the full 16-bit little-endian array
    const bits = bytes2bits(bytes);
    // Slice out the relevant bits (from index i0 to i1 inclusive)
    const relevantBits = bits.slice(i0, i1 + 1);
    // Calculate the integer value using little-endian weighting
    let total = 0;
    for (let i = 0; i < relevantBits.length; i++) {
        if (relevantBits[i] === 1) {
            total += Math.pow(2, i);
        }
    }
    return total;
}


// Function to read all parameters and return a promise
function readAllParameters() {
    return new Promise((resolve, reject) => {
        let params = {};

        // Simulating ctrl_transfer calls using ctrlIn
        directOrderCommand('in', registers.OPBOX_SN_ORDER, 0, 0, 2, (err, OPBOX_SN) => {
            if (err) return reject(err);
            params['SN_YEAR'] = OPBOX_SN[1];
            params['SN_NO'] = OPBOX_SN[0];

            directOrderCommand('in', registers.DIRECT_FRAME_READY_ORDER, 0, 0, 1, (err, data) => {
                if (err) return reject(err);
                params['DIRECT_FRAME_READY'] = data[0];

                directOrderCommand('in', registers.USB_MODE_ORDER, 0, 0, 1, (err, data) => {
                    if (err) return reject(err);
                    params['USB_MODE'] = data[0] ? 'High Speed (480Mbps)' : 'Full Speed (12Mbps)';

                    ctrlIn(registers.DEV_REV_REG, 2, (err, DEV_REV) => {
                        if (err) return reject(err);
                        params['DEVICE REVISION INFORMATION REGISTER'] = '-----';
                        params['Firmware Revision'] = bytes2dec(DEV_REV, 0, 7);
                        params['Hardware Subversion'] = bytes2dec(DEV_REV, 8, 11);
                        params['Hardware Major Version'] = bytes2dec(DEV_REV, 12, 15);
                        params['Hard+Firm Version'] = [
                            params['Hardware Major Version'],
                            params['Hardware Subversion'],
                            params['Firmware Revision']
                        ].join('.');

                        ctrlIn(registers.POWER_CTRL_REG, 2, (err, POWER_CTRL) => {
                            if (err) return reject(err);
                            params['POWER SUPPLY CONTROL REGISTER'] = '-----';
                            params['Power Enable'] = bytes2dec(POWER_CTRL, 0, 0);
                            params['Power OK'] = bytes2dec(POWER_CTRL, 4, 4);
                            params['ANALOG PWR Status'] = bytes2dec(POWER_CTRL, 5, 5);
                            params['DC12V Status'] = bytes2dec(POWER_CTRL, 6, 6);
                            params['VREG Status'] = bytes2dec(POWER_CTRL, 7, 7);

                            ctrlIn(registers.PACKET_LEN_REG, 2, (err, PACKET_LEN) => {
                                if (err) return reject(err);
                                params['PACKET LENGTH REGISTER'] = '-----';
                                params['PacketLength'] = bytes2dec(PACKET_LEN, 0, 12);

                                ctrlIn(registers.FRAME_IDX_REG, 2, (err, FRAME_IDX) => {
                                    if (err) return reject(err);
                                    params['FRAME INDEX REGISTER'] = '-----';
                                    params['FrameIdx'] = bytes2dec(FRAME_IDX, 0, 15);

                                    ctrlIn(registers.FRAME_CNT_REG, 2, (err, FRAME_CNT) => {
                                        if (err) return reject(err);
                                        params['FRAME COUNTER REGISTER'] = '-----';
                                        params['FrameCnt'] = bytes2dec(FRAME_CNT, 0, 12);

                                        ctrlIn(registers.CAPT_REG_REG, 2, (err, CAPT_REG) => {
                                            if (err) return reject(err);
                                            params['CAPTURED GPI AND TRIGGER OVERRUN SOURCE REGISTER'] = '-----';
                                            params['TrgOvrSrc_A'] = bytes2dec(CAPT_REG, 0, 0);
                                            params['TrgOvrSrc_H'] = bytes2dec(CAPT_REG, 1, 1);
                                            params['TrgOvrSrc_F'] = bytes2dec(CAPT_REG, 2, 2);
                                            params['TrgOvrSrc_P'] = bytes2dec(CAPT_REG, 3, 3);
                                            params['GPIcaptured'] = bytes2dec(CAPT_REG, 12, 8);

                                            ctrlIn(registers.TRIGGER_REG, 2, (err, TRIGGER) => {
                                                if (err) return reject(err);
                                                params['TRIGGER CONTROL REGISTER'] = '-----';
                                                params['Trigger Source'] = bytes2dec(TRIGGER, 0, 3);
                                                params['Trigger Enable'] = bytes2dec(TRIGGER, 4, 4);
                                                params['Trigger Reset'] = bytes2dec(TRIGGER, 5, 5);
                                                params['Trigger Sw'] = bytes2dec(TRIGGER, 6, 6);
                                                params['XY Divider Enable'] = bytes2dec(TRIGGER, 8, 8);
                                                params['XY Divider Reset'] = bytes2dec(TRIGGER, 9, 9);
                                                params['Timer Enable'] = bytes2dec(TRIGGER, 10, 10);
                                                params['Trigger Status'] = bytes2dec(TRIGGER, 12, 12);
                                                params['Trigger Overrun Status'] = bytes2dec(TRIGGER, 14, 14);

                                                ctrlIn(registers.TRG_OVERRUN_REG, 2, (err, TRG_OVERRUN) => {
                                                    if (err) return reject(err);
                                                    params['TRIGGER OVERRUN COUNTER REGISTER'] = '-----';
                                                    params['Trigger Overrun Counter'] = bytes2dec(TRG_OVERRUN, 0, 15);

                                                    ctrlIn(registers.XY_DIVIDER_REG, 2, (err, XY_DIVIDER) => {
                                                        if (err) return reject(err);
                                                        params['DIVIDER REGISTER FOR TRIGGER X AND Y'] = '-----';
                                                        params['DividerXY TopValue'] = bytes2dec(XY_DIVIDER, 0, 15);

                                                        ctrlIn(registers.TIMER_REG, 2, (err, TIMER) => {
                                                            if (err) return reject(err);
                                                            params['INTERNAL TIMER REGISTER'] = '-----';
                                                            params['Timer Period'] = bytes2dec(TIMER, 0, 15);

                                                            ctrlIn(registers.TIMER_CAPT_REG, 2, (err, TIMER_CAPT) => {
                                                                if (err) return reject(err);
                                                                params['INTERNAL TIMER CAPTURE REGISTER'] = '-----';
                                                                params['Timer Capture'] = bytes2dec(TIMER_CAPT, 0, 15);

                                                                ctrlIn(registers.ANALOG_CTRL_REG, 2, (err, ANALOG_CTRL) => {
                                                                    if (err) return reject(err);
                                                                    params['ANALOG CONTROL REGISTER'] = '-----';
                                                                    params['Analog Filter'] = bytes2dec(ANALOG_CTRL, 0, 3);
                                                                    params['Input Attenuator'] = bytes2dec(ANALOG_CTRL, 4, 4);
                                                                    params['Post Amplifier'] = bytes2dec(ANALOG_CTRL, 5, 5);
                                                                    params['Analog Input'] = bytes2dec(ANALOG_CTRL, 6, 6);

                                                                    ctrlIn(registers.PULSER_TIME_REG, 2, (err, PULSER_TIME) => {
                                                                        if (err) return reject(err);
                                                                        params['PULSER CONTROL REGISTER'] = '-----';
                                                                        params['Pulse Time'] = bytes2dec(PULSER_TIME, 0, 5);
                                                                        params['Pulser Select'] = bytes2dec(PULSER_TIME, 6, 6);
                                                                        params['Driver Enable'] = bytes2dec(PULSER_TIME, 7, 7);

                                                                        ctrlIn(registers.MEASURE_REG, 2, (err, MEASURE) => {
                                                                            if (err) return reject(err);
                                                                            params['MEASUREMENT CONTROL REGISTER'] = '-----';
                                                                            params['Sampling Freq'] = bytes2dec(MEASURE, 0, 3);
                                                                            params['Gain Mode'] = bytes2dec(MEASURE, 4, 5);
                                                                            params['Data Processing Mode'] = bytes2dec(MEASURE, 7, 7);
                                                                            params['Store Disable'] = bytes2dec(MEASURE, 9, 9);

                                                                            ctrlIn(registers.DELAY_REG, 2, (err, DELAY) => {
                                                                                if (err) return reject(err);
                                                                                params['DELAY (POST TRIGGER) CONTROL REGISTER'] = '-----';
                                                                                params['Delay'] = bytes2dec(DELAY, 0, 15);

                                                                                ctrlIn(registers.DEPTH_L_REG, 2, (err, DEPTH_L) => {
                                                                                    if (err) return reject(err);
                                                                                    params['DEPTH OF MEASUREMENT SAMPLE BUFFER REGISTER'] = '-----';
                                                                                    params['Depth_L'] = bytes2dec(DEPTH_L, 0, 15);

                                                                                    ctrlIn(registers.DEPTH_L_REG, 4, (err, DEPTH_H) => {
                                                                                        if (err) return reject(err);
                                                                                        params['Depth'] = bytes2dec(DEPTH_H, 0, 65);

                                                                                        ctrlIn(registers.CONST_GAIN_REG, 2, (err, CONST_GAIN) => {
                                                                                            if (err) return reject(err);
                                                                                            params['CONSTANTS GAIN REGISTER (REQUIRE INITIALIZATION AFTER RESET)'] = '-----';
                                                                                            params['Constant Gain'] = bytes2dec(CONST_GAIN, 0, 7);
                                                                                            resolve(params); // Resolve the promise with the params object
                                                                                        });
                                                                                    });
                                                                                });
                                                                            });
                                                                        });
                                                                    });
                                                                });
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

module.exports = {
    readAllParameters,
    bytes2bits,
    bytes2dec,
    float32ToFloat16Bits,
    float32ArrayToFloat16Buffer,
};