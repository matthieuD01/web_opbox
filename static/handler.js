// Define a handler for the Proxy

const handler = {
  set(target, property, value) {
    // Check if the value is actually changing
    if (target[property] === value) {
      return true; // No change, no need to trigger
    }
    if (property == 'usbBusy') {
      return true // No need to trigger for this one
    }


    const oldValue = target[property];
    target[property] = value; // Apply the change

    // Trigger the onChange callback if it's defined
    if (typeof target.onChange === 'function') {
      target.onChange({ property, oldValue, newValue: value });
    }
    return true;
  },
  deleteProperty(target, property) {
    if (!(property in target)) {
      console.log(`Property ${property} does not exist, no deletion needed`);
      return true; // Property doesn't exist, nothing to delete
    }

    console.log(`Property ${property} deleted`);
    const oldValue = target[property];
    delete target[property]; // Apply the deletion

    // Trigger the onChange callback if it's defined
    if (typeof target.onChange === 'function') {
      target.onChange({ property, oldValue, deleted: true });
    }
    return true;
  },
};



module.exports = handler;
