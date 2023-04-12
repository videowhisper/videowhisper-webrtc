//VideoWhisper WebRTC Signaling Server
const SERVER_VERSION = "2023.04.12";
const SERVER_FEATURES = "WebRTC Signaling, SSL, TURN/STUN configuration for VideoWhisper HTML5 Videochat, MySQL accounts, MySQL plans, plan limitations for connections/bitrate/resolution/framerate.";

//Configuration
require('dotenv').config();
const DEVMODE = ( process.env.NODE_ENV || "development" ) === "development"; //development mode

console.log("VideoWhisper WebRTC Signaling Server", SERVER_VERSION, "\r", SERVER_FEATURES );

//TURN/STUN
//adjust if using different TURN/STUN servers
//test TURN/STUN configuration with https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ and/or https://icetest.info  
let peerConfig; 
if (process.env.COTURN_SERVER) peerConfig = {
  iceServers: [
  {   
    urls: [ "stun:" + process.env.COTURN_SERVER ]
  }, 
  {   
    username: process.env.COTURN_USER,   
    credential: process.env.COTURN_PASSWORD,   
    urls: [       
      "turn:" + process.env.COTURN_SERVER + "?transport=udp",       
      "turn:" + process.env.COTURN_SERVER + "?transport=tcp",       
     ]
   }
 ]
};
else peerConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
console.log(`Peer configuration: ${JSON.stringify(peerConfig)}`);

//Authentication 
if (process.env.STATIC_TOKEN) console.log("Static token configured", DEVMODE ? process.env.STATIC_TOKEN : ''); else console.log("Static token disabled");

//Account database
var accounts = {};
let accountsLoaded = false;

//If using MySQL, load accounts & plans from the database
if (process.env.DB_HOST)
{
const Database = require('./modules/database.js');
const db = new Database();
db.getAccounts()
  .then(accts => {
     accounts = accts;
     accountsLoaded = true;
  })
  .catch(err => {
    console.error('Error loading accounts:', err);
  });
}

//Enforce SDP (experimental)
const transform = require('sdp-transform');
function enforceSdp(sdp, account) {
  // Enforce maximum resolution and frame rate
  const maxResolution = 360; // Example: max 360p
  const maxFrameRate = 15; // Example: max 15 fps
  const maxBitrate= 750;

  if (DEVMODE) console.log("transformSdp", account, maxResolution, maxFrameRate, maxBitrate);

  const parsedSdp = transform.parse(sdp);
  const videoMedia = parsedSdp.media.find(media => media.type === 'video');

	if (videoMedia) {
    videoMedia.fmtp.forEach((videoFmtp, index) => {
    const videoCodec = videoMedia.rtp[index].codec;
    const codecParameters = sdpTransform.parseParams(videoFmtp.config);
  
    codecParameters['max-fs'] = maxResolution;
    codecParameters['max-fr'] = maxFrameRate;
    codecParameters['max-mbps'] = maxResolution * maxFrameRate; //maximum macroblocks per second

    videoFmtp.config = Object.entries(codecParameters).map(([key, value]) => `${key}=${value}`).join(';');

    // Add bitrate limitation using b=AS attribute
    videoMedia.bandwidth = [{type: 'AS', limit: maxBitrate}];
    });
  }

  return transform.write(parsedSdp);
}

//WEBRTC SIGNALING SERVER
const express = require('express');
const app = express();
const cors = require("cors");
app.use(express.json(), cors());
const fs = require('fs');
const https = require('https');

//i.e. cPanel > SSL/TLS > Certificates > Install : get certificate and key
const options = {
  key: fs.readFileSync(process.env.CERTIFICATE  + '.key'),
  cert: fs.readFileSync(process.env.CERTIFICATE  + '.crt')
};
const server = https.createServer(options, app);

const io = require('socket.io')(server);
io.eio.pingTimeout = 60000; // 1 minute
io.eio.pingInterval = 5000;  // 5 seconds

// API ENDPOINT TO DISPLAY THE CONNECTION TO THE SIGNALING SERVER
let connections = {};
let channels = {};
let stats = {};

//[GET] https://yourDomain:PORT/
app.get("/", (req, res) => {
  if (DEVMODE) console.log("API /", "VideoWhisper WebRTC", SERVER_VERSION, SERVER_FEATURES );
res.json({ "server": "VideoWhisper WebRTC",  "version": SERVER_VERSION, "features": SERVER_FEATURES });
});

if (DEVMODE)
{
  //[GET] https://yourDomain:PORT/connections
  app.get("/connections", (req, res) => {
      if (DEVMODE) console.log("API /connections", connections );
    res.json(Object.entries(connections));
  });

  //[GET] https://yourDomain:PORT/channels
  app.get("/channels", (req, res) => {
      if (DEVMODE) console.log("API /channels", channels );
    res.json(Object.entries(channels));
  });

  //[GET] https://yourDomain:PORT/stats
    app.get("/stats", (req, res) => {
      if (DEVMODE) console.log("API /stats", stats );
    res.json(Object.entries(stats));
  });

}


