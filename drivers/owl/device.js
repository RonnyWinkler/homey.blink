'use strict';

const Homey = require('homey');
const cameraDevice = require('../camera/device');

class owlDevice extends cameraDevice {

    async onInit() {
        this.log('Blink Mini camera init: '+this.getName()+' ID: '+this.getData().id);
        this.parent = this.getParent();
        this.snapshotImage = null;

        await this.updateCapabilities();

        // Register Capability listener
        this.registerCapabilityListener("onoff", async (value) => {
            await this.onCapabilityOnoff(value);
        });
       
        // Init video timestamp, use current time to get alerts for motions in the future, not in the past
        let now = new Date()
        now = Date.parse(now);
        this.setCapabilityValue("video_timestamp", now);

        // Register Flow-Trigger
        this._flowTriggerSnapshotCreated = this.homey.flow.getDeviceTriggerCard("snapshot_created");
        // this._flowTriggerSnapshotCreated.registerRunListener(async (args, state) => {
        //     return ( !args.id || args.id === state.id);
        // });
        
        // Register images
        setTimeout( async () => 
            this.registerImage().catch(error => this.error(error)),
            2 * 1000 // Wait 2 sec to device update until all child devices are initialized
        );

    } // end onInit

    async updateCapabilities(){
        // add new capabilities
        if (!this.hasCapability('alarm_camera_offline')){
            await this.addCapability('alarm_camera_offline');
        }
        
    }

    updateDevice(cameraData){
        // Check parent to set device available
        this.getParent();
        // current Homescreen data from Account device
        if (cameraData){
            if (cameraData.enabled != this.getCapabilityValue('onoff')){
                this.log("updateDevice() Camera "+this.getData().id+' motion alarm:'+cameraData.enabled);
                this.setCapabilityValue("onoff", cameraData.enabled).catch(error => this.error(error));
            }
            let camera_offline = false;
            if (cameraData.status == "offline"){
                camera_offline = true;
            }
            if (camera_offline != this.getCapabilityValue('alarm_camera_offline')){
                this.log("updateDevice() Camera "+this.getData().id+' status:'+cameraData.status);
            }
            this.setCapabilityValue("alarm_camera_offline", camera_offline).catch(error => this.error(error));

        }
    }

}
module.exports = owlDevice;