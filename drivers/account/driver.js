"use strict";
const Homey = require('homey');
const blinkApi = require('../../lib/blinkApi');

class accountDriver extends Homey.Driver {
    async onPair(session) {
        this.log("onPair()");
        // if (!this.blinkApi){
            this.blinkApi = new blinkApi();
        // }
        this.settingsData = { 
            "email": "",
            "pw": "",
            // "blinkUid": this.blinkApi.generate_uid(16),
            "blinkUid": await this.homey.cloud.getHomeyId(),
            // "blinkNotificationKey": this.blinkApi.generate_uid(152),
            "pin": "",
            "accountId": 0
        };

        session.setHandler("settingsChanged", async (data) => {
            return await this.onSettingsChanged(data);
        });

        session.setHandler("getSettings", async () => {
            this.log("getSettings:");
            if (process.env.DEBUG === '1'){
                this.log(this.settingsData);
            }
            return this.settingsData;
        });

        session.setHandler('showView', async (view) => {
            return await this.onShowView(session, view);
        });
      
        session.setHandler("list_devices", async () => {
            return await this.onPairListDevices(session);
        });

    } // end onPair

    async onRepair(session, device) {
        this.log("onRepair()");

        // if (!this.blinkApi){
            this.blinkApi = new blinkApi();
        // }
        // Uid and NotificationKey must be set with new values. Re-Auth seems to need new IDs. Old ID seem to get revoked on PW change. 
        this.settingsData = { 
            email: device.getStoreValue('email'),
            pw: '',
            blinkUid: this.blinkApi.generate_uid(16), //device.getStoreValue('blinkUid'),
            // blinkNotificationKey: this.blinkApi.generate_uid(152), //device.getStoreValue('blinkNotificationKey'),
            accountId: device.getData().id,
            pin: ''
        };

        session.setHandler("settingsChanged", async (data) => {
            return await this.onSettingsChanged(data);
        });

        session.setHandler("getSettings", async () => {
            this.log("getSettings:");
            if (process.env.DEBUG === '1'){
                this.log(this.settingsData);
            }
            return this.settingsData;
        });

        session.setHandler('showView', async (view) => {
            return await this.onShowViewRepair(session, view, device);
        });

        // session.setHandler("update_device", async () => { 
        //     return await this.updateDevice(device, session)
        // });
      
    } // end onRepair

    async onSettingsChanged(data){
        this.log("onSettingsChanged()");
        if (process.env.DEBUG === '1'){
            this.log(data);
        }
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
            // try{
            //     let result = await this.checkAccount();
            //     if ( result.account.client_verification_required ){
            //         await session.showView("pin");
            //     }
            //     else{
            //         await session.nextView();
            //     }
            // }
            // catch(error){
            //     await session.showView("account_error");
            // }
            try{
                await this.checkAccount();
                await session.nextView();
            }
            catch(error){
                if (error.code == 412){
                    // 2FA required
                    await session.showView("pin");
                }
                else{
                    await session.showView("account_error");
                }
            }
        }
        if (view === 'check_pin') {
            this.log("onShowView(check_pin)");
            // try{
            //     let result = await this.checkPin();
            //     if (result.valid){
            //         await session.nextView();

            //     }
            //     else{
            //         await session.showView("pin_error");
            //     }
            // }
            // catch(error){
            //     await session.showView("pin_error");
            // }
            try{
                let loginData = await this.check2FA();
                this.settingsData.accountId = loginData.account;
                this.settingsData.region = loginData.region;
                this.settingsData.token = loginData.token;
                
                await session.nextView();
                // let result = await this.checkPin();
                // if (result.valid){
                //     await session.nextView();

                // }
                // else{
                //     await session.showView("pin_error");
                // }
            }
            catch(error){
                await session.showView("pin_error");
            }
        }
    }

    async onShowViewRepair(session, view, device){
    if (view === 'check_account') {
        this.log("onShowView(check_account)");
        // try{
        //     let result = await this.checkAccount();
        //     if ( result.account.client_verification_required ){
        //         await session.showView("pin");
        //     }
        //     else{
        //         await session.nextView();
        //     }
        // }
        // catch(error){
        //     await session.showView("account_error");
        // }
        try{
            await this.checkAccount();
            await session.nextView();
        }
        catch(error){
            if (error.code == 412){
                // 2FA required
                await session.showView("pin");
            }
            else{
                await session.showView("account_error");
            }
        }
    }
    if (view === 'check_pin') {
        this.log("onShowView(check_pin)");
        try{
            let loginData = await this.check2FA();
            this.settingsData.accountId = loginData.account;
            this.settingsData.region = loginData.region;
            this.settingsData.token = loginData.token;
            
            await session.nextView();
            // let result = await this.checkPin();
            // if (result.valid){
            //     await session.nextView();

            // }
            // else{
            //     await session.showView("pin_error");
            // }
        }
        catch(error){
            await session.showView("pin_error");
        }
    }
    if (view === 'update_device') {
        this.log("onShowView(update_device)");
        try{
            await this.updateDevice(device);
            await session.nextView();
        }
        catch(error){
            await session.showView("account_error");
        }
    }
    }

    async checkAccount(){
        this.log("checkAccount()");
        try{
            let result = await this.blinkApi.oAuthLogin(
                this.settingsData.email,
                this.settingsData.pw,
                this.settingsData.blinkUid
            );
            this.log(result);
            return result;
        }
        catch(error){
            this.log(error.message);
            throw error;
        }
    }

    async check2FA(){
        this.log("check2FA()");
        try{
            let result = await this.blinkApi.oAuthComplete2faLogin(
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
            //   pw: this.settingsData.pw,
              blinkUid: this.settingsData.blinkUid,
            //   blinkNotificationKey: this.settingsData.blinkNotificationKey,
              //accountId: this.settingsData.accountId
              token: this.settingsData.token,
              region: this.settingsData.region
            },
            settings:{
              status_interval: 1,
              motion_interval_cloud: 10,
              motion_interval_local: 15,
              motion_check_enabled: true,
              alarm_api_wait: 10,
              api_state: 'OK',
              account_id: this.settingsData.accountId.toString()
            }
          }
        devices.push(device);
        this.log("Found devices:");
        this.log(devices);
        return devices;
    }

    async updateDevice(device) {
        this.log("updateDevice()" );
        if (this.settingsData.accountId != device.getData().id){
            throw new Error();
        }
        await device.setStoreValue('email', this.settingsData.email);
        await device.setStoreValue('pw', '');
        await device.setStoreValue('blinkUid', this.settingsData.blinkUid);
        await device.setStoreValue('token', this.settingsData.token);
        await device.setStoreValue('region', this.settingsData.region);
        // await device.setStoreValue('blinkNotificationKey', this.settingsData.blinkNotificationKey);   
        this.log("updateDevice(): device store data set. Start re-login..." );    
        await device.reLogin(); 
    }
}
module.exports = accountDriver;