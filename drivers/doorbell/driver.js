'use strict';

const { Driver } = require('homey');

class doorbellDriver extends Driver {
    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        this.log('Driver "doorbell" has been initialized');
    }

    async onPair(session){
        this.log("onPair()");
        this.selectedAccount = {};
        let listView = 1;

        session.setHandler("list_devices", async () => {
        //return await this.onPairListDevices(session);
        this.log("handler: list_devices");
        if (listView == 1){
            listView = 2;
            return await this.onPairListAccounts(session);
        }
        else{
            listView = 1;
            return await this.onPairListCameras(session);
        }
        });

        session.setHandler('list_devices_selection', async (data) => {
            this.log("handler: list_devices_selection");
            return await this.onListDeviceSelection(session, data);
        });
    }

    async onListDeviceSelection(session, data){
        this.log("handler: list_devices_selection: ");
        this.log(data);
        this.selectedAccount = data[0];
        return;
    }

    async onPairListAccounts(session) {
        this.log("onPairListAccounts()" );
        let devices = [];
        let accountList = this.homey.drivers.getDriver('account').getDevices();
        for (let i=0; i<accountList.length; i++){
            devices.push(
              {
                name: accountList[i].getName(),
                data: {
                  id: accountList[i].getData().id
                },
                icon: "../../account/assets/icon.svg"
              }
            );
        }
        this.log("New devices:");
        this.log(devices);
        if (devices.length == 0){
          await session.showView("account_error");
        }
        return devices;
      }
    
      async onPairListCameras(session) {
        this.log("onPairListCameras()" );
        let devices = [];
        let accountList = this.homey.drivers.getDriver('account').getDevices();
        for (let i=0; i<accountList.length; i++){
            if (accountList[i].getData().id == this.selectedAccount.data.id){
                // Read only doorbell cameras (paramerer type = 3)
                let cameras = await accountList[i].getCameras(3, false);
                this.log(cameras);
        
                for (let j=0; j < cameras.length; j++){
                  devices.push(
                    {
                      name: cameras[j].name,
                      data: {
                        id: cameras[j].id,
                        accountId: accountList[i].getData().id
                      }
                    }
                  );
                }
            }
        }
        this.log("New devices:");
        this.log(devices);
        return devices;
      }
    }
    
    module.exports = doorbellDriver;