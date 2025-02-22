'use strict';

const Homey = require('homey');
const Duplex = require('stream').Duplex;

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
        this.registerCapabilityListener("button_light_on", async (value) => {
            await this.onCapabilityLight(true);
        });
        this.registerCapabilityListener("button_light_off", async (value) => {
            await this.onCapabilityLight(false);
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
                    account_device : this.parent.getName() || '',
                    account_id : this.parent.getData().id.toString() || '',
                    camera_id : this.getData().id.toString() || ''
                }
            ).catch(error => {this.error("getParent().setSettings(): ", error.message)});
            this.setDeviceAvailable();
        }
        else{
            this.setDeviceUnavailable();
        }
        return this.parent;
    }

    // Capability-/Flow-/Event handling =========================================================================
    async onCapabilityOnoff(state) {
        //if value = true, it's on.. else off'
        if (state) {
            this.log('Camera '+this.getData().id+' motion alarm enabled.');
            this.enableCameraMotion();
            this.setCapabilityValue("onoff", true);
        } else {
            this.log('Camera '+this.getData().id+' motion alarm disabled.');
            this.disableCameraMotion();
            this.setCapabilityValue("onoff", false);
        }
    }

    async onCapabilityLight(on){
        this.log('Camera '+this.getData().id+' light on: ', on);
        await this.setCameraLight(on);
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

    
    // async createSnapshot(args){
    //     // Trigger "snapshot_created" flow using the image. This will trigger the image recording.
    //     this.log("createSnapshot(): Trigger Flow: snapshot_created. "+this.getName()+' ID: '+this.getData().id);
    //     //await this.snapshotImage.update();
    //     // Trigger flow
    //     let tokens = {
    //         device_name: this.getName(),
    //         image: this.snapshotImage
    //     };
    //     let state = {};
    //     this._flowTriggerSnapshotCreated.trigger(this, tokens, state)
    //         .catch(this.error);
    // }

    async createSnapshot(args){
        // Trigger "snapshot_created" flow using the image. This will trigger the image recording.
        this.log("createSnapshot(): Trigger Flow: snapshot_created. "+this.getName()+' ID: '+this.getData().id);
        // await this.snapshotImage.update();
        try{
            let localImage = await this.homey.images.createImage();
            let sourceStream = await this.snapshotImage.getStream();
            let snapshotBuffer = await this.stream2buffer(sourceStream);
            await localImage.setStream(async stream => {
                if (snapshotBuffer){
                    let sourceStream = this.buffer2stream(snapshotBuffer);
                    return await sourceStream.pipe(stream);
                }
            });

            // Trigger flow
            let tokens = {
                device_name: this.getName(),
                image: localImage
            };
            let state = {};
            this._flowTriggerSnapshotCreated.trigger(this, tokens, state)
                .catch(error => {
                    this.error("createSnapshot() => _flowTriggerSnapshotCreated.trigger(): ", error.message);
                });
            return tokens;
        }
        catch(error){
            this.error(error.message);
            throw new Error(error.message);
        }
    }

    stream2buffer(stream) {
        return new Promise((resolve, reject) => {
            const _buf = [];
            stream.on("data", (chunk) => _buf.push(chunk));
            stream.on("end", () => resolve(Buffer.concat(_buf)));
            stream.on("error", (err) => reject(err));
        });
    } 

    buffer2stream(buffer) {  
        let stream = new (require('stream').Duplex)();
        stream.push(buffer);
        stream.push(null);
        return stream;
    }

    async createVideo(args){
        // Request recording of a camera video
        this.log("createVideo(): Request recording of a camera video. "+this.getName()+' ID: '+this.getData().id);
        try{
            // Request video
            await this.requestCameraVideo();
        }
        catch(error){
            this.error("createVideo(): Error on video request: "+error.message);
            throw error;
        }
    }


    // Device methods =========================================================================
    setDeviceUnavailable(reason){
        this.setUnavailable(reason);
    }

    setDeviceAvailable(){
        this.setAvailable();
    }

    async updateDevice(cameraData){
        // Check parent to set device available
        this.getParent();
        // current Homescreen data from Account device
        if (cameraData){
            // enable/disable flood light control 
            if (cameraData.storm != undefined){
                if(!this.hasCapability('button_light_on')){
                    this.addCapability('button_light_on');
                }
                if(!this.hasCapability('button_light_off')){
                    this.addCapability('button_light_off');
                }
                await this.setSettings({floodlight_id: cameraData.storm.id.toString()});
                await this.setStoreValue('floodlight_id', cameraData.storm.id );
            }
            else{
                if(this.hasCapability('button_light_on')){
                    this.removeCapability('button_light_on');
                }
                if(this.hasCapability('button_light_off')){
                    this.removeCapability('button_light_off');
                }
                await this.setSettings({floodlight_id: ''});
                await this.setStoreValue('floodlight_id', null );
            }

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
                if (camera_offline == true){
                    if(this.getParent()){
                        this.parent.triggerAlarmCameraOffline(this);
                    }
                }
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
            this.parent.enableCameraMotion(this.getData().id).catch(error => this.error("enableCameraMotion(): ",error.message));
        }
    }

    disableCameraMotion(){
        if(this.getParent()){
            this.parent.disableCameraMotion(this.getData().id).catch(error => this.error("disableCameraMotion(): ",error.message));
        }
    }

    clearMotionAlert(){
        if (this.getCapabilityValue('alarm_motion') == true){
            this.setCapabilityValue('alarm_motion', false).catch(this.error);
        }
    }

    triggerMotionAlert(timestamp, snapshot, video_id){
        //Check if the event date is newer
        if (timestamp > this.getCapabilityValue("video_timestamp")) {
            this.log("new motion detected on camera: "+this.getName()+" ID: "+ this.getData().id);
            this.setCapabilityValue("video_timestamp", timestamp).catch(this.error);
            if (video_id == null || video_id.source == 'pir' || video_id.source == 'cv_motion'){
                this.setCapabilityValue('alarm_motion', true).catch(this.error);
            }
            if(this.getParent()){
                this.parent.triggerAlarmMotion(this, timestamp, snapshot, video_id);
            }
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
                throw error;
            }
        }
    }

    async exportVideoSmb(args){
        if(this.getParent()){
            try{
                return await this.parent.exportVideoSmb(args);
            }
            catch(error){
                throw error;
            }
        }
    }

    async exportVideoFtp(args){
        if(this.getParent()){
            try{
                return await this.parent.exportVideoFtp(args);
            }
            catch(error){
                throw error;
            }
        }
    }

    async setCameraLight(on){
        let cameraId = this.getData().id;
        let floodlightId = this.getStoreValue('floodlight_id');
        if (!floodlightId){
            throw new Error('No Floodlight available');
        }
        if(this.getParent()){
            try{
                return await this.parent.setCameraLight(cameraId, floodlightId, on);
            }
            catch(error){
                throw error;
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
        if (this.snapshotImage){
            this.snapshotImage.unregister();
        }
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