// AUTHENTICATION MIDDLEWARE
const authenticate = (socket, next) => {
  const token = socket.handshake.auth.token;
  const staticToken = process.env.STATIC_TOKEN || '';

  if (staticToken) if (token === staticToken) 
  {
    socket.account = '_static';
    socket.token = staticToken;

    if (DEVMODE) console.log ("Authenticated with STATIC_TOKEN #", socket.id);
    return next();
  }

  if (!accounts) return next(new Error("ERROR: No static token configured or accounts loaded, yet"));

  const account = accounts[token];

  if (account) {
    socket.account = account.name;
    socket.token = token;

    if (account.plan.connections) if (stats[account.name]) if (stats[account.name].connections >= account.plan.connections) 
    {
      if (DEVMODE) console.warn(`WARNING: Connection limit reached for ${account.name} #`, stats[account.name].connections, socket.id );
      return next(new Error('ERROR: Connection limit exceeded'));
    } 

    if (account.plan.totalBitrate) if (stats[account.name]) if (stats[account.name].bitrate + stats[account.name].audioBitrate >= account.plan.totalBitrate )
    {
      if (DEVMODE) console.warn(`WARNING: Total bitrate limit reached for ${account.name} `, stats[account.name].bitrate, socket.id );
      return next(new Error('ERROR: Bitrate limit exceeded'));
    } 

    if (account.properties.suspended) {
      if (DEVMODE) console.warn(`WARNING: Suspended account ${account.name} `, socket.id);
      return next(new Error('ERROR: Suspended account'));
    } 

    //Accept connection
    if (DEVMODE) console.log (`Authenticated with token from account ${account.name} #`, socket.id);
    next();


  } else {
    next(new Error("ERROR: Authentication error"));
  }

};
io.use(authenticate);

//stats for accounts, channels
function updateStats()
{

  let accountStats = {};
  for (let channel in connections) //for each channel
  {
    for (let peerID in connections[channel]) //for each connection
    {
      let account = connections[channel][peerID].account;
      let params = channels[channel] || { width: 0, height: 0, bitrate: 0, frameRate:0, audioBitrate: 0};

     // if (DEVMODE) console.log("-updateStats ", channel, params);

      if (account in accountStats) 
      {
        accountStats[account]['connections']++;
        accountStats[account]['bitrate']+= params['bitrate'];
        accountStats[account]['audioBitrate']+= params['audioBitrate'];
      }
      else accountStats[account]= { 'connections': 1, 'bitrate': params['bitrate'] , 'audioBitrate': params['audioBitrate'], 'players': 0, 'broadcasters': 0 };

      if (connections[channel][peerID].type == 'player') accountStats[account]['players']++;
      if (connections[channel][peerID].type == 'broadcaster') accountStats[account]['broadcasters']++;
    }
  }

  stats = accountStats;
  //if (DEVMODE) console.log("updateStats", stats);
}

