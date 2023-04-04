//VideoWhisper WebRTC Signaling Server

//CONFIGURATION
const PORT = process.env.PORT || 3000; //port to listen on
const TOKEN = process.env.TOKEN || "YourToken"; //token to authenticate
const DEVMODE = ( process.env.NODE_ENV || "development" ) === "development"; //development mode
const CERTIFICATE = process.env.CERTIFICATE || "/path/to/certificate/filenames"; //certificate files (.key and .crt)
const TURN_SERVER = process.env.TURN_SERVER || "coturn.yourdomain.com:port"; //i.e. coturn server
const TURN_USER = process.env.TURN_USER || "coturn_user"; //coturn user
const TURN_PASSWORD = process.env.TURN_PASSWORD || "coturn_password"; //coturn password


//SERVER
const SERVER_VERSION = "2023.04.04";
const SERVER_FEATURES = "WebRTC Signaling, SSL, TURN/STUN configuration for VideoWhisper HTML5 Videochat"

//test TURN/STUN configuration with https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ and/or https://icetest.info  
let peerConfig = {
  iceServers: [
  {   
    urls: [ "stun:" + TURN_SERVER ]
  }, 
  {   
    username: TURN_USER,   
    credential: TURN_PASSWORD,   
    urls: [       
      "turn:" + TURN_SERVER + "?transport=udp",       
      "turn:" + TURN_SERVER + "?transport=tcp",       
     ]
   }
 ]
}; 

//WEBRTC SIGNALING SERVER
const express = require('express');
const app = express();
const cors = require("cors");
app.use(express.json(), cors());
const fs = require('fs');
const https = require('https');

//i.e. cPanel > SSL/TLS > Certificates > Install : get certificate and key
const options = {
  key: fs.readFileSync(CERTIFICATE + '.key'),
  cert: fs.readFileSync(CERTIFICATE + '.crt')
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

//[GET] https://yourDomain:PORT/connections
app.get("/connections", (req, res) => {
    if (DEVMODE) console.log("API /connections", connections );
  res.json(Object.values(connections));
});

// AUTHENTICATION MIDDLEWARE
io.use((socket, next) => {
  const token = socket.handshake.auth.token; // check the auth token provided by the client upon connection
  if (token === TOKEN) {
    if (DEVMODE) console.log("Authenticated #", socket.id);
      next();
  } else {
      next(new Error("ERROR: Authentication error", socket));
  }
});

// SIGNALING LOGIC
io.on("connection", (socket) => {

  if (DEVMODE) console.log("Socket connected #", socket.id);

  //connections call join
  socket.on("join", (peerID, channel) => {

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
        if (DEVMODE) console.log(` ${peerID} joined @${channel}. Total connections in @${channel}: ${Object.keys(connections[channel]).length + 1}`);
            
          // Add new player peer
          const newPeer = { socketId: socket.id, peerID, type: "player" };
          connections[channel][peerID] = newPeer;
        
          // Let broadcaster know abouta new peer player (to send offer)
          socket.to(channel).emit("message", {
              type: "peer",
              from: peerID,
              target: "all",
              peerID: peerID,
              });
      }
  });

  socket.on("publish", (peerID, channel) => {
      //called by broadcaster when ready to publish channel (stream)

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
server.listen(PORT, () => console.log(`Server listening on PORT ${PORT}: VideoWhisper WebRTC v${SERVER_VERSION} \r\n${SERVER_FEATURES}`));