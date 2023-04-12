## VideoWhisper WebRTC

This is a WebRTC signaling server for VideoWhisper HTML5 Videochat. It's built in NodeJS, supports SSL, TURN/STUN configuration, authentication with static key or accounts (MySQL).

### Live Demos
* [P2P 2 Way Videocall](https://demo.videowhisper.com/p2p-html5-videocall/)
* [Live Video Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/)

### Features
* Signaling server for WebRTC
* Peer configuration for relaying (STUN/TURN)
* Authentication with static token or accounts (MySQL) with ability to suspend account
* Limitation plans for accounts (totalBitrate, bitrate, audioBitrate, width, height, frameRate)

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
* Manage: `pm2 status` / `pm2 stop 0` / `pm2 start 0` (for id 0)
* Troubleshooting: Run from folder with `npm start` to see live server output in terminal and end it with `Ctrl+C`

### Configure HTML5 Videochat
You will need the signaling server address, based on certificate and port you configured, like `wss://yourdomain.com:3000` and the SecretToken you configured or account token from `accounts` table in MySQL database. 

For [Paid Videochat](https://paidvideochat.com/) from WebRTC plugin settings select WebRTC Streaming Server : VideoWhisper or Auto and fill Address, Token for VideoWhisper WebRTC.
Auto requires both VideoWhisper WebRTC for private chats and Wowza SE as relay for 1 to many group chats (recommended for scaling to many viewers).

For PHP HTML5 Videochat editions [P2P 2 Way Videocall](https://demo.videowhisper.com/p2p-html5-videocall/) , [Live Video Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/) , configure `settings.php` :

```
 $options = array(
	'serverType' => 'videowhisper', //videowhisper/wowza 
	'vwsSocket' => 'wss://yourserver.com:3000/',
	'vwsToken' => 'YourSecretToken',
    ...
```
If you implement your own videochat apps, you need to use same functions and logic.

### API
Server currently implements these GET requests:
* `https://yourServer.com:3000/` - Shows server version & features
* `https://yourServer.com:3000/connections/` - Shows current list of connections, in development mode
* `https://yourServer.com:3000/channels/` - Shows current list of published channels (with streaming parameters like resolution, bitrate), in development mode
* `https://yourServer.com:3000/stats/` - Shows usage stats by account (number of connections, bitrate), in development mode

### Commercial Services
[Consult VideoWhisper](https://consult.videowhisper.com/) for:
* Turnkey Setups
* Technical Support
* Hosting (WebRTC Signaling, WowzaSE, TURN, Webhosting cPanel & WordPress)
* Custom Development
* Commercial Solutions

### MySQL Structure
For managing connections from different accounts (websites, setups) and/or setting limitations, use a MySQL with unique token keys (per account):
```
DROP TABLE IF EXISTS accounts;
  CREATE TABLE accounts (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL,
    properties TEXT NOT NULL,
    planId INT,
    meta TEXT,
    PRIMARY KEY (id),
    UNIQUE KEY (token), 
    KEY (planId)
  );

  DROP TABLE IF EXISTS plans;
  CREATE TABLE plans (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    properties TEXT NOT NULL,
    PRIMARY KEY (id)
  );

```
Properties are JSON encoded, for accounts and plans.

Sample test data showcasing supported properties:
```
INSERT INTO accounts (name, token, properties, meta, planId) VALUES ('Test Account', 'testToken', '{}', '', 1);
INSERT INTO accounts (name, token, properties, meta, planId) VALUES ('Suspended Account', 'suspendedToken', '{"suspended":true}', '', 1);
INSERT INTO plans (name, properties) VALUES ('Test Plan', '{"connections":2,"totalBitrate":1064,"bitrate":500,"framerate":15,"audioBitrate":32,"width":640,"height":360}');
```
Consider both bitrate and audioBitrate when setting an account limit for totalBitrate. In example 1064 for 2 users with 500 bitrate and 32 audioBitrate.