// SIGNALING LOGIC
io.on("connection", (socket) => {

  if (DEVMODE) console.log("Socket connected #", socket.id, "from account", socket.account);

  socket.on("subscribe", (peerID, channel) => {
  //players call subscribe to channel, to get notified when published

      if (DEVMODE) console.log("socket.on(subscribe", peerID, channel);

      if (!channel) channel = 'VideoWhisper';

       socket.join(channel);
       if (!(channel in connections)) connections[channel] = {};

      socket.peerID = peerID;
      socket.channel = channel;

      // Make sure that the hostname is unique, if the hostname is already in connections, send an error and disconnect
      if (peerID in connections[channel]) {
          socket.emit("uniquenessError", {
              from: "_channel_",
              to: peerID,
              message: `${peerID} already in @${channel}.`,
          });
          console.log(`ERROR: ${peerID} is already connected @${channel}`);
          socket.disconnect(true);
      } else {

        //get channel params
        let params = channels[channel]; 
        let account = accounts[socket.token];

        if (params && account)
        {
          let issues = [];

          if (stats[account.name]) if (stats[account.name].bitrate + stats[account.name].audioBitrate + params['bitrate'] + params['audioBitrate'] > account.plan.totalBitrate ) issues.push('totalBitrate' );
          if (stats[account.name]) if (stats[account.name].conections > account.plan.conections ) issues.push( 'conections' );

          if (issues.length > 0)
          {
            if (DEVMODE) console.warn(`WARNING: Subscribe rejected for ${account.name}`, params, account.plan );

            socket.emit("subscribeError", {
              from: "_server_",
              to: peerID,
              message: `Unfit: ${issues.join(', ')}.`,
          });

            return ;

          }

        }

        if (DEVMODE) console.log(` ${peerID} subscribed to @${channel}. Total connections subscribed to @${channel}: ${Object.keys(connections[channel]).length + 1}`);
            
          // Add new player peer
          const newPeer = { socketId: socket.id, peerID, type: "player", account: socket.account };
          connections[channel][peerID] = newPeer;
        
          // Let broadcaster know about the new peer player (to send offer)
          socket.to(channel).emit("message", {
              type: "peer",
              from: peerID,
              target: "all",
              peerID: peerID,
              });
      }

      updateStats();
  });

  socket.on("publish", (peerID, channel, params) => {
      //broadcaster calls publish when ready to publish channel (stream)

      if (DEVMODE) console.log("socket.on(publish", peerID, channel, params);

      if (!channel) return;

      if (! (channel in connections) ) connections[channel] = {};

      if (peerID in connections[channel]) {
        socket.emit("uniquenessError", {
            from: "_channel_",
            to: peerID,
            message: `${peerID} already in @${channel}.`,
        });
        console.log(`ERROR: ${peerID} is already connected @${channel}`);
        socket.disconnect(true);
     }

      if (params)
      { 
         params['publisher'] = peerID;
         params['time'] = Date.now();
         let account = accounts[socket.token];

        //for accounts, check if stream parameters are within account plan limits
         if (account)
         {
          if (DEVMODE) console.warn(`socket.on(publish account ${account.name} plan`, account.plan );

          let issues = [];
          if (account.plan.width) if (params['width'] > account.plan.width) issues.push('width');
          if (account.plan.height) if (params['height'] > account.plan.height) issues.push('height' );
          if (account.plan.bitrate) if (params['bitrate'] > account.plan.bitrate) issues.push( 'bitrate' );
          if (account.plan.frameRate) if (params['frameRate'] > account.plan.frameRate) issues.push('frameRate' );
          if (account.plan.audioBitrate) if (params['audioBitrate'] > account.plan.audioBitrate) issues.push('audioBitrate' );

          if (stats[account.name]) if (stats[account.name].bitrate + stats[account.name].audioBitrate + params['bitrate'] + params['audioBitrate'] > account.plan.totalBitrate ) issues.push('totalBitrate' );
          if (stats[account.name]) if (stats[account.name].conections > account.plan.conections ) issues.push( 'conections' );

          if (issues.length > 0)
          {
            if (DEVMODE) console.warn(`WARNING: Publish rejected for ${account.name}`, params, account.plan );

            socket.emit("publishError", {
              from: "_server_",
              to: peerID,
              message: `Unfit: ${issues.join(', ')}.`,
          });

            return ;

          }

         }

      }

      socket.join(channel); //broadcaster subscribes to receive new peers
      if (!(channel in connections)) connections[channel] = {};

      //save channel params
      channels[channel] = params ? params : { width: 0, height: 0, bitrate: 0, frameRate:0, audioBitrate: 0, publisher: peerID};

      socket.peerID = peerID;
      socket.channel = channel;

      // Add new player peer
      const newPeer = { socketId: socket.id, peerID, type: "broadcaster", account: socket.account };
      connections[channel][peerID] = newPeer;

      // Let broadcaster know about current peers (to send offers)
      socket.send({ type: "peers", from: "_channel_", target: peerID, 'peers': Object.values(connections[channel]), 'peerConfig' : peerConfig }); 

      //update stats after publisher joins
      updateStats();
  });

  socket.on("message", (message) => {
    if (DEVMODE) console.log('socket.on(message', message.type, message.from, message.target );

      // Send message to all peers except the sender
      socket.to(Array.from(socket.rooms)[1]).emit("message", message);
  });

  socket.on("messagePeer", (message) => {

    const channel = Array.from(socket.rooms)[1];

    if (!channel) 
    {
        console.log(socket.id, "ERROR socket.on(messagePeer: no channel", socket.rooms);
        return;
    }

    //sdp transform for descriptions
    if (process.env.ENFORCE_SDP) if (message.type === 'offer' || message.type === 'answer') {
      message.content.sdp = enforceSdp(message.content.sdp, socket.account);
    }

    if (DEVMODE) console.log('socket.on(messagePeer', message.type, ":", message.from,">", message.target, "@", channel );

      const { target } = message;
      const targetPeer = connections[channel][target];
      if (targetPeer) {
          io.to(targetPeer.socketId).emit("message", { ...message });
      } else {
          console.log(`Target ${target} not found in ${channel}`);
      }

  });

  socket.on("disconnecting", () => {

     //using disconnecting because socket.rooms not available on disconnect event
      const channel = Array.from(socket.rooms)[1];

      if (!channel || !connections[channel]){
            console.log(socket.id, "has disconnected (no channel) socket.rooms:", socket.rooms);
            return;
      }
      const disconnectingPeer = Object.values(connections[channel]).find((peer) => peer.socketId === socket.id);

      if (disconnectingPeer) {
         if (DEVMODE) console.log("Disconnected", socket.id, ":" ,  disconnectingPeer.peerID, "@", channel);
          // Make all peers close their peer channels
          socket.broadcast.emit("message", {
              from: disconnectingPeer.peerID,
              target: "all",
              payload: { action: "close", message: "Peer has left the signaling server" },
          });

          // remove disconnecting peer from connections
          delete connections[channel][disconnectingPeer.peerID];
        }
        else {
          console.log(socket.id, "has disconnected (unregistered peer from", channel);
       }

       //update live stats after removing connection
       updateStats();

  });

});

//handle exceptions and exit gracefully 
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// START SERVER
const PORT = process.env.PORT || 3000; //port to listen on
server.listen(PORT, () => console.log(`Server listening on PORT ${PORT}`));