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
            return await args.device.createSnapshot(args);
    });
    this._flowActionCreateSnapshotStd = this.homey.flow.getActionCard('create_snapshot_std');
    this._flowActionCreateSnapshotStd.registerRunListener(async (args, state) => {
            await args.device.createSnapshot(args);
            return true;
    });
    this._flowActionCreateVideo = this.homey.flow.getActionCard('create_video');
    this._flowActionCreateVideo.registerRunListener(async (args, state) => {
            await args.device.createVideo(args);
            return true;
    });
    this._flowActionExportSnapshotSmb = this.homey.flow.getActionCard('export_snapshot_smb');
    this._flowActionExportSnapshotSmb.registerRunListener(async (args, state) => {
            return await this.exportSnapshotSmb(args);
    });
    this._flowActionExportSnapshotFtp = this.homey.flow.getActionCard('export_snapshot_ftp');
    this._flowActionExportSnapshotFtp.registerRunListener(async (args, state) => {
            return await this.exportSnapshotFtp(args);
    });
    this._flowActionExportVideoSmb = this.homey.flow.getActionCard('export_video_smb');
    this._flowActionExportVideoSmb.registerRunListener(async (args, state) => {
            try{ 
              await args.device.exportVideoSmb(args);
            }
            catch(error){
              throw error;
            }
    });
    this._flowActionExportVideoFtp = this.homey.flow.getActionCard('export_video_ftp');
    this._flowActionExportVideoFtp.registerRunListener(async (args, state) => {
            try{ 
              await args.device.exportVideoFtp(args);
            }
            catch(error){
              throw error;
            }
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

  async exportSnapshotSmb(args){
    // SMB Export of an image token
    let tz  = this.homey.clock.getTimezone();
    let now = new Date().toLocaleString('en-US', 
    { 
        hour12: false, 
        hourCycle: 'h23',
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
    let date = now.split(", ")[0];
    date = date.split("/")[2] + "-" + date.split("/")[0] + "-" + date.split("/")[1]; 
    let time = now.split(", ")[1];    
    time = time.split(":")[0] + "-" + time.split(":")[1] + "-" + time.split(":")[2]; 
    
    let filename = date + "_" + time;
    if (args.camera_name){
      filename = filename + "_" + args.camera_name;
    }
    filename = filename + ".jpg";

    this.log("Export Image to SMB: "+args.smb_share+"\\"+filename);

    // create an SMB2 instance
    try{
      // let smb2Client = new smb2({
        let smb2Client = new (require('@marsaud/smb2'))({
        share: args.smb_share,
        domain: '',
        username: args.smb_user,
        password: args.smb_pw,
        autoCloseTimeout : 30
      });
      let stream = await args.droptoken.getStream();

      /* 
      **********************************************************
       Buffer
      ********************************************************** 
      */
      let buffer = await this.stream2buffer(stream);
      await smb2Client.writeFile(filename, buffer );
      await smb2Client.disconnect();

      /* 
      **********************************************************
       Stream
      ********************************************************** 
      */
      
      // let writeStream = await smb2Client.createWriteStream(filename);
      // writeStream
      //   .on("close", async () => {
      //     this.log("SMB-Stream closed");
      //     await smb2Client.disconnect();
      //     // writeStream = null;
      //     // smb2Client = null;
      //   })
      //   .on("error", async (error) => {
      //     this.log("SMB-Stream error: "+ error.message);
      //   });
      // stream.pipe(writeStream);

      // let writeStream = await smb2Client.createWriteStream(filename);
      // stream.pipe(writeStream)
      //   .on("finish", async () => {
      //     this.log("Stream ended");
      //   })
      //   .on("close", async () => {
      //     this.log("SMB-Stream closed");
      //     // writeStream.end();
      //     // writeStream.destroy();
      //     await smb2Client.disconnect();
      //     // await smb2Client.close();
      //     // writeStream = null;
      //     // smb2Client = null;
      //   })
      //   .on("error", async (error) => {
      //     this.log("SMB-Stream error: "+ error.message);
      //   });
        
    }
    catch (error){
      this.error("Error writing file " + filename + ": " + error.message);
      throw error;
    }

  }

  async exportSnapshotFtp(args){
    // FTP Export of an image token
    let tz  = this.homey.clock.getTimezone();
    let now = new Date().toLocaleString('en-US', 
    { 
        hour12: false, 
        hourCycle: 'h23',
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
    let date = now.split(", ")[0];
    date = date.split("/")[2] + "-" + date.split("/")[0] + "-" + date.split("/")[1]; 
    let time = now.split(", ")[1];    
    time = time.split(":")[0] + "-" + time.split(":")[1] + "-" + time.split(":")[2]; 
    
    let filename = date + "_" + time;
    if (args.camera_name){
      filename = filename + "_" + args.camera_name;
    }
    filename = filename + ".jpg";

    this.log("Export Image to FTP: "+args.ftp_host+":"+args.ftp_port+"\\"+filename);

    // create an FTP instance
    try{
      let stream = await args.droptoken.getStream();
      /* 
      **********************************************************
       Buffer
      ********************************************************** 
      */
      let buffer = await this.stream2buffer(stream);

      await this.exportFtp(args, filename, buffer);
      // let ftpClient = new (require('ftp'));
      // ftpClient.on('ready', function() {
      //   ftpClient.put(buffer, filename, function(err) {
      //     if (err) throw err;
      //     ftpClient.end();
      //   });
      // });
      // // connect to localhost:21 as anonymous
      // ftpClient.connect(
      //   {
      //     host: args.ftp_host,
      //     port: args.ftp_port,
      //     user: args.ftp_user,
      //     password: args.ftp_pw
      //   }
      // );
        
    }
    catch (error){
      this.error("Error writing file " + filename + ": " + error.message);
      throw error;
    }
  }

  exportFtp(args, filename, buffer){
    return new Promise((resolve, reject) => {

        let ftpClient = new (require('ftp'));
        ftpClient.on('ready', function() {
            ftpClient.put(buffer, filename, function(err) {
                if (err) throw err;
                ftpClient.end();
                resolve(true);
            });
        });
        ftpClient.on('error', (error) => {
            reject(error);
        });
        // connect to localhost:21 as anonymous
        ftpClient.connect(
            {
                host: args.ftp_host,
                port: args.ftp_port,
                user: args.ftp_user,
                password: args.ftp_pw
            }
        );        
    });
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
  
module.exports = blinkApp;