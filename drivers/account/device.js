'use strict';

const Homey = require('homey');
const blinkApi = require('../../lib/blinkApi');

class accountDevice extends Homey.Device {

    async onInit() {
        this.log('Blink account init: '+this.getName()+' ID: '+this.getData().id);
        this.deviceData = {
            email: this.getStoreValue('email'),
            pw: this.getStoreValue('pw'),
            blinkUid: this.getStoreValue('blinkUid'),
            blinkNotificationKey: this.getStoreValue('blinkNotificationKey'),
            accountId: this.getData().id,
            // authtoken: null,
            // regionCode: null,
            loggedIn: false,
            statusStorage: null,
            lastVideoRequest: null,
            homescreen: null,
            apiErrorTimestamp: null
        };
        await this.updateCapabilities();

        try{
            await this.setSettings({
                    account_id : this.getData().id.toString(),
                    api_state : "OK"
                });
        }
        catch(error){
            this.error(error.message+" Account onInit()");
        }
            
        // register flow trigger
        this.apiStateErrorTrigger = this.homey.flow.getDeviceTriggerCard('api_state_error');
        this.apiStateOkTrigger = this.homey.flow.getDeviceTriggerCard('api_state_ok');
        this.alarmMotionTrigger = this.homey.flow.getDeviceTriggerCard('alarm_motion_general');
        this.alarmCameraOfflineTrigger = this.homey.flow.getDeviceTriggerCard('alarm_camera_offline_general');

        if (!this.blinkApi){
            this.blinkApi = new blinkApi();
        }

        this.log("Account Login...");
        await this.login();

        // start update intervals
        this.log("Start intervals...");
        this.refreshAuthTokenInterval();
        this.motionAlertInterval();
        this.deviceUpdateInterval();

        setTimeout( async () => this.updateDevices(), 
            2 * 1000 // Wait 2 sec to device update until all child devices are initialized
        );

        // register flow action cards
        // arm_system
        // disarm_system

    } // end onInit

    async updateCapabilities(){
        // add new capabilities
        if (!this.hasCapability('status_storage')){
            await this.addCapability('status_storage');
        }
        if (!this.hasCapability('measure_cloud_usage')){
            await this.addCapability('measure_cloud_usage');
        }
        if (!this.hasCapability('measure_cloud_autodelete_days')){
            await this.addCapability('measure_cloud_autodelete_days');
        }
        if (!this.hasCapability('alarm_api_error')){
            await this.addCapability('alarm_api_error');
        }

    }

    async apiStateError(reason){
        try{
            await this.setSettings({
                api_state : reason
            });
        }
        catch(error){
            this.error(error.message+" api_state:"+reason);
        }
        let state = this.getCapabilityValue('alarm_api_error');
        if (state == null || state == false){
            let now = Date.parse(new Date());
            if (this.deviceData.apiErrorTimestamp == null ){
                this.deviceData.apiErrorTimestamp = now;
            }
            let diff = this.getSetting('alarm_api_wait')*1000*60;
            let compare = this.deviceData.apiErrorTimestamp + diff;
            if (now >= compare){
                this.setCapabilityValue('alarm_api_error', true);
                const tokens = { "reason": reason };
                this.apiStateErrorTrigger.trigger( this,  tokens );
            }
        }
    }

    async apiStateOk(){
        this.deviceData.apiErrorTimestamp = null;
        try{
            await this.setSettings({
                api_state : 'OK'
            });
        }
        catch(error){
            this.error(error.message + "api_state : 'OK'");
        }
        let state = this.getCapabilityValue('alarm_api_error');
        if (state == null || state == true){
            this.setCapabilityValue('alarm_api_error', false);
            this.apiStateOkTrigger.trigger( this );
        }        
    }

