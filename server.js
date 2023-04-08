//VideoWhisper WebRTC Signaling Server
const SERVER_VERSION = "2023.04.08";
const SERVER_FEATURES = "WebRTC Signaling, SSL, TURN/STUN configuration for VideoWhisper HTML5 Videochat, MySQL accounts";

//Configuration
require('dotenv').config();
const DEVMODE = ( process.env.NODE_ENV || "development" ) === "development"; //development mode

console.log("VideoWhisper WebRTC Signaling Server", SERVER_VERSION, SERVER_FEATURES );

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

//Accounts
let accounts = {};

//If using MySQL, load accounts from the database

if (process.env.DB_HOST)
{
const Database = require('./modules/database.js');
const db = new Database();
 
db.query('SELECT * FROM accounts')
.then(rows => {
  accounts = rows.reduce((acc, row) => {
    const { id, name, token, properties } = row;
    const props = properties ? JSON.parse(properties) : {};
    if (token) {
      acc[token] = { id, name, properties: props };
    }
    return acc;
  }, {});
  console.log(`Loaded ${Object.keys(accounts).length} account(s) from the database`);
})
.catch(err => {
  console.error('Error loading accounts from the database:', err);
}).finally(() => {
  db.close();
});

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
    res.json(Object.values(connections));
  });
}

// AUTHENTICATION MIDDLEWARE
const authenticate = (socket, next) => {
  const token = socket.handshake.auth.token;
  const staticToken = process.env.STATIC_TOKEN || '';

  if (staticToken) if (token === staticToken) 
  {
    socket.account = '_static';
    if (DEVMODE) console.log ("Authenticated with STATIC_TOKEN #", socket.id);
    return next();
  }

  if (accounts.length == 0) return next(new Error("ERROR: No static token or accounts configured"));

  const account = accounts[token];
  if (account) {
    socket.account = account.name;
  
    if (account.properties.suspended) {
      console.warn(`WARNING: Connection for suspended ${account.name} attempted to connect #`, socket.id);
      return next(new Error('ERROR: Suspended account'));
    } else 
    {
      if (DEVMODE) console.log (`Authenticated with MySQL account ${account} #`, socket.id);
      next();
    }
  } else {
    next(new Error("ERROR: Authentication error"));
  }

};
io.use(authenticate);

// SIGNALING LOGIC
io.on("connection", (socket) => {

  if (DEVMODE) console.log("Socket connected #", socket.id, "from account", socket.account);

  socket.on("subscribe", (peerID, channel) => {
  //players call subscribe to channel, to get notified when published

      if (DEVMODE) console.log("socket.on(subscribe", peerID, channel);

      if (!channel) channel = 'VideoWhisper';

       socket.join(channel);
       if (!(channel in connections)) connections[channel] = {};

      // Make sure that the hostname is unique, if the hostname is already in connections, send an error and disconnect
      if (peerID in connections[channel]) {
          socket.emit("uniquenessError", {
              from: "_channel_",
              to: peerID,
              message: `${peerID} is already connected to @${channel}.`,
          });
          console.log(`ERROR: ${peerID} is already connected @${channel}`);
          socket.disconnect(true);
      } else {
        if (DEVMODE) console.log(` ${peerID} subscribed to @${channel}. Total connections subscribed to @${channel}: ${Object.keys(connections[channel]).length + 1}`);
            
          // Add new player peer
          const newPeer = { socketId: socket.id, peerID, type: "player" };
          connections[channel][peerID] = newPeer;
        
          // Let broadcaster know about the new peer player (to send offer)
          socket.to(channel).emit("message", {
              type: "peer",
              from: peerID,
              target: "all",
              peerID: peerID,
              });
      }
  });

  socket.on("publish", (peerID, channel) => {
      //broadcaster calls publish when ready to publish channel (stream)

      if (DEVMODE) console.log("socket.on(publish", peerID, channel);

      if (!channel) return;

      socket.join(channel); //broadcaster subscribes to receive new peers
      if (!(channel in connections)) connections[channel] = {};

      // Add new player peer
      const newPeer = { socketId: socket.id, peerID, type: "broadcaster" };
      connections[channel][peerID] = newPeer;

      // Let broadcaster know about current peers (to send offers)
      socket.send({ type: "peers", from: "_channel_", target: peerID, 'peers': Object.values(connections[channel]), 'peerConfig' : peerConfig }); 
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