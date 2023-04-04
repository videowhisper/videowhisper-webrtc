## VideoWhisper WebRTC

This is a WebRTC signaling server for VideoWhisper HTML5 Videochat. It's built in NodeJS, supports SSL, TURN/STUN configuration.

### Live Demos
* [P2P 2 Way Videocall](https://demo.videowhisper.com/p2p-html5-videocall/)
* [Live Video Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/)


### Installation
* Install NodeJS if not already available (ie. `yum install nodejs`)
* Deploy these files in a server folder
* Run `npm update` in folder to get dependencies 
* Get a certificate with CRT & KEY files for SSL
* Get a TURN server for relaying (not required for intranet testing)
* Install PM2 `npm install pm2 -g`
* Configure ecosystem.config.js (path to certificate files, turn server address)
* Development: `pm2 start ecosystem.config.js --env development --watch --attach --ignore-watch="node_modules/*"`
* Production: `pm2 start ecosystem.config.js --env production --startup systemd`
* Troubleshooting: For troubleshooting purposes configure directly server.js and run from folder with `npm start`

### Configure HTML5 Videochat
You will need the signaling server address, based on certificate and port you configured, like wss://yourdomain.com:3000 and the SecretToken you configured. 

For [Paid Videochat](https://paidvideochat.com/) from WebRTC plugin settings select WebRTC Streaming Server : VideoWhisper and fill VideoWhisper Socket Server, VideoWhisper Socket Server Token.

For PHP HTML5 Videochat editions [P2P 2 Way Videocall](https://demo.videowhisper.com/p2p-html5-videocall/) , [Live Video Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/) , configure `settings.php` :

```
 $options = array(
	'serverType' => 'videowhisper', //videowhisper/wowza 
	'vwsSocket' => 'wss://yourserver.com:3000/',
	'vwsToken' => 'YourSecretToken',
    ...
```

### API
Server currently implements these GET requests:
* https://yourServer.com:3000/ - Shows server version & features
* https://yourServer.com:3000/connections/ - Shows current list of connections, in development mode


### Commercial Services
[Consult VideoWhisper](https://consult.videowhisper.com/) for:
* Technical Support
* Turnkey Platform Solutions
* Hosting (WebRTC Signaling, WowzaSE, TURN, Webhosting cPanel & WordPress)
* Custom Development
* Commercial Solutions