    // API handling =========================================================================
    async login(){
        try{
            let result = await this.blinkApi.login(
                this.deviceData.email,
                this.deviceData.pw,
                this.deviceData.blinkUid,
                this.deviceData.blinkNotificationKey
            );
            // this.log(result);
            // this.authtoken = result.auth.token;
            // this.regionCode = result.account.tier;
            this.deviceData.loggedIn = true;
            this.apiStateOk();
            this.setDeviceAvailable();
            return true;
        }
        catch(error){
            this.loggedIn = false;
            let code = /code: \d*/.exec(error.message);
            let codeStr = '';
            if (code && code[0]){
                codeStr = code[0];
            }
            this.setDeviceUnavailable(this.homey.__('devices.account.login_error') +": "+ codeStr);
            this.error("Login error: "+error.message);
            this.apiStateError(this.homey.__('devices.account.login_error') +": "+ codeStr);
            return false;
        }
    }

    async reLogin(){
        this.log('Blink account reLogin(): '+this.getName()+' ID: '+this.getData().id);
        this.deviceData = {
            email: this.getStoreValue('email'),
            pw: this.getStoreValue('pw'),
            blinkUid: this.getStoreValue('blinkUid'),
            blinkNotificationKey: this.getStoreValue('blinkNotificationKey'),
            accountId: this.getData().id,
            // authtoken: null,
            // regionCode: null,
            loggedIn: false,
            statusStorage: null,
            lastVideoRequest: null,
            homescreen: null,
            apiErrorTimestamp: null
        };

        try{
            await this.setSettings({
                    account_id : this.getData().id.toString(),
                    api_state : "OK"
                });
        }
        catch(error){
            this.error(error.message+" Account reLogin()");
        }

        return this.login();
    }

    refreshAuthTokenInterval() {
        if (!this.intervalAuthToken){
            clearInterval(this.intervalAuthToken);
        }
        this.intervalAuthToken = setInterval( () => {
            this.login();
            this.log("A new authtoken has been requested");
        }, 43200000);
    }

    // Device handling =========================================================================
    setDeviceUnavailable(reason){
        this.setUnavailable(reason);
    }

    setDeviceAvailable(){
        this.setAvailable();
    }

    getSystemDevices(){
        let devices = this.homey.drivers.getDriver('system').getDevices();
        let result = [];
        for (let i=0; i<devices.length; i++){
            if (devices[i].getData().accountId == this.getData().id){
                result.push(devices[i]);
            }
        }
        return result;
    }

    getSystemDevice(id){
        let devices = this.getSystemDevices();
        return devices.find(device => device.getData().id === id);
    }

    getCameraDevices(){
        let devices = this.homey.drivers.getDriver('camera').getDevices();
        let result = [];
        for (let i=0; i<devices.length; i++){
            if (devices[i].getData().accountId == this.getData().id){
                result.push(devices[i]);
            }
        }
        return result;
    }

    getCameraDevice(id){
        let devices = this.getCameraDevices();
        return devices.find(device => device.getData().id === id);
    }

    getOwlDevices(){
        let devices = this.homey.drivers.getDriver('owl').getDevices();
        let result = [];
        for (let i=0; i<devices.length; i++){
            if (devices[i].getData().accountId == this.getData().id){
                result.push(devices[i]);
            }
        }
        return result;
    }

    getOwlDevice(id){
        let devices = this.getOwlDevices();
        return devices.find(device => device.getData().id === id);
    }

    // Devices handling =========================================================================
    deviceUpdateInterval(){
        if (!this.intervalUpdateLoop){
            clearInterval(this.intervalUpdateLoop);
        }
        // first update directly, then for every interval
        // this.updateDevices();
        this.intervalUpdateLoop = setInterval( async () => this.updateDevices(), 
            60 * 1000 * this.getSetting('status_interval') // every x min
        );
    }

