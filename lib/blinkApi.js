'use strict';

const https = require('https');
const { resolve } = require('path');
// const fetch = require('node-fetch');


const LOGIN_SERVER = 'rest-prod.immedia-semi.com';
const HTTPS_PORT = 443;
const MAX_SNAPSHOT_ATTEMPTS = 10;

class blinkApi {    
    constructor() {
        this._region = null;
        this._autToken = null;
        this._apiServer = null;
        this._clientId = null;
        this._account = null;
        this._pinCode = null;
        this._region = 'prde';
        this._autToken = '';
        this._client = { id: 0, verification_required: true };
        this._homescreen = null;
    }

    login(email, pw, uid, notification_key) {
        return new Promise((resolve, reject) => {
            const payload = {
                // app_version: '6.0.7 (520300) #afb0be72a',
                client_name: 'Homey',
                // client_type: 'android',
                device_identifier: 'Homey Blink App',
                email: email,
                notification_key: notification_key,
                // os_version: '5.1.1',
                password: pw,
                reauth: true,
                unique_id: uid
            }
            this._post('/api/v5/account/login', payload, true, false, true).then(response => {
                const result = JSON.parse(response);
                this._region = result.account.tier;
                this._autToken = result.auth.token;
                this._account = result.account;
                this._clientId = result.account.client_id;
                this._apiServer = "rest-" + this._region + ".immedia-semi.com";
                resolve(result);
            }).catch(error => reject(error));
        });
    }

    verifyPin(pinCode) {
        return new Promise((resolve, reject) => {
            const payload = {
                pin: pinCode,
            }
            this._post(`/api/v4/account/${this._account.account_id}/client/${this._clientId}/pin/verify`, payload, true, true).then(response => {
                const result = JSON.parse(response);
               if (result.valid) {
                   return resolve(result);
               }
               console.log(result);
               return reject(new Error('Invalid PIN'));
            }).catch(error => reject(error));
        });
    }

