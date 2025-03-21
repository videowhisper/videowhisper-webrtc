//VideoWhisper WebRTC Signaling Server
const SERVER_VERSION = "2025.03.21";
const SERVER_FEATURES = "WebRTC Signaling, SSL, TURN/STUN configuration for VideoWhisper HTML5 Videochat, MySQL accounts, MySQL plans, plan limitations for connections/bitrate/resolution/framerate, Account registration integration, NGINX server integration for RTMP/HLS stream management with stream pin validation and web server notification, STUN/TURN check.";

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
var accountIssues = {};

const serverUpdateStats = () => {
  if (DEVMODE) console.log("serverUpdateStats");
  updateStats();
};

let nginxModuleInstance;

//If using MySQL, load accounts & plans from the database
if (process.env.DB_HOST)
{
const Database = require('./modules/database.js');
const db = new Database();
db.getAccounts()
  .then(accts => {
     accounts = accts;
     accountsLoaded = true;
     if (nginxModuleInstance) nginxModuleInstance.updateAccounts(accounts);
    
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

//STUN/TURN Checks
const { RTCPeerConnection } = require("wrtc");

// Function to test STUN/TURN connectivity
async function testStunTurn() {
  return new Promise((resolve) => {
      const config = peerConfig; // Use existing peerConfig

      if (!config || !config.iceServers || config.iceServers.length === 0) {
          return resolve({ stun: false, turn: false, error: "No ICE servers configured" });
      }

      let stunAvailable = false;
      let turnAvailable = false;

      const peer = new RTCPeerConnection(config);

      const parseCandidateType = (candidate) => {
        const parts = candidate.split(' ');
        const typIndex = parts.indexOf('typ');
        return typIndex > -1 ? parts[typIndex + 1] : null;
      };

      const isPublicIP = (ip) => {
        if (!ip) return false;
        return !(
          ip.startsWith("10.") ||
          ip.startsWith("192.168.") ||
          ip.startsWith("127.") ||
          ip.startsWith("169.254.") ||
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip) // 172.16.0.0 – 172.31.255.255
        );
      };
      
      peer.onicecandidate = (event) => {
          if (event.candidate) {
              const { candidate } = event.candidate;
              const candidateType = parseCandidateType(candidate);

              if (candidateType === "srflx") stunAvailable = true; // STUN success
              if (candidateType === "relay") turnAvailable = true; // TURN success
              if (candidateType === "host" && isPublicIP(candidate.split(" ")[4])) stunAvailable = true; //If the server is  on a public IP with no NAT, STUN may not return srflx because it’s not needed.

          }
      };

      peer.onicegatheringstatechange = () => {
          if (peer.iceGatheringState === "complete") {
              peer.close();
              resolve({ stun: stunAvailable, turn: turnAvailable });
          }
      };

      // Create and set a dummy offer to trigger ICE gathering
      peer.createDataChannel("test");
      peer.createOffer()
          .then((offer) => peer.setLocalDescription(offer))
          .catch(() => resolve({ stun: false, turn: false, error: "ICE candidate error" }));

      // Timeout to prevent indefinite waiting
      setTimeout(() => {
          peer.close();
          resolve({ stun: stunAvailable, turn: turnAvailable, error: "ICE candidate timeout" });
      }, 5000);
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
  cert: fs.readFileSync(process.env.CERTIFICATE  + '.crt'),
  ca: fs.readFileSync(process.env.CERTIFICATE  + '.pem') // crt + intermediate if necessary
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
app.get("/", async (req, res) => { // Mark function as async 
 
  let result = {
    "server": "VideoWhisper WebRTC",
    "version": SERVER_VERSION,
    "features": SERVER_FEATURES,
    "nginx-module": (nginxModuleInstance ? true : false)
  };

  try {
      const stunTurnStatus = await testStunTurn(); // Check STUN/TURN availability

      let testResult = 
     {
        "webrtc-test": stunTurnStatus.error ? `Error: ${stunTurnStatus.error}` : "STUN/TURN check passed",
        "stun": stunTurnStatus.stun,
        "turn": stunTurnStatus.turn
    };

      //add these properties to the existing result object
      result = { ...result, ...testResult };


      if (DEVMODE) console.log("API /", result);
      res.json(result);

  } catch (error) {
     let  testResult = {
        "webrtc-test": "Error while checking STUN/TURN",
        "stun": false,
        "turn": false
    };

    result = { ...result, ...testResult };

      console.error("Error checking STUN/TURN:", error, result);
      res.json(result);
  }
});

const API_KEY = process.env.API_KEY;
if (DEVMODE || API_KEY)
{
  //[GET] https://yourDomain:PORT/connections?apikey=YOUR_API_KEY
  app.get("/connections", (req, res) => {

      const apikey = req.query.apikey;
      if (DEVMODE) console.log("API /connections", connections, API_KEY, apikey );

      if (apikey != API_KEY && !DEVMODE) return res.status(401).send('Invalid API key');
      else
      res.json(Object.entries(connections));
  });

  //[GET] https://yourDomain:PORT/channels?apikey=YOUR_API_KEY
  app.get("/channels", (req, res) => {

      const apikey = req.query.apikey;
      if (DEVMODE) console.log("API /channels", channels, API_KEY, apikey );

    if (apikey != API_KEY && !DEVMODE) return res.status(401).send('Invalid API key');
    else
    res.json(Object.entries(channels));
  });

  //[GET] https://yourDomain:PORT/status?apikey=API_KEY&token=ACCOUNT_TOKEN
    app.get("/status", (req, res) => {

    const apikey = req.query.apikey;
    const token = req.query.token;

    if (!token && apikey != API_KEY && !DEVMODE) return res.status(401).send('Invalid API key and no account token');

    if (DEVMODE) console.log("API /status", stats, apikey, token );

    let result = {};

    if (token)
    {
      //account status

      //check if account with that token exists
      if (accounts[token])
      {
        const account = accounts[token].name;
        const accountInfo = accounts[token];
     
        result['account'] = account;

        if (stats[account]) 
          {
            result['status'] = 'Active';
            //add stats[account];
            result['stats'] = stats[account];            

            //add webrtc channels
            let webrtc = {};
            for (let channel in connections) //for each channel
            {
              for (let peerID in connections[channel]) //for each connection
              {
                let peerAccount = connections[channel][peerID].account;
                if (peerAccount == account)
                {
                  if (!webrtc[channel]) {
                      webrtc[channel] = channels[channel]; 
                     // webrtc[channel]['connections'] = connections[channel] ? Object.keys(connections[channel]).length : 0;
                  }
                  break; 
                }
              }
            }
            result['webrtc'] = webrtc;
            //end active account
          }
        else result['status'] = 'Inactive';

        if (accountInfo && accountInfo.plan) result['plan'] = accountInfo.plan;

        res.json(result);
      }
      else 
      {
        if (DEVMODE) console.warn("API /status Invalid account token", token);
        return res.status(401).send('Invalid account token');
      }
    }
    else 
    {
      if (DEVMODE) console.warn("API /status ALL");
      result['connections'] = Object.keys(connections).length;
      result['stats'] = stats;
      result['webrtc'] = channels;
      res.json(result);
    }
    

  });


  //[GET] https://yourDomain:PORT/update-accounts?apikey=YOUR_API_KEY
  app.get("/update-accounts", (req, res) => {
      
      const apikey = req.query.apikey;
      if (DEVMODE) console.log("API /update-accounts", API_KEY, apikey );
  
      if (apikey != API_KEY && !DEVMODE) return res.status(401).send('Invalid API key');
      else
      {
        if (process.env.DB_HOST)
        {
          const Database = require('./modules/database.js');
          const db = new Database();
          db.getAccounts()
            .then(accts => {
              accounts = accts;
              accountsLoaded = true;

              if (nginxModuleInstance) nginxModuleInstance.updateAccounts(accounts); //also update for nginx module
            })
            .catch(err => {
              console.error('Error loading accounts:', err);
            });
        }
  
        res.json({ "status": "Updating Accounts" });
      }
    });
}

//Nginx RTMP/HLS module
if (process.env.NGINX_HOST) {
  const NGINX_HOST = process.env.NGINX_HOST;

  if (fs.existsSync('./modules/nginx.js')) {
    const nginxModule = require('./modules/nginx'); 
    nginxModuleInstance = nginxModule(app, DEVMODE, serverUpdateStats);
  } else {
    console.warn('Nginx module is missing. Ask https://consult.videowhisper.com for details about the nginx RTMP/HLS integration module.');
  }

} else if (DEVMODE) {
  console.log('Nginx module disabled');
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
      if (DEVMODE) console.warn(`Connection limit reached for ${account.name} #`, stats[account.name].connections, socket.id );
      return next(new Error('ERROR: Connection limit exceeded'));
    } 

    if (account.plan.totalBitrate) if (stats[account.name]) if (stats[account.name].bitrate + stats[account.name].audioBitrate >= account.plan.totalBitrate )
    {
      if (DEVMODE) console.warn(`Total bitrate limit reached for ${account.name} `, stats[account.name].bitrate, socket.id );
      return next(new Error('ERROR: Bitrate limit exceeded'));
    } 

    if (account.properties.suspended) {
      if (DEVMODE) console.warn(`Suspended account ${account.name} `, socket.id);
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

    //clean up connections for channel if no peers
    if (connections[channel] && Object.keys(connections[channel]).length == 0) delete connections[channel];
  }

  //update channel peers
  for (let channel in channels)
  if (channels[channel]) {
    channels[channel]['peers'] = connections[channel] ? Object.keys(connections[channel]).length : 0;

    //delete if no peers and more than 5 minutes old
    if (channels[channel]['peers'] == 0 && Date.now() - channels[channel]['time'] > 300000) delete channels[channel];
  }

        //update account issues
        for (let account in accountIssues)
          for (let issue in accountIssues[account])
          {
            if (!accountStats[account]) accountStats[account] = {};
            if (!accountStats[account]['issues']) accountStats[account]['issues'] = {};
            accountStats[account]['issues'][issue] = accountStats[account]['issues'][issue] ? accountStats[account]['issues'][issue] + accountIssues[account][issue] : accountIssues[account][issue];
          }

  if (nginxModuleInstance) accountStats = nginxModuleInstance.addStats(accountStats); //include nginx stats

  stats = accountStats;
  if (DEVMODE) console.log("updateStats", stats);
}

const updateIssues = (issues, account) =>
  {
    if (!Array.isArray(issues)) return;
    if (!accountIssues[account]) accountIssues[account] = {};   

    issues.forEach(issue => {
        accountIssues[account][issue] = accountIssues[account][issue] ? accountIssues[account][issue] + 1 : 1;
    });

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

      let found = false;
      if (peerID in connections[channel]) {
        found = true;
        /*
              // Make sure that the hostname is unique, if the hostname is already in connections, send an error and disconnect
          socket.emit("uniquenessError", {
              from: "_channel_",
              to: peerID,
              message: `${peerID} already in @${channel}.`,
          });
          console.log(`ERROR: ${peerID} is already connected @${channel}`);
          socket.disconnect(true);
          */
         if (DEVMODE) console.warn(` ${peerID} is already subscribed to @${channel}`);
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
          
            if (DEVMODE) console.warn(`Subscribe rejected for ${account.name}`, params, account.plan );

            socket.emit("subscribeError", {
              from: "_server_",
              to: peerID,
              message: `Unfit: ${issues.join(', ')}.`,
          });

          //update account issues
          updateIssues(issues, account.name);
      
          if (found)
          {
            //leave channel and remove from connections
            socket.leave(channel);
            delete connections[channel][peerID];

            if (DEVMODE) console.warn(`${peerID} unsubscribed from @${channel}. Total connections subscribed to @${channel}: ${Object.keys(connections[channel]).length}`);
          }

          //update channel connections
            if (channels[channel]) channels[channel]['peers'] = connections[channel] ? Object.keys(connections[channel]).length : 0;

            return ;

          }

        }

        if (!found)
        {
        if (DEVMODE) console.log(` ${peerID} subscribed to @${channel}. Total connections subscribed to @${channel}: ${Object.keys(connections[channel]).length + 1}`);
            
          // Add new player peer
          const newPeer = { socketId: socket.id, peerID, type: "player", account: socket.account };
          connections[channel][peerID] = newPeer;
        }

          // Let broadcaster know about the new peer player (to send offer)
          socket.to(channel).emit("message", {
              type: "peer",
              from: peerID,
              target: "all",
              peerID: peerID,
              });

       }

         //update subscriber count
         if (channels[channel]) channels[channel]['peers'] = Object.keys(connections[channel]).length;
    
      updateStats();
  });

  socket.on("publish", (peerID, channel, params) => {
      //broadcaster calls publish when ready to publish channel (stream)

      if (DEVMODE) console.log("socket.on(publish", peerID, channel, params);

      if (!channel) return;

      if (! (channel in connections) ) connections[channel] = {};

      let found = false;
      if (peerID in connections[channel]) {
        found = true;
        /*
        socket.emit("uniquenessError", {
            from: "_channel_",
            to: peerID,
            message: `${peerID} already in @${channel}.`,
        });
        console.log(`ERROR: ${peerID} is already connected @${channel}`);
        socket.disconnect(true);
        */
       if (DEVMODE) console.warn(`${peerID} already published in @${channel}. Updating...`);
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

          //stream limits
          if (params['width'] >= params['height'])
          {
          //landscape: width > height
          if (account.plan.width) if (params['width'] > account.plan.width) issues.push('width');
          if (account.plan.height) if (params['height'] > account.plan.height) issues.push('height' );
          }
          else {
            //portrait (inverted on phones): height > width, swap limits
            if (account.plan.width) if (params['height'] > account.plan.width) issues.push('height');
            if (account.plan.height) if (params['width'] > account.plan.height) issues.push('width' );  
                    
            //if height or width in issues, also add 'portrait' issue
            if (issues.includes('width') || issues.includes('height')) issues.push('portrait');
          }

          if (account.plan.bitrate) if (params['bitrate'] > account.plan.bitrate) issues.push( 'bitrate' );
          if (account.plan.frameRate) if (params['frameRate'] > account.plan.frameRate) issues.push('frameRate' );
          if (account.plan.audioBitrate) if (params['audioBitrate'] > account.plan.audioBitrate) issues.push('audioBitrate' );

          //cummulative limits
          if (stats[account.name]) if (stats[account.name].bitrate + stats[account.name].audioBitrate + params['bitrate'] + params['audioBitrate'] > account.plan.totalBitrate ) issues.push('totalBitrate' );
          if (stats[account.name]) if (stats[account.name].conections > account.plan.conections ) issues.push( 'conections' );

          if (issues.length > 0)
          {
            if (DEVMODE) console.warn(`Publish rejected for ${account.name}`, issues, params, account.plan );

            socket.emit("publishError", {
              from: "_server_",
              to: peerID,
              message: `Unfit: ${issues.join(', ')}.`,
          });

          //add to account issues
          updateIssues(issues, account.name);
          
          if (found)  //leave channel and remove from connections
          {
            socket.leave(channel);
            delete connections[channel][peerID];

            if (DEVMODE) console.warn(`${peerID} unpublished from @${channel}. Total connections subscribed to @${channel}: ${Object.keys(connections[channel]).length}`);
          }

          if (channels[channel]) channels[channel]['peers'] = connections[channel] ? Object.keys(connections[channel]).length : 0;

            return ;

          }

         }

      }

      //save channel params
      channels[channel] = params ? params : { width: 0, height: 0, bitrate: 0, frameRate:0, audioBitrate: 0, publisher: peerID, time: Date.now()};

      if (!found) 
      {
      socket.join(channel); //broadcaster subscribes to receive new peers
      if (!(channel in connections)) connections[channel] = {};

      socket.peerID = peerID;
      socket.channel = channel;

      // Add new player peer
      const newPeer = { socketId: socket.id, peerID, type: "broadcaster", account: socket.account };
      connections[channel][peerID] = newPeer;
      }

      // Let broadcaster know about current peers (to send offers)
      socket.send({ type: "peers", from: "_channel_", target: peerID, 'peers': Object.values(connections[channel]), 'peerConfig' : peerConfig }); 
      

      //
      if (channels[channel]) channels[channel]['peers'] = connections[channel] ? Object.keys(connections[channel]).length : 0;

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
              payload: { action: "close", message: disconnectingPeer.peerID + " left @" + channel },
          });

          // remove disconnecting peer from connections
          delete connections[channel][disconnectingPeer.peerID];
        }
        else {
          console.log(socket.id, " disconnected (unregistered peer from", channel);
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