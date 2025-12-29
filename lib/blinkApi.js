'use strict';

const https = require('https');
const { resolve } = require('path');
// const fetch = require('node-fetch');
const crypt = require('./crypt');

const API_BASE_URL = 'rest-prod.immedia-semi.com';
const HTTPS_PORT = 443;
const MAX_SNAPSHOT_ATTEMPTS = 10;
// const APP_BUILD = "ANDROID_28373244";
// const DEFAULT_USER_AGENT = "27.0ANDROID_28373244";

const OAUTH_DEVICE_BRAND = "Athom";
const OAUTH_DEVICE_MODEL = "HomeyPro"
const OAUTH_REMEMBER_ME = "true";

const OAUTH_USER_AGENT = 
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/26.1 Mobile/15E148 Safari/604.1";
const OAUTH_CLIENT_ID = "ios";
const OAUTH_TOKEN_USER_AGENT = "Blink/2511191620 CFNetwork/3860.200.71 Darwin/25.1.0";

// const DEVICE_ID = "HomeyApp";
// const OAUTH_CLIENT_ID = "android";
const OAUTH_GRANT_TYPE_PASSWORD = "password";
const OAUTH_GRANT_TYPE_REFRESH_TOKEN = "refresh_token";
const OAUTH_SCOPE = "client";

const OAUTH_SIGNING_RESULT_SUCCESS = "SUCCESS";
const OAUTH_SIGNING_RESULT_2FA_REQUIRED = "2FA_REQUIRED";

const OAUTH_BASE_URL  = "api.oauth.blink.com";
const OAUTH_AUTHORIZE_ENDPOINT = "/oauth/v2/authorize";
const OAUTH_SIGNIN_ENDPOINT = "/oauth/v2/signin";
const OAUTH_2FA_VERIFY_ENDPOINT = "/oauth/v2/2fa/verify";
const OAUTH_LOGIN_ENDPOINT = "/oauth/token";
const OAUTH_TOKEN_ENDPOINT = "/oauth/token";
const TIER_ENDPOINT = "/api/v1/users/tier_info";
const OAUTH_REDIRECT_URI = "immedia-blink://applinks.blink.com/signin/callback";

class blinkApi {    
    constructor() {
        this._user = null;
        this._deviceId = null;
        this._region = null;
        this._authToken = null;
        this._apiServer = null;
        this._accountIdId = null;
        this._region = 'prde';
        this._homescreen = null;
    }

    async init(user, deviceId, token) {
        console.log('Init Blink API with user: ' + user);
        this._user = user;
        this._deviceId = deviceId;
        this._authToken = token;

        // Refresh token
        this._authToken = await this.refreshToken();

        // Get TIER information (accountId, region)
        const tierInfo = await this._getTier();
        this._accountId = tierInfo.account_id;
        this._region = tierInfo.tier;

        return this._authToken;
    }

    async refreshToken(){
        console.log('Start Refresh token, user: ' + this._user);
        let formdata = {
            username: this._user,
            client_id: OAUTH_CLIENT_ID,
            scope: OAUTH_SCOPE,
            grant_type: OAUTH_GRANT_TYPE_REFRESH_TOKEN,
            refresh_token: this._authToken.refresh_token
        }
        let payload = this._toFormdataString(formdata);

        let headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": OAUTH_USER_AGENT,
            "hardware_id": this._deviceId,
        }