    getSubscriptions(){
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            let endpoint = "/api/v1/accounts/" + this._account.account_id + "/subscriptions/plans";
            this._get(endpoint, null, false).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                     reject("Error during deserialization: " + result);
                } else {
                    resolve(result);
                }
            })
            .catch(error => reject(error));
        });
    }

    hasSubscription(){
        return new Promise( async (resolve, reject) => {
            try{
                let result = await this.getSubscriptions(); 
                if (result.subscriptions.length == 0){
                    resolve(false);
                }
                else{
                    resolve(true);
                }
            }
            catch(error){
                reject(error);
            }
        });
    }

    getHomescreen() {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            let endpoint = "/api/v3/accounts/" + this._account.account_id + "/homescreen";
            this._get(endpoint, null, false).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                     reject("Error during deserialization: " + result);
                } else {
                    this._homescreen = result;
                    resolve(result);
                }
            })
            .catch(error => reject(error));
        });
    }    

    
    getBufferedHomescreen(buffered = true) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            if (buffered && this._homescreen){
                resolve(this._homescreen);
            }
            else{
                this.getHomescreen().then(result => {
                    resolve(result);
                })
                .catch(error => reject(error));
            }
        });
    }    

    getSystems() {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            const payload = {
            }
            let endpoint = "/networks";
            this._get(endpoint, payload).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                    reject("Error during deserialization: " + response);
                } else {
                    resolve(result.networks);
                }
            }).catch(error => reject(error));
        });
    }

    getSyncmoduleStorage(systemId, syncmoduleId) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            const payload = {
            }
            let endpoint = "/api/v1/accounts/"+ this._account.account_id+"/networks/"+systemId+"/sync_modules/"+syncmoduleId+"/local_storage/status";
            this._get(endpoint, payload).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                    reject("Error during deserialization: " + response);
                } else {
                    resolve(result);
                }
            }).catch(error => reject(error));
        });
    }

    armSystem(id) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            const payload = {
            }
            let endpoint = "/network/" + id + "/arm";
            this._post(endpoint, payload).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                    reject("Error during deserialization: " + response);
                } else {
                    resolve();
                }
            }).catch(error => reject(error));
        });
    }

    disarmSystem(id) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            const payload = {
            }
            let endpoint = "/network/" + id + "/disarm";
            this._post(endpoint, payload).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                    reject("Error during deserialization: " + response);
                } else {
                    resolve();
                }
            }).catch(error => reject(error));
        });
    }

    /* Get cameras
     * type:
     * 0 = alle
     * 1 = Indoor/Outdoor
     * 2 = Mini (OWL)
     */
    getCameras(type = 0, buffered = true) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            this.getBufferedHomescreen(buffered).then(result => {
                var devices = [];
                var networks = [];
                for (var i = 0; i < result.networks.length; i++) {
                    // networks[result.networks[i].id] = result.networks[i].name;
                    let network = {  
                        id: result.networks[i].id, 
                        name: result.networks[i].name };
                    networks.push(network);
                }
                if (type == 0 || type == 1){
                    for (var i = 0; i < result.cameras.length; i++) {
                        let device_list = result.cameras[i];
                        let network = networks.find(network => network.id === device_list.network_id);
                        let device = {
                            "id": device_list.id,
                            "name": device_list.name,
                            "systemId": device_list.network_id,
                            "systemName": network.name,
                            "type": 1,
                            "data": device_list
                        }
                        devices.push(device);
                    }
                }
                if (type == 0 || type == 2){
                    for (var i = 0; i < result.owls.length; i++) {
                        let device_list = result.owls[i];
                        let network = networks.find(network => network.id === device_list.network_id);
                        let device = {
                            "id": device_list.id,
                            "name": device_list.name,
                            "systemId": device_list.network_id,
                            "systemName": network.name,
                            "type": 2,
                            "data": device_list
                        }
                        devices.push(device);
                    }
                }
                resolve(devices);
            }).catch(error => reject(error));
        });
    }

    getCamera(id, buffered = true) {
        return new Promise((resolve, reject) => {
            // search for cameras (Indoor/Outdoor)
            this.getCameras(0, buffered).then( (cameras) => {
                let camera = cameras.find(camera => camera.id === id);
                resolve(camera);
            }).catch(error => reject(error));
        });
    }

    /* Get cameras
     * type:
     * 1 = Indoor/Outdoor
     * 2 = Mini (OWL)
     */
    enableCameraMotion(id) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            this.getCamera(id).then(camera => {
                let systemId = camera.systemId;
                let cameraType = camera.type;

                let payload = {
                };
                let endpoint = "";
                if (cameraType == 1){
                    endpoint = "/network/" + systemId + "/camera/" + id + "/enable";
                }
                if (cameraType == 2){
                    endpoint = "/api/v1/accounts/" + this._account.account_id + "/networks/" + systemId + "/owls/" + id + "/config";
                    payload = {
                        "enabled": true
                    }
                }
                this._post(endpoint, payload).then(response => {
                    const result = JSON.parse(response);
                    if (result == null) {
                        reject("Error during deserialization: " + response);
                    } else {
                        resolve();
                    }
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        });
    }

    disableCameraMotion(id) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            this.getCamera(id).then(camera => {
                let systemId = camera.systemId;
                let cameraType = camera.type;

                let payload = { };
                let endpoint = "";
                if (cameraType == 1){
                    endpoint = "/network/" + systemId + "/camera/" + id + "/disable";
                }
                if (cameraType == 2){
                    endpoint = "/api/v1/accounts/" + this._account.account_id + "/networks/" + systemId + "/owls/" + id + "/config";
                    payload = {
                        "enabled": false
                    }
                }
                this._post(endpoint, payload).then(response => {
                    const result = JSON.parse(response);
                    if (result == null) {
                        reject("Error during deserialization: " + response);
                    } else {
                        resolve();
                    }
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        });
    }

    requestCameraVideo(id) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            this.getCamera(id).then(camera => {
                let systemId = camera.systemId;
                let cameraType = camera.type;

                let payload = { };
                let endpoint = "";
                if (cameraType == 1){
                    endpoint = "/network/" + systemId + "/camera/" + id + "/clip";
                }
                if (cameraType == 2){
                    endpoint = "/api/v1/accounts/" + this._account.account_id +"/networks/" + systemId + "/owls/" + id + "/clip";
                }
                this._post(endpoint, payload).then(response => {
                    const result = JSON.parse(response);
                    if (result == null) {
                        reject("Error during deserialization: " + response);
                    } else {
                        resolve();
                    }
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        });
    }

    getNewCameraSnapshotUrl(id) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            /**
             * 10-try retrival of camera image with wait time of 1 sec between
             * 1) Read old snapshot URL
             * 2) Call the Blink API to generate a snapshot
             * 3) Try to get a new (different) snapshot URL
             * 4a) Take the new URL to read the image
             * 4b) If no new URL is available, a exceptiomn in thrown to show an error 
             *      in Homey app and clear the stream/image 
             */
            this.getCamera(id)
            .then(camera => {
                if (!camera) {
                    reject('_getNewSnapshotUrl() -> GetCamera ->', 'failed get url from new snapshot');
                }
                let oldURL = camera.data.thumbnail;
                console.log('old URL: ' + oldURL);

                console.log("_getNewSnapshotUrl -> captureSnapshot()");
                this.captureSnapshot(id)
                .then(() => {
                    this._getCameraSequential(0, id, oldURL)
                        .then(camera => {
                            resolve(camera.data.thumbnail);
                        })
                        .catch(error => reject(error));
                    })
                .catch(error => reject('_getNewSnapshotUrl() -> captureSnapshot() -> failed create new snapshot -> ' + error));
            })
            .catch(error => reject(error));
        });
    }

    captureSnapshot(cameraID) {
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            this.getCamera(cameraID).then(camera => {
                let networkID = camera.data.network_id;
                let payload = { };
                let endpoint = "";
                console.log("captureSnapshot() => CameraID "+cameraID+" NetworkID "+networkID);
                if (camera.type == 1){
                    endpoint = "/network/" + networkID + "/camera/" + cameraID + "/thumbnail";
                }
                if (camera.type == 2){
                    endpoint = "/api/v1/accounts/" + this._account.account_id +"/networks/" + networkID + "/owls/" + cameraID + "/thumbnail";
                }
                this._post(endpoint, payload).then(response => {
                    const result = JSON.parse(response);
                    if (result == null) {
                        reject("Error during deserialization: " + response);
                    } else {
                        console.log('Created snapshot for camera ' + cameraID);
                        resolve();
                    }
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        });
    }
    
    _getCameraSequential(count, cameraID, compareURL) {
        return new Promise((resolve, reject) => {
            if (count == undefined) {count = 0}
            count++;
            console.log('_getCameraSequential - Step ['+count+'] -> getCamera()');
            this.getCamera(cameraID, false)
                .then(camera => {
                    if (!camera) {
                        reject('_getCameraSequential() -> getCamera ->', 'failed get url from new snapshot');
                    }
                    console.log("_getCameraSequential -> resolve(response.thumbnail)");
                    let newURL = camera.data.thumbnail;
                    console.log('new URL: '+newURL); 
                    if (newURL != compareURL  || count == MAX_SNAPSHOT_ATTEMPTS ){
                        if (count == MAX_SNAPSHOT_ATTEMPTS){
                            reject('No new Snapshot URL found!');
                        }
                        console.log('Step [' + count + '] - newURL found! exit...');
                        resolve(camera);
                    }
                    else {
                        console.log('Step [' + count + '] - same URL found! continue after '+'1'+' seconds');
                        this.sleep( 1000 ).then(sleep => {
                            this._getCameraSequential(count, cameraID, compareURL)
                            .then(camera => resolve(camera) )
                            .catch(error => reject(error));
                        }).catch(error => reject(error));
                    }
                })
                .catch(error => reject(error));
        }); 
    }

    getNewCameraSnapshotImageStream(url) {
        console.log("getNewCameraSnapshotImageStream()");
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            if (!url) {
                reject('getNewCameraSnapshotImageStream(): no image url available');
            }
            const payload = {
            }
            let endpoint = url +".jpg";
            const options = {
                host: (this._apiServer ? this._apiServer : LOGIN_SERVER),
                port: HTTPS_PORT,
                path: `${endpoint}${this._toQueryString(payload)}`,
                method: 'GET',
                headers: {
                    'TOKEN_AUTH': this._autToken,
                    'Content-Type': 'image/jpeg',
                },
                maxRedirects: 20,
                //rejectUnauthorized: false,
                keepAlive: false,
                //secureProtocol: 'TLSv1_2_method',
            };

            const req = https.request(options, res => {
                if (res.statusCode !== 200) {
                    return reject('Failed to GET to url: '+options.host+options.path+' status code: '+res.statusCode);
                }
                console.log("Image Stream received");
                return resolve(res);
            })
            .on('error', (error) => reject(error))
            .end();
        });
    }

    getNewCameraSnapshotImage(url) {
        console.log("getNewCameraSnapshotImage()");
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            if (!url) {
                reject('getNewCameraSnapshotImage(): no image url available');
            }
            const payload = {
            }
            let endpoint = url +".jpg";
            const options = {
                host: (this._apiServer ? this._apiServer : LOGIN_SERVER),
                port: HTTPS_PORT,
                path: `${endpoint}${this._toQueryString(payload)}`,
                method: 'GET',
                headers: {
                    'TOKEN_AUTH': this._autToken,
                    'Content-Type': 'image/jpeg',
                },
                maxRedirects: 20,
                //rejectUnauthorized: false,
                keepAlive: false,
                //secureProtocol: 'TLSv1_2_method',
            };

            const req = https.request(options, res => {
                if (res.statusCode !== 200) {
                    return reject('Failed to GET to url: '+options.host+options.path+' status code: '+res.statusCode);
                }
                const data = [];
                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    console.log("Image received");
                    return resolve(data.join(''));
                });
            })
            .on('error', (error) => reject(error))
            .end();
        });
    }

    getSyncModuleStorage(systemId, syncmoduleId){
        // console.log("getSyncModuleStorage()");
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            let endpoint = '';
            endpoint = "/api/v1/accounts/" + this._account.account_id + "/networks/" + systemId  + "/sync_modules/" + syncmoduleId + "/local_storage/manifest/request";
            const payload = '';
            this._post(endpoint, payload).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                    reject("Error during deserialization: " + response);
                } 
                else {
                    let result = JSON.parse(response);
                    let endpoint = "/api/v1/accounts/" + this._account.account_id + "/networks/" + systemId  + "/sync_modules/" + syncmoduleId + "/local_storage/manifest/request/" + result.id;
                    
                    this.sleep( 1000 ).then(sleep => {
                        this._get(endpoint, null, false, [400]).then(response => {
                            const result = JSON.parse(response);
                            if (result == null) {
                                reject("Error during deserialization: " + response);
                            } 
                            else {
                                resolve(result);
                            }   
                        }).catch(error => reject(error));                                    
                    }).catch(error => reject(error));
                }
            }).catch(error => reject(error));
        });
    }

    getCloudStorage(timestamp){
        // console.log("getCloudStorage()");
        return new Promise((resolve, reject) => {
            if (!this._account){
                reject('Not logged in');
            }
            const payload = {
                since: timestamp,
                page: 0
            }
            let endpoint = "/api/v1/accounts/" + this._account.account_id + "/media/changed";
            this._get(endpoint, payload, false).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                     reject("Error during deserialization: " + result);
                } else {
                    resolve(result);
                }
            })
            .catch(error => reject(error));
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    generate_uid(length) {
        //edit the token allowed characters
        var a = "abcdef1234567890".split("");
        var b = [];
        for (var i=0; i<length; i++) {
            var j = (Math.random() * (a.length-1)).toFixed(0);
            b[i] = a[j];
        }
        return b.join("");
    }

    _post(endpoint, payload, json = true, ignoreError = false, dontLogin = false) {
        return new Promise((resolve, reject) => {

            if (!dontLogin && this._autToken === '')
            {
                reject(new Error('[_get] Not logged in yet!'));
            }

            if (json) {
                payload = JSON.stringify(payload);
            }

            const options = {
                host: (this._apiServer ? this._apiServer : LOGIN_SERVER),
                port: HTTPS_PORT,
                path: endpoint,
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                maxRedirects: 20,
                //rejectUnauthorized: false,
                keepAlive: false,
               //secureProtocol: 'TLSv1_2_method',
            };

            if (this._autToken) {
                options.headers['TOKEN_AUTH'] = this._autToken;
            }

            // console.log("API-POST: "+this._apiServer+endpoint);
            // console.log(options);
            // console.log(payload);

            const req = https.request(options, res => {
                if (!ignoreError && res.statusCode !== 200) {
                    console.log(`Failed to POST to url: ${options.host}${options.path} (status code: ${res.statusCode})`);
                    return reject( new Error(`Failed to POST to url: ${options.host}${options.path} (status code: ${res.statusCode})`));
                }
                res.setEncoding('utf8');
                const data = [];

                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    return resolve(data.join(''));
                });
            });

            req.on('error', (error) => reject(error));
            req.write(payload);
            req.end();
        });
    }

    _get(endpoint, payload, json = true, ignoreHttpErrors=[]) {
        return new Promise((resolve, reject) => {

            if (this._autToken === '')
            {
                reject(new Error('[_get] Not logged in yet!'));
            }

            if (json) {
                payload = JSON.stringify(payload);
            }

            const options = {
                host: (this._apiServer ? this._apiServer : LOGIN_SERVER),
                port: HTTPS_PORT,
                path: `${endpoint}${this._toQueryString(payload)}`,
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                maxRedirects: 20,
                //rejectUnauthorized: false,
                keepAlive: false,
                //secureProtocol: 'TLSv1_2_method',
            };

            if (this._autToken) {
                options.headers['TOKEN_AUTH'] = this._autToken;
            }

            const req = https.request(options, res => {
                if (res.statusCode !== 200) {
                    if ( (ignoreHttpErrors.length <= 0) || !(ignoreHttpErrors.find(code => code === res.statusCode)) ){
                        console.log('Failed to GET to url: '+options.host+options.path+' status code: '+res.statusCode);
                        return reject( new Error(`Failed to GET to url: ${options.host}${options.path} (status code: ${res.statusCode})`));
                    }
                    else{
                        console.log('Ignoring error for GET to url: '+options.host+options.path+' status code: '+res.statusCode);
                    }
                }
                // if (res.headers['content-type'] == 'image/jpeg'){
                //     return resolve(res);
                // }
                res.setEncoding('utf8');
                const data = [];

                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    return resolve(data.join(''));
                });
            });

            req.on('error', (error) => reject(error));
            req.end();
        });
    }

    // _getStream(endpoint, payload, json = true) {
    //     return new Promise((resolve, reject) => {

    //         if (this._autToken === '')
    //         {
    //             reject('[_get] Not logged in yet!');
    //         }

    //         if (json) {
    //             payload = JSON.stringify(payload);
    //         }
    //         let url = 'https://images.unsplash.com/photo-1623141099452-ab29757ab47f?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxzZWFyY2h8MXx8bnlhbnxlbnwwfHwwfHw%3D&auto=format&fit=crop&w=800&q=60';

    //         const options = {
    //             // host: (this._apiServer ? this._apiServer : LOGIN_SERVER),
    //             host: "images.unsplash.com",
    //             port: HTTPS_PORT,
    //             // path: `${endpoint}${this._toQueryString(payload)}`,
    //             path: "/photo-1623141099452-ab29757ab47f?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxzZWFyY2h8MXx8bnlhbnxlbnwwfHwwfHw%3D&auto=format&fit=crop&w=800&q=60",
    //             method: 'GET',
    //             headers: {
    //                 Accept: 'image/jpeg',
    //                 'Content-Type': 'image/jpeg',
    //             },
    //             maxRedirects: 20,
    //             //rejectUnauthorized: false,
    //             keepAlive: false,
    //             //secureProtocol: 'TLSv1_2_method',
    //         };

    //         if (this._autToken) {
    //             options.headers['TOKEN_AUTH'] = this._autToken;
    //         }

    //         // const req = http.request(options, res => {
    //         const req = https.request(url, res => {
    //             if (res.statusCode !== 200) {
    //                 return reject('Failed to GET to url: '+options.host+options.path+' status code: '+res.statusCode);
    //             }
    //             // res.setEncoding('utf8');
    //             const data = [];
    //             return resolve(res);
    //             // res.on('data', chunk => data.push(chunk));
    //             // res.on('end', () => {
    //             //     return resolve(res);
    //             // });
    //         })
    //         .on('error', (error) => reject(error))
    //         .end();
    //     });
    // }

    _toQueryString(obj) {
        if (obj === null || typeof obj === 'undefined' || Object.keys(obj).length === 0) {
            return '';
        }
        return `?${Object.keys(obj)
            .map(k => `${k}=${encodeURIComponent(obj[k])}`)
            .join('&')}`;
    }

}

module.exports = blinkApi;