class Trigger {
    constructor() {
        this.value0 = 0b00000000;
        this.value1 = 0b00000111;
        this.value = Buffer.from([this.value0, this.value1]);

        this.TriggerSource = 0b0000;
        this.TriggerEnable = 0b0;
        this.TriggerReset = 0b0;
        this.TriggerSw = 0b0;

        this.XY_Divider_Enable = 0b1;
        this.XY_Divider_Reset = 0b1;
        this.TimeEnable = 0b1;
        this.Trigger_Status = 0b0;
        this.Trigger_Overrun_Status = 0b0;
    }

    setValue() {
        this.value0 = (this.TriggerSw << 6) + (this.TriggerReset << 5) + (this.TriggerEnable << 4) + this.TriggerSource;
        this.value1 = (this.Trigger_Overrun_Status << 6) + (0 << 5) + (this.Trigger_Status << 4) + (0 << 3) + (this.TimeEnable << 2) + (this.XY_Divider_Reset << 1) + this.XY_Divider_Enable;
        this.value = Buffer.from([this.value0, this.value1]);
    }
}

class Measure {
    constructor() {
        this.value0 = 0b00000000;
        this.value1 = 0b00000000;
        this.value = Buffer.from([this.value0, this.value1]);

        this.SamplingFreq = 0b0000;
        this.GainMode = 0b00;
        this.DataProcessingMode = 0b0;
        this.StoreDisable = 0b0;
    }

    setValue() {
        this.value0 = (this.DataProcessingMode << 7) + (0 << 6) + (this.GainMode << 4) + this.SamplingFreq;
        this.value1 = (this.StoreDisable << 1) + (0 << 1);
        this.value = Buffer.from([this.value0, this.value1]);
    }
}

class AnalogCtrl {
    constructor() {
        this.value0 = 0b00000000;
        this.value1 = 0b00000000;
        this.value = Buffer.from([this.value0, this.value1]);

        this.AnalogFilter = 0b0001;
        this.InputAttenuator = 0b0;
        this.PostAmplifier = 0b0;
        this.AnalogInput = 0b0;
    }

    setValue() {
        this.value0 = (0 << 7) + (this.AnalogInput << 6) + (this.PostAmplifier << 5) + (this.InputAttenuator << 4) + this.AnalogFilter;
        this.value1 = 0b00000000;
        this.value = Buffer.from([this.value0, this.value1]);
    }
}

class PulserTime {
    constructor() {
        this.value0 = 0b00000000;
        this.value1 = 0b00000000;
        this.value = Buffer.from([this.value0, this.value1]);
        this.PulseTime = 0b000000;
        this.PulserSelect = 0b0;
        this.DriverEnable = 0b0;
    }

    setValue() {
        this.value0 = (this.DriverEnable << 7) + (this.PulserSelect << 6) + this.PulseTime;
        this.value1 = 0b00000000;
        this.value = Buffer.from([this.value0, this.value1]);
    }
}

module.exports = { Trigger, Measure, AnalogCtrl, PulserTime };