        let response = await this._http('POST', OAUTH_BASE_URL, OAUTH_LOGIN_ENDPOINT, payload, headers);
        const result = JSON.parse(response.body);
        console.log('Refresh token, user: ' + this._user, 'Token: ', result);
        return result;
    }

    async oAuthLogin(user, pw, deviceId) {
        
        // Step 1: Generate PKCE
        const {code_verifier, code_challenge } = crypt.generatePkcePair();    

        // Step 2: Authorization request
        let auth_success = await this._oAuthAuthorizeRequest( deviceId, code_challenge );

        // Step 3: Get CSRF token
        const csrf_token = await this._oAuthGetSigninPage();

        // Step 4: Login
        let login_result = await this._oAuthSignin( user, pw, csrf_token);

        // Step 4b: Handle 2FA if needed
        if ( login_result == OAUTH_SIGNING_RESULT_2FA_REQUIRED ){
            // Store CSRF token and verifier for later use
            this._oauth_code_verifier = code_verifier;
            this._oauth_code_challenge = code_challenge;        
            this._oauth_csrf_token = csrf_token;
            this._oauth_device_id = deviceId;

            // Raise exception to let the app handle 2FA prompt
            console.log("Two-factor authentication required.")
            let error = new Error("Two-factor authentication required.");
            error.code = 412;
            throw error;
        }
        else if ( login_result != OAUTH_SIGNING_RESULT_SUCCESS ){
            console.log("Login failed. _oAuthSignin result != SUCCESS");
            throw new Error("Login failed.");
        }

        // Step 5: Get authorization code
        let code = await this._oAuthGetAuthorizationCode();
        if (!code){
            console.log("Failed to get authorization code")
            throw new Error("Failed to get authorization code");
        }
        // Step 6: Exchange code for token
        this._authToken = await this._oAuthExchangeCodeForToken( code, code_verifier, deviceId );

        // Return token data
        
        let tier = await this._getTier();

        this._accountId = tier.account_id;
        this._region = tier.tier;
        let loginData = {
            token: this._authToken,
            account: this._accountId,
            region: this._region
        }
        return(loginData);
    }

    async oAuthComplete2faLogin(twofa_code){
        // get cashed data from oAuth start
        const code_verifier = this._oauth_code_verifier;
        const csrf_token = this._oauth_csrf_token;
        const deviceId = this._oauth_device_id;

        if (!code_verifier || !csrf_token){
            console.log("Two-factor authentication failed. Code verifier or CSRF token not found.");
            throw new Error("Two-factor authentication failed. Code verifier or CSRF token not found.");
        }

        // Verify 2FA
        await this._oAuthVerify2fa(csrf_token, twofa_code);

        // Step 5: Get authorization code
        let code = await this._oAuthGetAuthorizationCode();
        if (!code){
            console.log("Failed to get authorization code after 2FA")
            throw new Error("Failed to get authorization code after 2FA");
        }
        // Step 6: Exchange code for token
        this._authToken = await this._oAuthExchangeCodeForToken( code, code_verifier, deviceId );

        // Return token data
        
        let tier = await this._getTier();

        this._accountId = tier.account_id;
        this._region = tier.tier;
        let loginData = {
            token: this._authToken,
            account: this._accountId,
            region: this._region
        }
        return(loginData);
    }

    async _oAuthAuthorizeRequest( deviceId, code_challenge ){
        console.log('HTTP GET _oAuthAuthorizeRequest');
        let headers = {
            "User-Agent": OAUTH_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
        }
        let params = {
            "app_brand": "blink",
            "app_version": "50.1",
            "client_id": OAUTH_CLIENT_ID,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",

            // "device_brand": "Apple",
            // "device_model": "iPhone16,1",
            // "device_os_version": "26.1",
            "device_brand": OAUTH_DEVICE_BRAND, // "Athom",
            "device_model": OAUTH_DEVICE_MODEL, //"HomeyPro",
            // "device_os_version": "10",

            "hardware_id": deviceId,
            "redirect_uri": OAUTH_REDIRECT_URI,
            "response_type": "code",
            "scope": OAUTH_SCOPE,
        }
        try{
            let response = await this._http('GET', OAUTH_BASE_URL, OAUTH_AUTHORIZE_ENDPOINT + this._toQueryString(params), '', headers);
            console.log('Result: http 200, continue');
        }
        catch(error){
            if (error.code === 302){
                
                // Extract only the key=value part from each cookie
                const filteredCookies = error.headers["set-cookie"].map(cookie => cookie.split("; ")[0]);
                // Join them into a single string for the Cookie header
                const cookieHeader = filteredCookies.join("; ");

                // Remember Cookie during authorization
                this._oAuthCookie = cookieHeader;

                console.log('Result: http 302, continue');
                return true;
            }
        }
    }


    async _oAuthGetSigninPage(){
        let headers = {
            "User-Agent": OAUTH_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": this._oAuthCookie
        }

        let result = await this._http('GET', OAUTH_BASE_URL, OAUTH_SIGNIN_ENDPOINT, '', headers);
        
        const regex = /"csrf-token"\s*:\s*"([^"]+)"/;
        const csrf_token = result.body.match(regex);

        if (!csrf_token && !csrf_token[1]){
            console.log('CSRF token not found in response');
            throw new Error('CSRF token not found in response');
        }

        console.log('CSRF token: ' + csrf_token[1]);
        return csrf_token[1];
    }

    async _oAuthSignin( user, password, csrf_token){
        let headers = {
            "User-Agent": OAUTH_USER_AGENT,
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            // "Content-Type": "application/json",
            "Origin": "https://api.oauth.blink.com",
            "Referer": "https://" + OAUTH_BASE_URL + OAUTH_SIGNIN_ENDPOINT,
            "Cookie": this._oAuthCookie
        }
        let data = {
            "username": user,
            "password": password,
            "csrf-token": csrf_token,
        }
        try{
            await this._http('POST', OAUTH_BASE_URL, OAUTH_SIGNIN_ENDPOINT, 
                this._toFormdataString(data), 
                // JSON.stringify(data),
                headers);
        }
        catch(error){
            if ( error.code == 412 ){
                // 2FA required
                console.log('_oAuthSignin(): http 412: Two-factor authentication required.');
                return OAUTH_SIGNING_RESULT_2FA_REQUIRED;
            }
            else if ( [301, 302, 303, 307, 308].includes(error.code)){
                // Success without 2FA
                console.log('_oAuthSignin(): http ' + error.code + '.  Success without 2FA.' );
                return OAUTH_SIGNING_RESULT_SUCCESS;
            }
        }
        // Success without 2FA
        console.log('_oAuthSignin(): http 20/201. Success without 2FA.');
        return OAUTH_SIGNING_RESULT_SUCCESS;
    }

    async _oAuthVerify2fa( csrf_token, twofa_code ){
        let headers = {
            "User-Agent": OAUTH_USER_AGENT,
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://api.oauth.blink.com",
            "Referer": "https://" + OAUTH_BASE_URL + OAUTH_SIGNIN_ENDPOINT,
            "Cookie": this._oAuthCookie
        }
        let data = {
            "2fa_code": twofa_code,
            "csrf-token": csrf_token,
            "remember_me": OAUTH_REMEMBER_ME,
        }

        let response = await this._http('POST', OAUTH_BASE_URL, OAUTH_2FA_VERIFY_ENDPOINT, this._toFormdataString(data), headers);
        const result = JSON.parse(response.body);
        if (!result.status == "auth-completed"){
            console.log("2FA verification failed");
            throw new Error("2FA verification failed");
        }
    }

    async _oAuthGetAuthorizationCode(){
        let headers = {
            "User-Agent": OAUTH_USER_AGENT,
            "Accept": "*/*",
            "Referer": "https://" + OAUTH_BASE_URL + OAUTH_SIGNIN_ENDPOINT,
            "Cookie": this._oAuthCookie
        }

        try{
            let response = await this._http('GET', OAUTH_BASE_URL, OAUTH_AUTHORIZE_ENDPOINT, '', headers);
        }
        catch (error){
            if ([301, 302, 303, 307, 308].includes(error.code) && error.headers.location ){
                let url = error.headers.location;

                // Extract code from URL: https://blink.com/.../end?code=XXX&state=YYY
                const parsedUrl = new URL(url);
                // Extract the 'code' query parameter
                const code = parsedUrl.searchParams.get("code");

                if (code){
                    return code;
                }
                else{
                    throw new Error("Failed to get authorization code");
                }
            }      
        }
        throw new Error("Failed to get authorization code");
    }

    async _oAuthExchangeCodeForToken( code, code_verifier, deviceId){
        let headers = {
            "User-Agent": OAUTH_TOKEN_USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "*/*",
        }
        let data = {
            "app_brand": "blink",
            "client_id": OAUTH_CLIENT_ID,
            "code": code,
            "code_verifier": code_verifier,
            "grant_type": "authorization_code",
            "hardware_id": deviceId,
            "redirect_uri": OAUTH_REDIRECT_URI,
            "scope": OAUTH_SCOPE
        }
        let response = await this._http('POST', OAUTH_BASE_URL, OAUTH_TOKEN_ENDPOINT, this._toFormdataString(data), headers);
        let result = JSON.parse(response.body);
        console.log("Token: ",result);
        return result;
    }

    // async oAuthLogin(user, pw, pin, deviceId) {
    //     let formdata = {
    //         username: user,
    //         client_id: OAUTH_CLIENT_ID,
    //         scope: OAUTH_SCOPE,
    //         grant_type: OAUTH_GRANT_TYPE_PASSWORD,
    //         password: pw,
    //         // device_brand: 'Homey Blink App',
    //         // device_model: 'Homey ID ' + deviceId,
    //         // client_name: 'Homey',
    //         // device_identifier: 'Homey Blink App',
    //     }
    //     let payload = this._toFormdataString(formdata);

    //     let headers = {
    //         "Content-Type": "application/x-www-form-urlencoded",
    //         "User-Agent": DEFAULT_USER_AGENT,
    //         "hardware_id": deviceId,
    //     }
    //     //Add 2FA code to headers if provided
    //     if ( pin != undefined && pin != ''){
    //         headers["2fa-code"] = pin;
    //     }

    //     let response = await this._http('POST', OAUTH_BASE_URL, OAUTH_LOGIN_ENDPOINT, payload, headers);
    //     const result = JSON.parse(response);
    //     console.log(result);
    //     this._authToken = result;
    //     // this._apiServer = "rest-" + this._region + ".immedia-semi.com";

    //     let tier = await this._getTier();

    //     this._accountId = tier.account_id;
    //     this._region = tier.tier;
    //     let loginData = {
    //         token: this._authToken,
    //         account: this._accountId,
    //         region: this._region
    //     }
    //     return(loginData);
    // }

    async _getTier(){
        console.log('Get TIER information');
        let headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": OAUTH_USER_AGENT
        }
        let response = await this._http('GET', API_BASE_URL, TIER_ENDPOINT, '', headers);
        const result = JSON.parse(response.body);
        console.log(result);
        
        return result;
    }

    getRegionalUrl() {
        return "rest-" + this._region + ".immedia-semi.com";
    }

    getSubscriptions(){
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('Not logged in');
            }
            let endpoint = "/api/v1/accounts/" + this._accountId + "/subscriptions/plans";
            this._get(endpoint, null).then(response => {
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
                if (result.subscriptions.length == 0 || result.subscriptions.filter((e) => {return e.active}).length == 0){
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

    async getSubscriptionType(){
        return new Promise( async (resolve, reject) => {
            try{
                let result = await this.getSubscriptions(); 
                let subscription = result.subscriptions.filter((e) => {return e.active});
                if (subscription.length > 0){
                    if (subscription[0].flat_type == 'basic'){
                        resolve('mix');
                    }
                    else{
                        resolve('cloud');
                    }
                }
                else{
                    resolve('local');
                }
            }
            catch(error){
                reject(error);
            }
        });
    }

    getHomescreen() {
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('Not logged in');
            }
            let endpoint = "/api/v3/accounts/" + this._accountId + "/homescreen";
            this._get(endpoint, null).then(response => {
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
            if (!this._accountId){
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
            if (!this._accountId){
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
            if (!this._accountId){
                reject('Not logged in');
            }
            const payload = {
            }
            let endpoint = "/api/v1/accounts/"+ this._accountId+"/networks/"+systemId+"/sync_modules/"+syncmoduleId+"/local_storage/status";
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
            if (!this._accountId){
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
            if (!this._accountId){
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
     * 3 = Doorbell
     */
    getCameras(type = 0, buffered = true) {
        return new Promise((resolve, reject) => {
            if (!this._accountId){
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
                if (type == 0 || type == 3){
                    for (var i = 0; i < result.doorbells.length; i++) {
                        let device_list = result.doorbells[i];
                        let network = networks.find(network => network.id === device_list.network_id);
                        let device = {
                            "id": device_list.id,
                            "name": device_list.name,
                            "systemId": device_list.network_id,
                            "systemName": network.name,
                            "type": 3,
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
     * 3 = Doorbell
     */
    enableCameraMotion(id) {
        return new Promise((resolve, reject) => {
            if (!this._accountId){
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
                    endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + systemId + "/owls/" + id + "/config";
                    payload = {
                        "enabled": true
                    }
                }
                if (cameraType == 3){
                    endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + systemId + "/doorbells/" + id + "/config";
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
            if (!this._accountId){
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
                    endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + systemId + "/owls/" + id + "/config";
                    payload = {
                        "enabled": false
                    }
                }
                if (cameraType == 3){
                    endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + systemId + "/doorbells/" + id + "/config";
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

    setCameraLight(cameraId, floodlightId, on) {
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('Not logged in');
            }
            this.getCamera(cameraId).then(camera => {
                let systemId = camera.systemId;

                let payload = { };
                let endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + systemId + "/cameras/" + cameraId + "/accessories/storm/" + floodlightId + "/lights";
                if (on){
                    endpoint = endpoint + '/on';
                }
                else{
                    endpoint = endpoint + '/off';
                }
                this._post(endpoint, payload).then(response => {
                    resolve();
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        });
    }

    requestCameraVideo(id) {
        return new Promise((resolve, reject) => {
            if (!this._accountId){
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
                    endpoint = "/api/v1/accounts/" + this._accountId +"/networks/" + systemId + "/owls/" + id + "/clip";
                }
                if (cameraType == 3){
                    endpoint = "/api/v1/accounts/" + this._accountId +"/networks/" + systemId + "/doorbells/" + id + "/clip";
                }
                this._post(endpoint, payload).then(response => {
                    const result = JSON.parse(response);
                    if (result == null) {
                        reject("Error during deserialization: " + response);
                    } else {
                        resolve(result);
                    }
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        });
    }

    getNewCameraSnapshotUrl(id) {
        return new Promise((resolve, reject) => {
            if (!this._accountId){
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
            if (!this._accountId){
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
                    endpoint = "/api/v1/accounts/" + this._accountId +"/networks/" + networkID + "/owls/" + cameraID + "/thumbnail";
                }
                if (camera.type == 3){
                    endpoint = "/api/v1/accounts/" + this._accountId +"/networks/" + networkID + "/doorbells/" + cameraID + "/thumbnail";
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
        // console.log("getNewCameraSnapshotImageStream()");
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('Not logged in');
            }
            if (!url) {
                reject('getNewCameraSnapshotImageStream(): no image url available');
            }
            const payload = {
            }
            let endpoint = url +".jpg";
            const options = {
                host: this.getRegionalUrl(),
                port: HTTPS_PORT,
                path: `${endpoint}${this._toQueryString(payload)}`,
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' +  this._authToken.access_token,
                    'Content-Type': 'image/jpeg'
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

    getCameraVideoStream(videoId) {
        // console.log("getCameraVideoStream()");
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('Not logged in');
            }
            switch (videoId.storage){
                case 'local':
                    this.getCameraVideoStreamLocal(videoId).then(stream=>{
                        resolve(stream);
                    })
                    .catch(error => reject(error));            
                    break;
                case 'cloud':
                    this.getCameraVideoStreamCloud(videoId.url).then(stream=>{
                        resolve(stream);
                    })
                    .catch(error => reject(error));            
                    break;
                default:
                    break;
            }
        });
    }

    getCameraVideoStreamLocal(videoId) {
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('getCameraVideoStreamLocal(): Not logged in');
            }
            if (!videoId.networkId){
                reject('getCameraVideoStreamLocal(): No SyncModule. Video not readable from local storage.');
            }
            let endpoint = '';
            endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + videoId.networkId  + "/sync_modules/" + videoId.syncmoduleId + "/local_storage/manifest/request";
            const payload = '';
            this._post(endpoint, payload).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                    reject("Error during deserialization: " + response);
                } 
                else {
                    let requestId = JSON.parse(response).id;
                    let endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + videoId.networkId  + "/sync_modules/" + videoId.syncmoduleId + "/local_storage/manifest/request/" + requestId;
                    
                    this.sleep( 1000 ).then(sleep => {
                        this._get(endpoint, null, [400]).then(response => {
                            const result = JSON.parse(response);
                            if (result == null) {
                                reject("Error during deserialization: " + response);
                            } 
                            else {
                                let manifestId = JSON.parse(response).manifest_id;
                                videoId["manifestId"] = manifestId; 
                                let endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + videoId.networkId  + "/sync_modules/" + videoId.syncmoduleId + "/local_storage/manifest/" + manifestId + "/clip/request/" + videoId.id;
                                
                                this.sleep( 1000 ).then(sleep => {
                                    const payload = '';
                                    this._post(endpoint, payload).then(response => {
                                        const result = JSON.parse(response);
                                        if (result == null) {
                                            reject("Error during deserialization: " + response);
                                        } 
                                        else {
                                            let endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + videoId.networkId  + "/sync_modules/" + videoId.syncmoduleId + "/local_storage/manifest/" + videoId.manifestId + "/clip/request/" + videoId.id;
                                           
                                            this.sleep( 1000 ).then(sleep => {
                                                const payload = {
                                                }
                                                const options = {
                                                    host: this.getRegionalUrl(),
                                                    port: HTTPS_PORT,
                                                    path: `${endpoint}${this._toQueryString(payload)}`,
                                                    method: 'GET',
                                                    headers: {
                                                        'Authorization': 'Bearer ' +  this._authToken.access_token,
                                                        'Content-Type': 'video/mp4',
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
                                                    // console.log("Video Stream received");
                                                    return resolve(res);
                                                })
                                                .on('error', (error) => reject(error))
                                                .end();
                                            }).catch(error => reject(error));
                                        }   
                                    }).catch(error => reject(error));                                    
                                }).catch(error => reject(error));
                            }   
                        }).catch(error => reject(error));                                    
                    }).catch(error => reject(error));
                }
            }).catch(error => reject(error));
        });
    }

    getCameraVideoStreamCloud(url) {
        // console.log("getCameraVideoStream()");
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('getCameraVideoStream(): Not logged in');
            }
            if (!url) {
                reject('getCameraVideoStream(): no video url available');
            }
            const payload = {
            }
            let endpoint = url;
            const options = {
                host: this.getRegionalUrl(),
                port: HTTPS_PORT,
                path: `${endpoint}${this._toQueryString(payload)}`,
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' +  this._authToken.access_token,
                    'Content-Type': 'video/mp4',
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
                // console.log("Video Stream received");
                return resolve(res);
            })
            .on('error', (error) => reject(error))
            .end();
        });
    }

    getNewCameraSnapshotImage(url) {
        // console.log("getNewCameraSnapshotImage()");
        return new Promise((resolve, reject) => {
            if (!this._accountId){
                reject('Not logged in');
            }
            if (!url) {
                reject('getNewCameraSnapshotImage(): no image url available');
            }
            const payload = {
            }
            let endpoint = url +".jpg";
            const options = {
                host: this.getRegionalUrl(),
                port: HTTPS_PORT,
                path: `${endpoint}${this._toQueryString(payload)}`,
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' +  this._authToken.access_token,
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
                    // console.log("Image received");
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
            if (!this._accountId){
                reject('Not logged in');
            }
            let endpoint = '';
            endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + systemId  + "/sync_modules/" + syncmoduleId + "/local_storage/manifest/request";
            const payload = '';
            this._post(endpoint, payload).then(response => {
                const result = JSON.parse(response);
                if (result == null) {
                    reject("Error during deserialization: " + response);
                } 
                else {
                    let result = JSON.parse(response);
                    let endpoint = "/api/v1/accounts/" + this._accountId + "/networks/" + systemId  + "/sync_modules/" + syncmoduleId + "/local_storage/manifest/request/" + result.id;
                    
                    this.sleep( 1000 ).then(sleep => {
                        this._get(endpoint, null, [400]).then(response => {
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
            if (!this._accountId){
                reject('Not logged in');
            }
            const payload = {
                since: timestamp,
                page: 0
            }
            let endpoint = "/api/v1/accounts/" + this._accountId + "/media/changed";
            this._get(endpoint, payload).then(response => {
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

    async _post(endpoint, payload) {
        // return new Promise((resolve, reject) => {

            if (!this._authToken)
            {
                reject(new Error('[_get] Not logged in yet!'));
            }

            if (payload instanceof Object) {
                payload = JSON.stringify(payload);
            }

            let headers = {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            };
            if (this._authToken) {
                headers['Authorization'] = 'Bearer ' +  this._authToken.access_token;
            }

            let response = await this._http('POST', this.getRegionalUrl(), endpoint, payload, headers);
            return response.body;

            // const options = {
            //     host: this.getRegionalUrl(),
            //     port: HTTPS_PORT,
            //     path: endpoint,
            //     method: 'POST',
            //     headers: {
            //         Accept: 'application/json',
            //         'Content-Type': 'application/json',
            //         'Content-Length': Buffer.byteLength(payload),
            //     },
            //     maxRedirects: 20,
            //     //rejectUnauthorized: false,
            //     keepAlive: false,
            //    //secureProtocol: 'TLSv1_2_method',
            // };

            // const req = https.request(options, res => {
            //     if (!ignoreError && res.statusCode !== 200) {
            //         console.log(`Failed to POST to url: ${options.host}${options.path} (status code: ${res.statusCode})`);
            //         return reject( new Error(`Failed to POST to url: ${options.host}${options.path} (status code: ${res.statusCode})`));
            //     }
            //     res.setEncoding('utf8');
            //     const data = [];

            //     res.on('data', chunk => data.push(chunk));
            //     res.on('end', () => {
            //         return resolve(data.join(''));
            //     });
            // });

            // req.on('error', (error) => reject(error));
            // req.write(payload);
            // req.end();
        // });
    }

    // _post(endpoint, payload, json = true, ignoreError = false, dontLogin = false) {
    //     return new Promise((resolve, reject) => {

    //         if (!dontLogin && !this._authToken)
    //         {
    //             reject(new Error('[_get] Not logged in yet!'));
    //         }

    //         if (payload instanceof Object) {
    //             payload = JSON.stringify(payload);
    //         }

    //         const options = {
    //             host: this.getRegionalUrl(),
    //             port: HTTPS_PORT,
    //             path: endpoint,
    //             method: 'POST',
    //             headers: {
    //                 Accept: 'application/json',
    //                 'Content-Type': 'application/json',
    //                 'Content-Length': Buffer.byteLength(payload),
    //             },
    //             maxRedirects: 20,
    //             //rejectUnauthorized: false,
    //             keepAlive: false,
    //            //secureProtocol: 'TLSv1_2_method',
    //         };

    //         if (this._authToken) {
    //             options.headers['Authorization'] = 'Bearer ' +  this._authToken.access_token;
    //         }

    //         // console.log("API-POST: "+this._apiServer+endpoint);
    //         // console.log(options);
    //         // console.log(payload);

    //         const req = https.request(options, res => {
    //             if (!ignoreError && res.statusCode !== 200) {
    //                 console.log(`Failed to POST to url: ${options.host}${options.path} (status code: ${res.statusCode})`);
    //                 return reject( new Error(`Failed to POST to url: ${options.host}${options.path} (status code: ${res.statusCode})`));
    //             }
    //             res.setEncoding('utf8');
    //             const data = [];

    //             res.on('data', chunk => data.push(chunk));
    //             res.on('end', () => {
    //                 return resolve(data.join(''));
    //             });
    //         });

    //         req.on('error', (error) => reject(error));
    //         req.write(payload);
    //         req.end();
    //     });
    // }

    async _get(endpoint, payload, ignoreHttpErrors=[]) {
            if (!this._authToken)
            {
                reject(new Error('[_get] Not logged in yet!'));
            }

            // if (payload instanceof Object) {
            //     payload = JSON.stringify(payload);
            // }

            let headers = {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            };
            if (this._authToken) {
                headers['Authorization'] = 'Bearer ' +  this._authToken.access_token;
            }

            try{
                let response = await this._http('GET', this.getRegionalUrl(), `${endpoint}${this._toQueryString(payload)}`, '', headers);
                return response.body;
            }
            catch (error){
                if ( (ignoreHttpErrors.length <= 0) || !(ignoreHttpErrors.find(code => code === error.code)) ){
                    console.log(`Failed to GET to url: ${this.getRegionalUrl()}${endpoint}${this._toQueryString(payload)} status code: ${error.code}`);
                    // throw new Error(`Failed to GET to url: ${this.getRegionalUrl()}${endpoint}${this._toQueryString(payload)}  (status code: ${error.code})`);
                    throw error;
                }
                else{
                    console.log(`Ignoring error for GET to url: ${this.getRegionalUrl()}${endpoint}${this._toQueryString(payload)}  (status code: ${error.code})`);
                }
            }
    }

    // _get(endpoint, payload, json = true, ignoreHttpErrors=[]) {
    //     return new Promise((resolve, reject) => {

    //         if (!this._authToken)
    //         {
    //             reject(new Error('[_get] Not logged in yet!'));
    //         }

    //         if (json) {
    //             payload = JSON.stringify(payload);
    //         }

    //         const options = {
    //             host: this.getRegionalUrl(),
    //             port: HTTPS_PORT,
    //             path: `${endpoint}${this._toQueryString(payload)}`,
    //             method: 'GET',
    //             headers: {
    //                 Accept: 'application/json',
    //                 'Content-Type': 'application/json',
    //             },
    //             maxRedirects: 20,
    //             //rejectUnauthorized: false,
    //             keepAlive: false,
    //             //secureProtocol: 'TLSv1_2_method',
    //         };

    //         if (this._authToken) {
    //             options.headers['Authorization'] = 'Bearer ' +  this._authToken.access_token;
    //         }

    //         const req = https.request(options, res => {
    //             if (res.statusCode !== 200) {
    //                 if ( (ignoreHttpErrors.length <= 0) || !(ignoreHttpErrors.find(code => code === res.statusCode)) ){
    //                     console.log('Failed to GET to url: '+options.host+options.path+' status code: '+res.statusCode);
    //                     return reject( new Error(`Failed to GET to url: ${options.host}${options.path} (status code: ${res.statusCode})`));
    //                 }
    //                 else{
    //                     console.log('Ignoring error for GET to url: '+options.host+options.path+' status code: '+res.statusCode);
    //                 }
    //             }
    //             // if (res.headers['content-type'] == 'image/jpeg'){
    //             //     return resolve(res);
    //             // }
    //             res.setEncoding('utf8');
    //             const data = [];

    //             res.on('data', chunk => data.push(chunk));
    //             res.on('end', () => {
    //                 return resolve(data.join(''));
    //             });
    //         });

    //         req.on('error', (error) => reject(error));
    //         req.end();
    //     });
    // }

    _http(method, host, path, payload, headers) {
        return new Promise((resolve, reject) => {

            if (this._authToken) {
                headers["Authorization"] = 'Bearer ' +  this._authToken.access_token;
            }

            const options = {
                host: host,
                port: HTTPS_PORT,
                path: path,
                method: method,
                headers: headers,
                maxRedirects: 20,
                // allow_redirects: false,
                keepAlive: false,
            };

            const req = https.request(options, res => {
                // if (res.statusCode === 302) {
                //     this._http(method, host, res.headers.location, payload, headers).then(response => {
                //         resolve(response);
                //     })
                //     .catch(error => reject(error));
                // }
                // else if (res.statusCode !== 200) {

                // if (res.statusCode !== 200 && res.statusCode !== 201) {
                //     console.log(`Failed to ${method} to url: ${options.host}${options.path} (status code: ${res.statusCode})`);
                //     let error = new Error(`Failed to ${method} to url: ${options.host}${options.path} (status code: ${res.statusCode})`);
                //     error['code'] = res.statusCode;
                //     error['headers'] = res.headers;
                //     if (res.statusCode in [301, 302, 303, 307, 308] && res.headers.location) {
                //         error.location = res.headers.location;
                //     }
                //     return reject( error );
                // }
                res.setEncoding('utf8');
                const data = [];

                res.on('data', chunk => data.push(chunk));
                res.on('end', () => {
                    if (res.statusCode !== 200 && res.statusCode !== 201) {
                        console.log(`Failed to ${method} to url: ${options.host}${options.path} (status code: ${res.statusCode})`);
                        let error = new Error(`Failed to ${method} to url: ${options.host}${options.path} (status code: ${res.statusCode})`);
                        error['code'] = res.statusCode;
                        error['headers'] = res.headers;
                        error['body'] = data.join('');
                        if (res.statusCode in [301, 302, 303, 307, 308] && res.headers.location) {
                            error.location = res.headers.location;
                        }
                        return reject( error );
                    }
                    return resolve(
                        {
                            body: data.join(''),
                            code: res.statusCode,
                            headers: res.headers
                        }
                    );
                });
            });

            req.on('error', (error) => {
                return reject(error)
            });
            if (method === 'POST') {
                req.write(payload);
            }
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
        return `?${this._toFormdataString(obj)}`;
    }

    _toFormdataString(obj) {
        if (obj === null || typeof obj === 'undefined' || Object.keys(obj).length === 0) {
            return '';
        }
        return `${Object.keys(obj)
            .map(k => `${k}=${encodeURIComponent(obj[k])}`)
            .join('&')}`;
    }

}

module.exports = blinkApi;