    async updateDevices(){
        this.log("Update devices for account "+this.deviceData.accountId+"...");
        if (!this.deviceData.loggedIn){
            this.error("updateDvices(): Not logged in!");
            return;
        }
        // Subscriptions
        try{
            if (await this.blinkApi.hasSubscription()){
                this.deviceData.statusStorage = 'cloud';
            }
            else{
                this.deviceData.statusStorage = 'local';
            }
            this.setCapabilityValue('status_storage', this.deviceData.statusStorage ).catch(error => {this.error(error)});
        }
        catch (error){
            this.error(error.message);
            let code = /code: \d*/.exec(error.message);
            let codeStr = '';
            if (code && code[0]){
                codeStr = code[0];
            }
            this.apiStateError(this.homey.__('devices.account.api_error_device') +": "+codeStr);
            return;
        }

        // Read Homescreen Status
        try{
            this.deviceData.homescreen = await this.getHomescreen();
            if (!this.deviceData.homescreen){
                return;
            }
        }
        catch (error){
            this.error(error.message);
            let code = /code: \d*/.exec(error.message);
            let codeStr = '';
            if (code && code[0]){
                codeStr = code[0];
            }
            this.apiStateError(this.homey.__('devices.account.api_error_device') +": "+codeStr);
            return;
        }
        // Account
        if (this.deviceData.homescreen && this.deviceData.homescreen.video_stats){
            this.setCapabilityValue('measure_cloud_usage', this.deviceData.homescreen.video_stats.storage );
            this.setCapabilityValue('measure_cloud_autodelete_days', this.deviceData.homescreen.video_stats.auto_delete_days );
        }

        // Systems
        try{
            if (this.deviceData.homescreen && this.deviceData.homescreen.networks){
                for(let i=0; i < this.deviceData.homescreen.networks.length; i++ ){
                    let device = this.getSystemDevice(this.deviceData.homescreen.networks[i].id);
                    if (device){
                        let network = this.deviceData.homescreen.networks[i];
                        network["sync_module_data"] = this.deviceData.homescreen.sync_modules.find(sm => sm.network_id === network.id);
                        let syncmoduleStorage = {};
                        try{
                            syncmoduleStorage = await this.blinkApi.getSyncmoduleStorage(network.id, network["sync_module_data"].id);
                        }
                        catch(error){
                        }
                        network["sync_module_storage"] = syncmoduleStorage; 
                        device.updateDevice(network);
                    }
                }
            }
            // Cameras
            if (this.deviceData.homescreen && this.deviceData.homescreen.cameras){
                for(let i=0; i < this.deviceData.homescreen.cameras.length; i++ ){
                    let device = this.getCameraDevice(this.deviceData.homescreen.cameras[i].id);
                    if (device){
                        device.updateDevice(this.deviceData.homescreen.cameras[i]);
                    }
                }
            }
            // Mini-Cameras (owl)
            if (this.deviceData.homescreen && this.deviceData.homescreen.owls){
                for(let i=0; i < this.deviceData.homescreen.owls.length; i++ ){
                    let device = this.getOwlDevice(this.deviceData.homescreen.owls[i].id);
                    if (device){
                        device.updateDevice(this.deviceData.homescreen.owls[i]);
                    }
                }
            }
        }
        catch (error){
            this.error(error.message);
            let code = /code: \d*/.exec(error.message);
            let codeStr = '';
            if (code && code[0]){
                codeStr = code[0];
            }
            this.apiStateError(this.homey.__('devices.account.api_error_device') +": "+codeStr);
            return;
        }
        this.apiStateOk();
    }

    // Motion handling =========================================================================
    motionAlertInterval(){
        if (this.intervalMotionLoopSyncModule){
            clearInterval(this.intervalMotionLoopSyncModule);
        }
        if (this.intervalMotionLoopCloud){
            clearInterval(this.intervalMotionLoopCloud);
        }
        // Only check for motion alert is activated in device settings
        let active = this.getSetting('motion_check_enabled');
        if ( !active ){
            return;
        }
        this.intervalMotionLoopSyncModule = setInterval( async () => {
            // Dependent on subscription, use cloud access or SyncModule
            if (this.deviceData.statusStorage && this.deviceData.statusStorage == 'local'){
                // Clear all motion alerrts for all devices
                await this.clearMotionAlert(null, Date.parse(this.deviceData.lastVideoRequest));
                await this.checkMotionLocal().catch(error => this.error(error));
            }
            }, 
            1000 * this.getSetting('motion_interval_local') // every x sec
        );
        this.intervalMotionLoopCloud = setInterval( async () => {
            // Dependent on subscription, use cloud access or SyncModule
            if (this.deviceData.statusStorage && this.deviceData.statusStorage == 'cloud'){
                // Clear all motion alerrts for all devices
                await this.clearMotionAlert(null, Date.parse(this.deviceData.lastVideoRequest));
                await this.checkMotionCloud().catch(error => this.error(error));
            }
            }, 
            1000 * this.getSetting('motion_interval_cloud') // every x sec
        );
    }

