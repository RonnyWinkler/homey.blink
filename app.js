if (process.env.DEBUG === '1')
{
    require('inspector').open(9222, '0.0.0.0', true);
}

'use strict';

const Homey = require('homey');

class blinkApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Blink app has been initialized');

    // Register Flow-Action-Listener
    this._flowActionCreateSnapshot = this.homey.flow.getActionCard('create_snapshot');
    this._flowActionCreateSnapshot.registerRunListener(async (args, state) => {
            return args.device.createSnapshot(args);
    });
    this._flowActionCreateVideo = this.homey.flow.getActionCard('create_video');
    this._flowActionCreateVideo.registerRunListener(async (args, state) => {
            return args.device.createVideo(args);
    });
    
    // Register Flow-Condition-Listener
    this._flowConditionLocalUsage = this.homey.flow.getConditionCard("measure_local_usage")
    .registerRunListener(async (args, state) => {
      return (args.device.getCapabilityValue('measure_local_usage') > args.value);
    })
    this._flowConditionCloudUsage = this.homey.flow.getConditionCard("measure_cloud_usage")
    .registerRunListener(async (args, state) => {
      return (args.device.getCapabilityValue('measure_cloud_usage') > args.value);
    })
    this._flowConditionApiError = this.homey.flow.getConditionCard("alarm_api_error")
    .registerRunListener(async (args, state) => {
      return (args.device.getCapabilityValue('alarm_api_error'));
    })
    this._flowConditionApiError = this.homey.flow.getConditionCard("alarm_local_storage_full")
    .registerRunListener(async (args, state) => {
      return (args.device.getCapabilityValue('alarm_local_storage_full'));
    })
    this._flowConditionCameraOffline = this.homey.flow.getConditionCard("alarm_camera_offline")
    .registerRunListener(async (args, state) => {
      return (args.device.getCapabilityValue('alarm_camera_offline'));
    })

  }


  // Device/Driver handling =================================================================

  getAccountDevices(){
    return this.homey.drivers.getDriver('account').getDevices();
  }

  getAccountDevice(id){
    let devices = this.getAccountDevices();
    for (let i=0; i<devices.length; i++){
        if (devices[i].getData().id == id){
            return devices[i];
        }
    }
    return null;
  }

}
  
module.exports = blinkApp;