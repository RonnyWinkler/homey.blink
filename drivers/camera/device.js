'use strict';

const Homey = require('homey');

class cameraDevice extends Homey.Device {

    async onInit() {
        this.log('Blink camera init: '+this.getName()+' ID: '+this.getData().id);
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

    getParent(){
        this.parent = this.homey.app.getAccountDevice(this.getData().accountId); 
        if (this.parent){
            this.setSettings(
                {
                    account_device : this.parent.getName(),
                    account_id : this.parent.getData().id.toString(),
                    camera_id : this.getData().id.toString()
                }
            );
            this.setDeviceAvailable();
        }
        else{
            this.setDeviceUnavailable();
        }
        return this.parent;
    }

    // Capability-/Flow-/Event handling =========================================================================
    async onCapabilityOnoff(value) {
        //if value = true, it's on.. else off'
        if (value) {
            this.log('Camera '+this.getData().id+' motion alarm enabled.');
            this.enableCameraMotion();
            this.setCapabilityValue("onoff", true);
        } else {
            this.log('Camera '+this.getData().id+' motion alarm disabled.');
            this.disableCameraMotion();
            this.setCapabilityValue("onoff", false);
        }
    }

    async registerImage() {
        this.log('registerImage() '+this.getName()+' ID: '+this.getData().id);
        this.snapshotImage = await this.homey.images.createImage();
        this.setCameraImage('snapshot', this.homey.__('devices.camera.snapshot'), this.snapshotImage);
        this.snapshotImage.setStream(async stream => {
            try{
                let res = await this.getNewCameraSnapshot();
                if (!res) {
                    throw new Error("Invalid Image");
                }
                this.log("Image stream received => pipe to device image");
                return await res.pipe(stream);
                // res.body.pipe(stream);
            }
            catch(error){
                this.error("registerImage() Error calling getNewCameraSnapshot(): "+error);
                this.log("Close the stream to prevent the app waiting for timeout.");
                stream.end();
                throw new Error(this.homey.__('devices.camera.snapshot_error'));
            }
        });
    }

    
    async createSnapshot(args){
        // Trigger "snapshot_created" flow using the image. This will trigger the image recording.
        this.log("createSnapshot(): Trigger Flow: snapshot_created. "+this.getName()+' ID: '+this.getData().id);
        //await this.snapshotImage.update();
        // Trigger flow
        let tokens = {
            device_name: this.getName(),
            image: this.snapshotImage
        };
        let state = {};
        this._flowTriggerSnapshotCreated.trigger(this, tokens, state)
            .catch(this.error);
    }


    async createVideo(args){
        // Request recording of a camera video
        this.log("createVideo(): Request recording of a camera video. "+this.getName()+' ID: '+this.getData().id);
        try{
            // Request video
            await this.requestCameraVideo();
        }
        catch(error){
            this.error("Error on video request: "+error.message);
        }
    }


    // Device methods =========================================================================
    setDeviceUnavailable(reason){
        this.setUnavailable(reason);
    }

    setDeviceAvailable(){
        this.setAvailable();
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

            let temp = Math.round((cameraData.signals.temp - 32) * 5 / 9 * 10) / 10;
            this.setCapabilityValue("measure_temperature", temp ).catch(error => this.error(error));

            this.setCapabilityValue("measure_wifi", Math.round(cameraData.signals.wifi*20 )).catch(error => this.error(error));
            this.setCapabilityValue("measure_lfr", Math.round(cameraData.signals.lfr*20 )).catch(error => this.error(error));
            this.setCapabilityValue("measure_battery",  Math.round(cameraData.signals.battery*20 )).catch(error => this.error(error));
            if ( cameraData.signals.battery <= 1){
                this.setCapabilityValue("alarm_battery", true).catch(error => this.error(error));
            }
            else{
                this.setCapabilityValue("alarm_battery", false).catch(error => this.error(error));
            }
        }
    }

    enableCameraMotion(){
        if(this.getParent()){
            this.parent.enableCameraMotion(this.getData().id).catch(error => this.error(error));
        }
    }

    disableCameraMotion(){
        if(this.getParent()){
            this.parent.disableCameraMotion(this.getData().id).catch(error => this.error(error));
        }
    }

    clearMotionAlert(){
        if (this.getCapabilityValue('alarm_motion') == true){
            this.setCapabilityValue('alarm_motion', false).catch(this.error);
        }
    }

    triggerMotionAlert(timestamp){
        //Check if the event date is newer
        if (timestamp > this.getCapabilityValue("video_timestamp")) {
            this.log("new motion detected on camera: "+this.getName()+" ID: "+ this.getData().id);
            this.setCapabilityValue("video_timestamp", timestamp).catch(this.error);
            this.setCapabilityValue('alarm_motion', true).catch(this.error);
        }
        
    }

    async getNewCameraSnapshot(){
        if(this.getParent()){
            try{
                return await this.parent.getNewCameraSnapshot(this.getData().id);
            }
            catch(error){
                throw error;
            }
        }
    }

    async requestCameraVideo(){
        if(this.getParent()){
            try{
                return await this.parent.requestCameraVideo(this.getData().id);
            }
            catch(error){
                return null;
            }
        }
    }

    // App events =========================================================================
    onAdded() {
        let id = this.getData().id;
        this.log('device added: ', id);

    } // end onAdded

    onDeleted() {
        let id = this.getData().id;
        this.log('device deleted:', id);
    } // end onDeleted

    /**
     * onSettings is called when the user updates the device's settings.
     * @param {object} event the onSettings event data
     * @param {object} event.oldSettings The old settings object
     * @param {object} event.newSettings The new settings object
     * @param {string[]} event.changedKeys An array of keys changed since the previous version
     * @returns {Promise<string|void>} return a custom message that will be displayed
     */
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log('System settings where changed');
        
    }

}
module.exports = cameraDevice;