    async checkMotionCloud(){
        if (!this.lastVideoRequest){
            this.lastVideoRequest = new Date().toISOString()
            .replace(/T/, ' ')       // replace T with a space
            .replace(/\..+/, '');     // delete the dot and everything after
        } 
        try{
            console.log("checkMotionCloud()");
            let media = await this.getNewVideosCloud(this.lastVideoRequest);
            console.log(media);
            let newestTimestamp = 0;
            if (media && media.length > 0) {
                for(let i=0; i < media.length; i++ ){
                    if (media[i].source == 'pir'){
                        this.log("New video for camera "+media[i].device_id+":");
                        this.log(media[i]);
                        let snapshot = null;
                        try{
                            snapshot = await this.blinkApi.getNewCameraSnapshotImageStream(media[i].thumbnail);
                        }
                        catch(error){
                            // keep snapshot = null
                        }
                        await this.triggerMotionAlert(media[i].device_id, Date.parse(media[i].created_at), snapshot);
                    }
                    // get newest timestamp
                    if ( Date.parse(media[i].created_at) > newestTimestamp ){
                        newestTimestamp = Date.parse(media[i].created_at);
                    }
                    if ( Date.parse(media[i].updated_at) > newestTimestamp ){
                        newestTimestamp = Date.parse(media[i].updated_at);
                    }
                    this.lastVideoRequest = new Date(newestTimestamp).toISOString();
                    this.lastVideoRequest = this.lastVideoRequest
                        .replace(/T/, ' ')       // replace T with a space
                        .replace(/\..+/, '');     // delete the + and everything after
                }
            }
            // return media;
            this.apiStateOk();
        }
        catch(error){
            this.error(error.message);
            let code = /code: \d*/.exec(error.message);
            let codeStr = '';
            if (code && code[0]){
                codeStr = code[0];
            }
            this.apiStateError(this.homey.__('devices.account.api_error_motion_cloud') +": "+codeStr);
            return;
        }
    }

    async getNewVideosCloud(timestamp){
        let result = {};
        try{
            result = await this.blinkApi.getCloudStorage(timestamp);
        }
        catch(error){
            throw error;
            // this.error(error);
            // return;
        }
        result.media.sort((a, b) => { if (a.created_at > b.created_at) return 1; else return -1;});
        // console.log(result.media);
        return result.media;
    }

