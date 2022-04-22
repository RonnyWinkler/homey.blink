Setup:
After app installation, you can insert an "Account" device and sign in with your Blink account credentials.
The cameras and systems/SyncModules assigned to the account can then be added to Homey.

Supported Blink Devices:
- Blink indoor/outdoor ("square") camera
- Blink mini camera
- Blink System/Sync Module

Camera Features:
- Response to motion detection (flow event)
- Switch motion detection on/off by switching the Homey device on/off
- Take snapshot (triggers the event "Snapshot was created" after recording)
- Response to new snapshot (flow event)
- Record video (flow action)
- Temperature, WiFi/SyncModule reception signal strength, status (online/offline)

System/SyncModule Features:
- Enable/disable alarm status by turning on/off Homey device
- SyncModul memory usage, WiFi signal strength
 
Account Properties:
- API status, cloud storage usage