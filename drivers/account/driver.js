"use strict";
const Homey = require('homey');
const blinkApi = require('../../lib/blinkApi');

class accountDriver extends Homey.Driver {
    onPair(session) {
        this.log("onPair()");
        this.blinkApi = new blinkApi();
        this.settingsData = { 
            "email": "",
            "pw": "",
            "blinkUid": this.blinkApi.generate_uid(16),
            "blinkNotificationKey": this.blinkApi.generate_uid(152),
            "pin": "",
            "accountId": 0
        };

        session.setHandler("settingsChanged", async (data) => {
            return await this.onSettingsChanged(data);
        });

        session.setHandler("getSettings", async () => {
            this.log("getSettings:");
            this.log(this.settingsData);
            return this.settingsData;
        });

        session.setHandler('showView', async (view) => {
            return await this.onShowView(session, view);
        });
      
        session.setHandler("list_devices", async () => {
            return await this.onPairListDevices(session);
        });

    } // end onPair

    async onSettingsChanged(data){
        this.log("onSettingsChanged()");
        this.log(data);
        if (data.email){
            this.settingsData.email = data.email;
        }
        if (data.pw){
            this.settingsData.pw = data.pw;
        }
        if (data.pin){
            this.settingsData.pin = data.pin;
        }
        return true;
    }

    async onShowView(session, view){
        if (view === 'check_account') {
            this.log("onShowView(check_account)");
            try{
                let result = await this.checkAccount();
                if ( result.account.client_verification_required ){
                    await session.showView("pin");
                }
                else{
                    await session.nextView();
                }
            }
            catch(error){
                await session.showView("account_error");
            }
        }
        if (view === 'check_pin') {
            this.log("onShowView(check_pin)");
            try{
                let result = await this.checkPin();
                if (result.valid){
                    await session.nextView();

                }
                else{
                    await session.showView("pin_error");
                }
            }
            catch(error){
                await session.showView("pin_error");
            }
        }
      }
    
    async checkAccount(){
        this.log("checkAccount()");
        try{
            let result = await this.blinkApi.login(
                this.settingsData.email,
                this.settingsData.pw,
                this.settingsData.blinkUid,
                this.settingsData.blinkNotificationKey
                );
            this.log(result);
            this.settingsData.accountId = result.account.account_id;
            return result;
        }
        catch(error){
            this.log(error.message);
            throw error;
        }
    }

    async checkPin(){
        this.log("checkPin()");
        try{
            let result = await this.blinkApi.verifyPin(
                this.settingsData.pin
                );
            this.log(result);
            return result;
        }
        catch(error){
            this.log(error.message);
            throw error;
        }
    }

    async onPairListDevices(session) {
        this.log("onPairListDevices()" );
        let devices = [];
        let device = {
            name: "Blink "+this.homey.__('pair.device.account') +" "+this.settingsData.email,
            data: {
              id: this.settingsData.accountId
            },
            store: {
              email: this.settingsData.email,
              pw: this.settingsData.pw,
              blinkUid: this.settingsData.blinkUid,
              blinkNotificationKey: this.settingsData.blinkNotificationKey,
              //accountId: this.settingsData.accountId
            },
            settings:{
              status_interval: 1,
              motion_interval_cloud: 10,
              motion_interval_local: 15,
              motion_check_enabled: true,
              alarm_api_wait: 10
            }
          }
        devices.push(device);
        this.log("Found devices:");
        this.log(devices);
        return devices;
    }

}
module.exports = accountDriver;