    async checkMotionLocal(){
        if (!this.lastVideoRequest){
            this.lastVideoRequest = new Date().toISOString()
            .replace(/T/, ' ')       // replace T with a space
            .replace(/\..+/, '');     // delete the dot and everything after
        } 
        try{
            console.log("checkMotionLocal()");
            let media = await this.getNewVideosLocal()
            console.log(media);
            let newestTimestamp = 0;
            if (media && media.length > 0) {
                for(let i=0; i < media.length; i++ ){
                    // get cameraID for video
                    let cameraId = null;
                    for(let j=0; j < this.deviceData.homescreen.cameras.length; j++ ){
                        // Replace all non-CHAR/NUN characters because camera name in SyncModule video list condensed
                        let cameraName = this.deviceData.homescreen.cameras[j].name.replace(/[^a-zA-Z0-9]/g, '');
                        let mediaCameraName = media[i].camera_name.replace(/[^a-zA-Z0-9]/g, '');
                        // if (this.deviceData.homescreen.cameras[j].name == media[i].camera_name){
                        if ( cameraName === mediaCameraName ){
                            cameraId = this.deviceData.homescreen.cameras[j].id;
                        }
                    }
                    // 2nd step. Search for MiniKameras
                    if (!cameraId){
                        for(let j=0; j < this.deviceData.homescreen.owls.length; j++ ){
                            // Replace all non-CHAR/NUN characters because camera name in SyncModule video list condensed
                            let cameraName = this.deviceData.homescreen.owls[j].name.replace(/[^a-zA-Z0-9]/g, '');
                            let mediaCameraName = media[i].camera_name.replace(/[^a-zA-Z0-9]/g, '');
                            // if (this.deviceData.homescreen.owls[j].name == media[i].camera_name){
                            if ( cameraName === mediaCameraName ){
                                cameraId = this.deviceData.homescreen.owls[j].id;
                            }
                        }
                    }
                    // Camera found by name?
                    if (cameraId){
                        // get newest timestamp
                        if ( Date.parse(media[i].created_at) > newestTimestamp ){
                            newestTimestamp = Date.parse(media[i].created_at);
                        }
                        this.lastVideoRequest = new Date(newestTimestamp).toISOString();
                        this.lastVideoRequest = this.lastVideoRequest
                            .replace(/T/, ' ')       // replace T with a space
                            .replace(/\..+/, '');     // delete the + and everything after
                        this.log("New video for camera "+cameraId+":");
                        this.log(media[i]);
                        await this.triggerMotionAlert(cameraId, Date.parse(media[i].created_at));
                    }
                }
            }
            // return media;
            this.apiStateOk();
        }
        catch(error){
            this.error(error.message);
            let code = /code: \d*/.exec(error.message);
            let codeStr = '';
            if (code && code[0]){
                codeStr = code[0];
            }
            this.apiStateError(this.homey.__('devices.account.api_error_motion_local') +": "+codeStr);
            return;
        }
    }

    async getNewVideosLocal(){
        if (!this.deviceData.homescreen){
            return;
        }
        let videoList = [];
        for (var i = 0; i < this.deviceData.homescreen.sync_modules.length; i++) {
            let syncmoduleId = this.deviceData.homescreen.sync_modules[i].id;
            let systemId = this.deviceData.homescreen.sync_modules[i].network_id;
            console.log("getNewVideosLocal() SyncModule "+syncmoduleId);
            let result = {};
            try{
                result = await this.blinkApi.getSyncModuleStorage(systemId, syncmoduleId);
            }
            catch(error){
                throw error;
                // return(videoList);
            }
            if (result && result.clips){
                for (var j = 0; j < result.clips.length; j++) {
                    let createdAt = result.clips[j].created_at
                        .replace(/T/, ' ')       // replace T with a space
                        .replace(/\+.+/, '');     // delete the + and everything after
                    let createdAtTimestamp = Date.parse(createdAt);
                    let lastRequestTimestamp = Date.parse(this.lastVideoRequest);
                    if ( createdAtTimestamp > lastRequestTimestamp ){
                        videoList.push( result.clips[j] );
                    }
                }
            }
        }
        videoList.sort((a, b) => { if (a.created_at > b.created_at) return 1; else return -1;});
        // console.log(videoList);
        return(videoList);        
    }

    async clearMotionAlert(){
        let devices = [];
        devices = this.getCameraDevices();
        for (let i=0; i<devices.length; i++){
            devices[i].clearMotionAlert();
        }
        devices = [];
        devices = this.getOwlDevices();
        for (let i=0; i<devices.length; i++){
            devices[i].clearMotionAlert();
        }
    }

    async triggerMotionAlert(cameraId, timestamp, snapshot = null){
        let device = null;
        device = this.getCameraDevice(cameraId);
        if (device){
            device.triggerMotionAlert(timestamp, snapshot);
        }
        device = null;
        device = this.getOwlDevice(cameraId);
        if (device){
            device.triggerMotionAlert(timestamp, snapshot);
        }
    }

