## VideoWhisper WebRTC

This is a WebRTC signaling server for VideoWhisper HTML5 Videochat. It's built in NodeJS, supports SSL, TURN/STUN configuration, authentication with static key or accounts (MySQL).

### Live Demos
* [P2P 2 Way Videocall](https://demo.videowhisper.com/p2p-html5-videocall/)
* [Live Video Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/)

### Features
* Signaling server for WebRTC
* Peer configuration for relaying (STUN/TURN)
* Authentication with static token or accounts (MySQL)

### Installation
* Install NodeJS if not already available on your server (ie. `yum install nodejs`)
* Deploy these files in a server folder
* Run `npm update` in folder to get dependencies 
* Get a certificate with CRT & KEY files for SSL
* For relaying in production, install Coturn server or other TURN server (not required for intranet testing)
* Configure your server in `.env` file (path to certificate files, TURN server configuration, static token and/or MySQL)
* Install PM2 `npm install pm2 -g`(process manager for NodeJS), configure startup options `pm2 startup`
* Development: `pm2 start ecosystem.config.js --env development --watch --attach --ignore-watch="node_modules/*"`
* Production: `pm2 start ecosystem.config.js --env production`
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
* Turnkey Setups
* Technical Support
* Hosting (WebRTC Signaling, WowzaSE, TURN, Webhosting cPanel & WordPress)
* Custom Development
* Commercial Solutions

### MySQL Structure
For managing connections from different accounts (websites, setups), use a MySQL with unique token keys per account:
```
DROP TABLE IF EXISTS accounts;
  CREATE TABLE accounts (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL,
    properties TEXT NOT NULL,
    meta TEXT,
    PRIMARY KEY (id),
    UNIQUE KEY (token)
  );
```

Properties are JSON encoded:
* suspended = true / false
