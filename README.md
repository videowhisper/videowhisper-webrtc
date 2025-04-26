## VideoWhisper Server : WebRTC Signaling Server with STUN/TURN Support
This is a live video streaming server with WebRTC signaling.
It's built in NodeJS, supports SSL, TURN/STUN configuration, authentication with static key or accounts (MySQL) and user PINs, streaming limitations & plans, API, advanced user authentication, integrations, rooms, text chat. 
Can be used to publish a stream from a broadcaster to 1 or more subscribed viewers and possible applications include 1 to 1 (1 way or 2 way private), 1 to multiple, multiple to multiple (conferencing) live video streaming.

### Live Demos (No Registration)
* [Webcam Streaming WebRTC](https://demo.videowhisper.com/Webcam-Streaming-WebRTC/)
* [P2P 2 Way Videocall](https://demo.videowhisper.com/p2p-html5-videocall/)
* [Live Video Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/)
* [Random Videochat](https://2wayvideochat.com/random-videochat/)

![HTML5 Videochat / P2P Video Call](/snapshots/h5v-call-client.jpg)


### Features
* Signaling server for WebRTC
* Publish stream from broadcaster to 1 or multiple subscribed viewers
* Handles multiple channels (streams) at same time
* Peer configuration for relaying (STUN/TURN) with WebRTC Test
* Room and chat module for videochat
* Authentication with static token or accounts (MySQL) with ability to suspend account
* Limitation plans for accounts (totalBitrate, bitrate, audioBitrate, width, height, frameRate)
* API (features, connections, channels, usage stats)
* Integrates with VideoWhisper [Live Support WP Plugin](https://wordpress.org/plugins/live-support-tickets/) for account registration, managing accounts/plans
* Ready to use apps and turnkey site setups like:
  - [PaidVideochat: Pay Per Minute Services](https://paidvideochat.com)
  - [FansPaysite: Live Creator Subscriptions](https://fanspaysite.com)
  - [2WayVideochat: RandomChat & Private Calls](https://2wayvideochat.com/)
  - [Webcam Streaming WebRTC](https://demo.videowhisper.com/Webcam-Streaming-WebRTC/)
  - [PHP: P2P 2 Way Video Calls](https://demo.videowhisper.com/p2p-html5-videocall/)
  - [PHP: P2P 1 to Many Live Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/)
* Support for extra module (not included in this repository): RTMP/HLS, Custom


### Free Server for Testing, Development
If you want to test with an existing server, [register for a Free Developers account](https://webrtchost.com/hosting-plans/#WebRTC-Only) with VideoWhisper, to get a server address and token. Includes STUN/TURN server. Limited availability.


### Installation
* Install NodeJS if not already available on your server (ie. `yum install nodejs`)
* Deploy these files in a server folder
* Run `npm update` in folder to get dependencies (from package.json)
* Get a certificate with CRT & KEY files for SSL
* For relaying in production, install Coturn server or other TURN server (not required for intranet testing)
* Configure your server in `.env` file (path to certificate files, TURN server configuration, static token and/or MySQL)
* Install PM2 `npm install pm2 -g`(process manager for NodeJS), configure startup options `pm2 startup`
* Development: `pm2 start ecosystem.config.js --env development --watch --attach --ignore-watch="node_modules/*"`
* Production: `pm2 start ecosystem.config.js --env production`
* Manage: `pm2 status` / `pm2 stop 0` / `pm2 start 0` (0 is default server id)
* Review logs: `pm2 logs 0 --nostream --lines 50` (0 is default server id)
* Troubleshooting: Run from folder with `npm start` to see live server output in terminal and end it with `Ctrl+C`


### Configure HTML5 Videochat / Streaming Apps
You will need the signaling server address, based on certificate and port you configured, like `wss://yourserverdomain.com:3000` and the SecretToken you configured or account token from `accounts` table in MySQL database. 

* For [Webcam-Streaming-WebRTC](https://github.com/videowhisper/Webcam-Streaming-WebRTC) fill VideoWhisper Server (VWS) settings in `config.json` (in build folder from `dist`, after copying from `unconfigured.json`). See  **Authenticaion Methods** section for mode options including advanced authetication with user/pin.
```json
"videowhisperServer": {
    "socket": "wss://VideoWhisper-Server:3000",
    "authentication": "token",
    "token": "your-account-token-here"
}
```

* For [Paid Videochat / PPV Live Webcams](https://paidvideochat.com/) from WordPress plugin settings, WebRTC tab, select WebRTC Streaming Server : VideoWhisper or Auto and fill Address, Token for VideoWhisper WebRTC.
Auto requires both VideoWhisper WebRTC for private chats and Wowza SE as relay for 1 to many group chats (recommended for scaling to many viewers).

* For [2Way VideoCalls and Random Chat](https://2wayvideochat.com) from WordPress plugin settings, Server tab, select WebRTC Streaming Server : VideoWhisper and fill Address, Token for VideoWhisper WebRTC.

* For PHP HTML5 Videochat editions [P2P 2 Way Videocall](https://demo.videowhisper.com/p2p-html5-videocall/) , [Live Video Streaming](https://demo.videowhisper.com/vws-html5-livestreaming/) , configure `settings.php` :

```
 $options = array(
	'serverType' => 'videowhisper', //videowhisper/wowza 
	'vwsSocket' => 'wss://videowhisperServer:PORT/',
	'vwsToken' => 'YourSecretToken',
    ...
```
If you implement your own videochat apps, you need to use same functions and logic.


### API
Server currently implements these GET requests:
* `https://videowhisperServer:PORT/` - Shows server version & features, tests STUN/TURN for WebRTC
* `https://videowhisperServer:PORT/connections/?apikey=API_KEY` - Shows current list of connections,
* `https://videowhisperServer:PORT/channels/?apikey=API_KEY` - Shows current list of published channels (with streaming parameters like resolution, bitrate)
* `https://videowhisperServer:PORT/stats/?apikey=API_KEY` - Shows usage stats by account (number of connections, bitrate)
* `https://videowhisperServer:PORT/update-accounts?apikey=API_KEY` - Reloads accounts from MySQL without restarting server (call after adding a new account)

Configure API_KEY in `.env`. In development mode the apikey parameter is not required.


### Commercial Services
[Consult VideoWhisper](https://consult.videowhisper.com/) for:
* Professional Installation (VideoWhisper NodeJS server, Coturn)
* Extra modules: RTMP/HLS, Custom (on request)
* Turnkey Hosting (WebRTC Signaling, STUN/TURN, Webhosting cPanel & WordPress)
* Turnkey Site Setups
* Technical Support
* Custom Development

### How does WebRTC signaling work?
To use with own WebRTC streaming application(s) see a brief description below:

##### Server
The VideoWhisper Server (VWS) receives connections from clients (broadcaster and players) and manages the signaling from `modules/webrtc.js`:
 * Server manages channels with broadcaster & player(s)
 * Handles `publish` from broadcaster to register own stream and get players in channel
 * Handles `subscribe` from players to register in a channel
 * Notifies broadcaster about list of `peers` on publish and each new `peer` on player subscribe
 * Handles signaling between peers with `messagePeer`: exchange `offer`, `answer`, `candidate` 

##### Client Implementation
For an exact implementation sample see [Webcam-Streaming-WebRTC](https://github.com/videowhisper/Webcam-Streaming-WebRTC) available with source code. It includes implementation for both broadcaster and player clients.

Clients connect to this server by sockets using address and token or account/user/pin, in example:
```js
this.vwsSocket = new io(props.config.vwsSocket, {
      'auth': { 'token': props.config.vwsToken } ,
      'transports': ['websocket'],		
      'secure':true,
      'autoConnect': false,
      'reconnection': false
  });
```
##### Broadcaster Client
Broadcaster publishes a channel and works with server and peers. 
 1. After connecting to server, emits `publish` to server
  * `peerID`: username of broadcaster
  * `channel`: channel (room) name
  * `params`: object with stream parameters (width, height, bitrate, audioBitrate, frameRate)
 2. Handles `publishError` from server 
 3. Handles `message` from server:
    * `peers` or `peer` : adds the peer to list
    * `answer` : sets remote description and sends answer
    * `candidate` : sets ice candidate with `peerConnection.addIceCandidate`
 4. Using `messagePeer` communicates with the player peers:   
    * Creates and sends `offer` when `peerConnection.onnegotiationneeded`
    * Sends the ice `candidate` on `peerConnection.onicecandidate`
  
##### Player Client
Player subscribes to play from a channel.
1. After connecting to server, emits `subscribe` to server
  * `peerID`: username of player
  * `channel`: channel (room) name
2. Handles `subscribeError` from server 
3. Handles `message` from server:
  * `offer` : sets remote description and sends answer
  * `candidate` : sets ice candidate with `peerConnection.addIceCandidate`
4. Using `messagePeer` communicates with broadcaster peer:
  * Creates and sends `answer` message on `offer` message
  * Sends the ice candidate with `candidate` message on `peerConnection.onicecandidate`

##### Room Participants
Using rooms requirs account/user/pin authentication. 
1. Participants emit `roomJoin({roomName})` 
2. Broacaster emits `roomPublish({roomName, channel, parameters})` to publish the channel
3. Participants handle `roomUpdate` which may include various parameters like:
  * `error` :  room error message, like trying to use room without joining
  * `messages` : room messages
  * `messageNew` : new message from participant
4. Participants handle `message` from server and emit `messagePeer` for WebRTC signaling, as when not using rooms
5. Participants can send `roomMessage({roomName, message})` 
6. Participant leave with `roomLeave({roomName})`
When using rooms, player clients do not need to subscribe to room channels in addition to joining the room. The server will automatically subscribe them to the room channels.

### Authentication Methods

The server supports multiple authentication methods. Generic authentication failure messages can be enabled with EXTRA_SECURITY in the environment variables. 

#### Static Token Authentication
A global server token can be configured in the environment variables with `STATIC_TOKEN`. This token can be used for all server clients and should be used for testing and development. Token is available to clients.

#### Account Token Authentication
Each account has a unique token that identifies it. This can be used on internal projects where users can be trusted with account token. 

```javascript
// Client connects with token
const socket = io(serverUrl, {
  auth: { token: 'account-token-here' },
  // other options...
});
```

#### User/Pin Authentication
Users connect to streaming server using:
- account name
- user name
- user PIN
It's best for public projects where users should not have access to account token. Each user has own PIN and can be created/managed from the website and checked by the server on each access.

```javascript
// Client connects with account/user/pin
const socket = io(serverUrl, {
  auth: { 
    account: 'account-name',
    user: 'user-name',
    pin: 'user-pin'
  },
  // other options...
});
```

For testing purposes you can configure a `STATIC_ACCOUNT` and `STATIC_LOGIN` url in `.env` file. This will allow you to connect without setting up a database. Leave blank to disable.

Requirements for User/Pin authentication:
- The account must exist in the database, or defined as `STATIC_ACCOUNT` in `.env`
- The account must have a `loginURL` property in its properties, or defined as `STATIC_LOGIN` in `.env`
- The server will make a POST request to this URL with:
  ```json
  {
    "account": "account-name", 
    "token": "account-token", 
    "user": "username", 
    "pin": "user-pin"
  }
  ```
  For static account server will use `STATIC_TOKEN` from `.env` file instead of account token.

- The login URL should respond with either:
  ```json
  {"login": true}
  ```
  or
  ```json
  {"login": false, "message": "Login rejected for user"}
  ```
For testing purposes you can create a login.json file with contents above and configure it as loginURL in the account properties. The server will use this URL to check the login status of the user on each connection attempt.

The login URL should be configured to allow cross-origin requests (CORS) from the streaming server.

For optimal performance, website and streaming server should be on same server or in the same network and login integration should be implemented for quick response and high reliability, preferably without big overhead.

When implementing channel names also take into consideration that server supports a `restrictPublish` setting per account for quck publishing authorization:
- `username` - channel name should match exactly the username
- `prefix` - channel name should start with the username
- `suffix` - channel name should end with the username
- `contain` - channel name should contain the username
Other setting will allow any channel name.
This is a quick way to prevent hijacking of channels by other users. Prefix can be used when you want to implement random channel names.


### Database (MySQL) Module
For managing connections from different accounts (websites, setups) and/or setting limitations, use a MySQL with unique token keys (per account).

```
DROP TABLE IF EXISTS accounts;
  CREATE TABLE accounts (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL,
    properties TEXT NOT NULL,
    planId INT,
    meta TEXT,
    contactId INT,
    created INT,
    PRIMARY KEY (id),
    UNIQUE KEY (token), 
    KEY (planId),
    KEY (contactId),
    KEY (created)
  );

  DROP TABLE IF EXISTS plans;
  CREATE TABLE plans (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    properties TEXT NOT NULL,
    PRIMARY KEY (id)
  );

```
Properties are JSON encoded, for accounts and plans. Some fields like contactId, created, meta are used with external integration and may not be required for your project.

Sample test data showcasing supported properties:
```sql
INSERT INTO accounts (name, token, properties, meta, planId) VALUES ('Test Account', 'testToken', '{}', '', 1);
INSERT INTO accounts (name, token, properties, meta, planId) VALUES ('Suspended Account', 'suspendedToken', '{"suspended":true}', '', 1);
INSERT INTO plans (name, properties) VALUES ('Developers Plan', '{"connections":5,"totalBitrate":2700, "bitrate":500,"framerate":15,"audioBitrate":32,"width":640,"height":360}');
```
Consider both bitrate and audioBitrate when setting an account limit for totalBitrate. In example 1064 for 2 users with 500 bitrate and 32 audioBitrate.

Supported plan limits (per account):
```
{
  "connections": 5, // max number of simultaneous connections (sockets)
  "totalBitrate": 2700, // max total bitrate for all account streams
  "bitrate": 500, // max video bitrate for each stream
  "audioBitrate": 32, // max audio bitrate for each stream
  "width": 640, // max width (higher dimension, automatically switched on portrait/landscape)
  "height": 360, // max height (lower dimension, automatically switched on portrait/landscape)
  "frameRate": 15 // max frames per second
  "streamPlayers": 10 // max number of HLS players per account (for RTMP/HLS Nginx module)
}
```

Supported account properties:
```
{
  "suspended": true, // if true, account is suspended and cannot connect
  "loginURL": "https://example.com/login.php", // URL to verify user/pin authentication
  "restrictPublish": "no|username|prefix|suffix|contain" // restricts WebRTC publishing to specific channel names
}
```


### Modules
* `database.js` - MySQL module for managing connections from different accounts (websites, setups) and/or setting limitations
* `webrtc.js` - WebRTC module for managing channels, signaling
* `room.js` - Room module for managing rooms and chat


### RTMP/HLS Nginx Module (Extra)
This module can be used to control streams from a Nginx server with RTMP / HLS, implement access control, account limitations and stats.
This extra module (modules/nginx.js) is not part of public repository: [Consult VideoWhisper](https://consult.videowhisper.com/) if needed.
Access to broadcast/playback can be limited either by token or client facing pin which can be per account or per stream.

* Configure Nginx server info in .env:
```
NGINX_HOST=#leave blank to disable or set something like https://nginxServer:nginxPort 
NGINX_RTMP=#rtmp://nginxServer:nginxPortRTMP/live
NGINX_KEY=#key for m3u8 playlist access
```
* Configure nginx.conf : 
  * setup rtmp/server/live calls to videowhisper server (local http on port 3001) : 
    ```
    on_publish http://videowhisperServer:3001/nginx/on_publish?apikey=API_KEY;
    on_publish_done http://videowhisperServer:3001/nginx/on_publish_done?apikey=API_KEY;
    on_play http://videowhisperServer:3001/nginx/on_play?apikey=API_KEY;
    on_play_done http://videowhisperServer:3001/nginx/on_play_done?apikey=API_KEY;
    on_update http://videowhisperServer:3001/nginx/on_update?apikey=API_KEY;
    ```
  * setup http/server/location /hls for hls playback and restrict access to playlist by key=NGINX_KEY:
    ```
    location ~* /hls/.*/.*/index.m3u8$ {
            if ($arg_key != "NGINX_KEY") {
              return 403;
            }
    }
    ```
* RTMP broadcast to rtmp://streamingserver:1935/live with stream key Acccount/Stream?token=TOKEN&pin=PIN :
  * TOKEN is the universal STATIC_TOKEN from server configuration or account token when using accounts, not needed if using pin
  * PIN is the broadcastPin from account properties or stream properties retrieved from streamUrl account property
* HLS playback can be done directly from Nginx ( https://nginxServer:nginxPort/hls/Account/TestStream/index.m3u8?key=NGINX_KEY ) for testing or trough Videowhisper NodeJs server for access control and stats ( https://videowhisperServer:PORT/hls/Account/Stream/index.m3u8?token=TOKEN&pin=PIN ):
  * TOKEN is the universal STATIC_TOKEN from server configuration or account token when using accounts, not needed if using pin
  * PIN can be playbackPin from account properties or stream properties retrieved from streamUrl account property
* stream properties are retrieved on broadcast/playback from streamUrl?stream={Stream}&token{account token}=&type={broadcast/playback} and expects json encoded data (broadcastPin or playbackPin)


### Need Help?
[Consult VideoWhisper](https://consult.videowhisper.com/) for clarifications, professional installation, compatible hosting, turnkey setups, custom development, technical support.