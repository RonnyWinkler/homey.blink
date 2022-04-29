'use strict';

const Homey = require('homey');

class systemDevice extends Homey.Device {

    async onInit() {
        this.log('Blink system init: '+this.getName()+' ID: '+this.getData().id);
        this.parent = this.getParent();

        await this.updateCapabilities();

        // Register Capability listener
        this.registerCapabilityListener("onoff", async (value) => {
            await this.onCapabilityOnoff(value);
        });
       
    } // end onInit

    
    async updateCapabilities(){
        // add new capabilities
        if (!this.hasCapability('measure_local_usage')){
            await this.addCapability('measure_local_usage');
        }
        if (!this.hasCapability('alarm_local_storage_full')){
            await this.addCapability('alarm_local_storage_full');
        }
        if (!this.hasCapability('status_usb')){
            await this.addCapability('status_usb');
        }
    }

    getParent(){
        this.parent = this.homey.app.getAccountDevice(this.getData().accountId); 
        if (this.parent){
            this.setSettings(
                {
                    account_device : this.parent.getName(),
                    account_id : this.parent.getData().id.toString(),
                    system_id : this.getData().id.toString()
                }
            );
            this.setDeviceAvailable();
        }
        else{
            this.setDeviceUnavailable();
        }
        return this.parent;
    }

    // Capability-/flow handling =========================================================================
    async onCapabilityOnoff(value) {
        //if value = true, it's on.. else off'
        if (value) {
            this.log('System '+this.getData().id+' armed.');
            this.armSystem();
            this.setCapabilityValue("onoff", true);
        } else {
            this.log('System '+this.getData().id+' disarmed.');
            this.disarmSystem();
            this.setCapabilityValue("onoff", false);
        }
    }

    // Device methods =========================================================================
    setDeviceUnavailable(reason){
        this.setUnavailable(reason);
    }

    setDeviceAvailable(){
        this.setAvailable();
    }

    updateDevice(systemData){
        // Check parent to set device available
        this.getParent();
        // current Homescreen data from Account device
        if (systemData){
            if (systemData.armed != this.getCapabilityValue('onoff')){
                this.log("updateDevice() System "+this.getData().id+' armed:'+systemData.armed);
                this.setCapabilityValue("onoff", systemData.armed).catch(error => this.error(error));
            }
            this.setCapabilityValue("measure_wifi_syncmodule", Math.round(systemData.sync_module_data.wifi_strength*20 )).catch(error => this.error(error));
            // SyncModule 
            if (systemData.sync_module_storage && systemData.sync_module_storage.usb_state == 'active'
                || systemData.sync_module_storage && systemData.sync_module_storage.usb_state == 'unmounted' ){
                this.setCapabilityValue("status_usb", systemData.sync_module_storage.usb_state ).catch(error => this.error(error));
            }
            else{
                this.setCapabilityValue("status_usb", 'unavailable' ).catch(error => this.error(error));
            }
            if (systemData.sync_module_storage && systemData.sync_module_storage.usb_storage_used != undefined){
                this.setCapabilityValue("measure_local_usage", systemData.sync_module_storage.usb_storage_used ).catch(error => this.error(error));
            }
            else{
                this.setCapabilityValue("measure_local_usage", 0 ).catch(error => this.error(error));
            }
            if (systemData.sync_module_storage && systemData.sync_module_storage.usb_storage_full != undefined){
                this.setCapabilityValue("alarm_local_storage_full", systemData.sync_module_storage.usb_storage_full ).catch(error => this.error(error));
            }
            else{
                this.setCapabilityValue("alarm_local_storage_full", false ).catch(error => this.error(error));
            }
        }
    }

    armSystem(){
        if(this.getParent()){
            this.parent.armSystem(this.getData().id).catch(error => this.error(error));
        }
    }

    disarmSystem(){
        if(this.getParent()){
            this.parent.disarmSystem(this.getData().id).catch(error => this.error(error));
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
module.exports = systemDevice;