    // API access for child devices =========================================================================
    async getSystems(){
        try{
            let result = await this.blinkApi.getSystems();
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async armSystem(id){
        try{
            let result = await this.blinkApi.armSystem(id);
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async disarmSystem(id){
        try{
            let result = await this.blinkApi.disarmSystem(id);
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async getHomescreen(){
        try{
            let result = await this.blinkApi.getHomescreen();
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async getCameras(type = 0, buffered = true){
        try{
            let result = await this.blinkApi.getCameras(type, buffered);
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async getCamera(id){
        try{
            let result = await this.blinkApi.getCamera(id);
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async enableCameraMotion(id){
        try{
            let result = await this.blinkApi.enableCameraMotion(id);
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async disableCameraMotion(id){
        try{
            let result = await this.blinkApi.disableCameraMotion(id);
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async requestCameraVideo(id){
        try{
            let result = await this.blinkApi.requestCameraVideo(id);
            return result;
        }
        catch (error){
            throw error;
        }
    }

    async getNewCameraSnapshot(id){
        try{
            this.log("getNewCameraSnapshot()");
            //let camera = await this.getCamera(id);
            let url = await this.blinkApi.getNewCameraSnapshotUrl(id);
            this.log("New URL: "+url);
            // let image = await this.blinkApi.getNewCameraSnapshotImageStream(url);
            return await this.blinkApi.getNewCameraSnapshotImageStream(url);
        }
        catch (error){
            throw error;
        }
    }

    async triggerAlarmMotion(device, timestamp, snapshot){
        let tz  = this.homey.clock.getTimezone();
        let timeString = new Date(timestamp).toLocaleString(this.homey.i18n.getLanguage(), 
        { 
            hour12: false, 
            timeZone: tz,
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });

        // create snapshot token if provided
        let localImage = await this.homey.images.createImage();
        if (snapshot){
            try{
                let sourceStream = snapshot;
                let snapshotBuffer = await this.stream2buffer(sourceStream);
                await localImage.setStream(async stream => {
                    if (snapshotBuffer){
                        let sourceStream = this.buffer2stream(snapshotBuffer);
                        return await sourceStream.pipe(stream);
                    }
                    else{
                        throw new Error("No snapshot available. Blink subscription is needed.")
                    }
                });
            }
            catch(error){ 
                this.error(error.message);
            }
        }
        let tokens = { 
            "device_name": device.getName(),
            "date_time": timeString,
            "image": localImage
        };
        // Trigger flow event for account (general trigger for all cameras)
        this.alarmMotionTrigger.trigger( this,  tokens );
        // Trigger flow event for camera devices (single camera)
        this.alarmMotionTrigger.trigger( device,  tokens );
    }

    async triggerAlarmCameraOffline(device){
        let tokens = { 
            "device_name": device.getName()
        };
        this.alarmCameraOfflineTrigger.trigger( this,  tokens );
    }

    // App events =========================================================================
    onAdded() {
        let id = this.getData().id;
        this.log('device added: ', id);

    } // end onAdded

    onDeleted() {
        let id = this.getData().id;
        this.log('device deleted:', id);
        if (this.intervalAuthToken){
            clearInterval(this.intervalAuthToken);
        }
        if (this.intervalMotionLoopSyncModule){
            clearInterval(this.intervalMotionLoopSyncModule);
        }
        if (this.intervalMotionLoopCloud){
            clearInterval(this.intervalMotionLoopCloud);
        }
        if (this.intervalUpdateLoop){
            clearInterval(this.intervalUpdateLoop);
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
        this.log('Account settings where changed');
        if (changedKeys.indexOf("status_interval") >= 0){
                setTimeout( async () => this.deviceUpdateInterval()
                , 
                2 * 1000 // Wait 2 sec to update intervals
                );
        }
        if (changedKeys.indexOf("motion_interval_cloud") >= 0 || 
            changedKeys.indexOf("motion_interval_local") >= 0 ||
            changedKeys.indexOf("motion_check_enabled") >= 0
            ){
                setTimeout( async () => this.motionAlertInterval()
                , 
                2 * 1000 // Wait 2 sec to update intervals
            );
        }
    }

    // Service methods =========================================================================
    buffer2stream(buffer) {  
        let stream = new (require('stream').Duplex)();
        stream.push(buffer);
        stream.push(null);
        return stream;
    }

    stream2buffer(stream) {
        return new Promise((resolve, reject) => {
            const _buf = [];
            stream.on("data", (chunk) => _buf.push(chunk));
            stream.on("end", () => resolve(Buffer.concat(_buf)));
            stream.on("error", (err) => reject(err));
        });
    } 

}
module.exports = accountDevice;