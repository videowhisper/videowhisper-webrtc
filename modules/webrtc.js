// WebRTC signaling module for VideoWhisper Server
// This module handles WebRTC including signaling, STUN/TURN configuration and testing, SDP limits enforcement, statistics.
const transform = require('sdp-transform');
const { RTCPeerConnection } = require("wrtc");
require('dotenv').config();

// peerConfig initialization
module.exports = function(io, connections, channels, stats, DEVMODE, accounts, accountIssues) {
  let peerConfig;
  // Store STUN/TURN test results and last test time
  let lastStunTurnTest = {
    stun: false,
    turn: false,
    error: null,
    timestamp: 0
  };
  
  const initialize = () => {
    // Initialize peerConfig directly here instead of passing it from server.js
    if (process.env.COTURN_SERVER) {
      peerConfig = {
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
    } else {
      peerConfig = { 
        iceServers: [{ 
          urls: "stun:stun.l.google.com:19302" 
        }] 
      };
    }
    
    if (DEVMODE) console.log(`WebRTC module initialized with peer configuration: ${JSON.stringify(peerConfig)}`);

    //check testStunTurn
    testStunTurn()
      .then(result => {
        if (DEVMODE) console.log("WebRTC STUN/TURN test result:", result);
      })
      .catch(error => {
        if (DEVMODE) console.error("WebRTC STUN/TURN test error:", error);
      });

    return peerConfig;
  };

  // Function to test STUN/TURN connectivity
  const testStunTurn = async () => {
    // Check if we have recent test results (within last 5 minutes)
    const now = Date.now();
    const cacheMs = 5 * 60 * 1000; // 5 minutes
    
    if (lastStunTurnTest.timestamp > 0 && now - lastStunTurnTest.timestamp < cacheMs) {
      // Return cached results with information about when they were last tested
      const secondsAgo = Math.round((now - lastStunTurnTest.timestamp) / 1000);
      
      if (DEVMODE) console.log(`Returning cached STUN/TURN test results from ${secondsAgo} seconds ago`);
      
      // Return cached results with timeSinceTested information
      return {
        stun: lastStunTurnTest.stun,
        turn: lastStunTurnTest.turn,
        error: lastStunTurnTest.error,
        timeSinceTested: secondsAgo
      };
    }
    
    // Perform a fresh test
    return new Promise((resolve) => {
      const config = peerConfig;

      if (!config || !config.iceServers || config.iceServers.length === 0) {
        const result = { stun: false, turn: false, error: "No ICE servers configured" };
        // Update cached results
        lastStunTurnTest = {
          ...result,
          timestamp: now
        };
        return resolve(result);
      }

      let stunAvailable = false;
      let turnAvailable = false;
      let gatheringComplete = false;
      let timedOut = false;
      
      if (DEVMODE) console.log("Testing STUN/TURN with config:", JSON.stringify(config));

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
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
        );
      };
      
      const finishTest = (error = null) => {
        if (timedOut) return; // Already resolved
        
        peer.close();
        
        // If we timed out but did find candidates, don't report an error
        if (error === "ICE candidate timeout" && (stunAvailable || turnAvailable)) {
          error = null;
        }
        
        const result = { 
          stun: stunAvailable, 
          turn: turnAvailable, 
          error: error,
          gatheringComplete: gatheringComplete 
        };
        
        if (DEVMODE) console.log("STUN/TURN test results:", result);
        
        // Update cached results
        lastStunTurnTest = {
          ...result,
          timestamp: now
        };
        
        timedOut = true;
        resolve(result);
      };
      
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          const { candidate } = event.candidate;
         // if (DEVMODE) console.log("ICE candidate:", candidate);
          
          const candidateType = parseCandidateType(candidate);

          if (candidateType === "srflx") {
            stunAvailable = true;
         //   if (DEVMODE) console.log("STUN server available (srflx candidate found)");
          }
          if (candidateType === "relay") {
            turnAvailable = true;
          //  if (DEVMODE) console.log("TURN server available (relay candidate found)");
          }
          if (candidateType === "host" && isPublicIP(candidate.split(" ")[4])) {
            stunAvailable = true;
          //  if (DEVMODE) console.log("Public host candidate found");
          }
        }
      };

      peer.onicegatheringstatechange = () => {
        if (DEVMODE) console.log("ICE gathering state changed to:", peer.iceGatheringState);
        
        if (peer.iceGatheringState === "complete") {
          gatheringComplete = true;
          if (DEVMODE) console.log("ICE gathering complete");
          finishTest();
        }
      };

      peer.createDataChannel("test");
      peer.createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .catch((err) => {
          if (DEVMODE) console.error("Error creating offer:", err);
          finishTest("Error creating offer: " + err.message);
        });

      // Extend timeout to 10 seconds to give more time for ICE gathering
      setTimeout(() => {
        if (!timedOut) {
          if (DEVMODE) console.warn("ICE gathering timed out after 10 seconds");
          finishTest("ICE candidate timeout");
        }
      }, 10000);
    });
  };

  // Function to enforce SDP parameters
  const enforceSdp = (sdp, account) => {
    // Enforce maximum resolution and frame rate
    const maxResolution = 360;
    const maxFrameRate = 15;
    const maxBitrate = 750;

    if (DEVMODE) console.log("transformSdp", account, maxResolution, maxFrameRate, maxBitrate);

    const parsedSdp = transform.parse(sdp);
    const videoMedia = parsedSdp.media.find(media => media.type === 'video');
    
    if (videoMedia) {
      videoMedia.fmtp.forEach((videoFmtp, index) => {
        const videoCodec = videoMedia.rtp[index].codec;
        const codecParameters = transform.parseParams(videoFmtp.config);
      
        codecParameters['max-fs'] = maxResolution;
        codecParameters['max-fr'] = maxFrameRate;
        codecParameters['max-mbps'] = maxResolution * maxFrameRate;

        videoFmtp.config = Object.entries(codecParameters).map(([key, value]) => `${key}=${value}`).join(';');

        // Add bitrate limitation using b=AS attribute
        videoMedia.bandwidth = [{type: 'AS', limit: maxBitrate}];
      });
    }

    return transform.write(parsedSdp);
  };

  // Function to update statistics
  const updateStats = () => {
    let accountStats = {};
    for (let channel in connections) {
      for (let peerID in connections[channel]) {
        let account = connections[channel][peerID].account;
        let params = channels[channel] || { width: 0, height: 0, bitrate: 0, frameRate:0, audioBitrate: 0};

        if (account in accountStats) {
          accountStats[account]['connections']++;
          accountStats[account]['bitrate'] += params['bitrate'];
          accountStats[account]['audioBitrate'] += params['audioBitrate'];
        } else {
          accountStats[account] = { 
            'connections': 1, 
            'bitrate': params['bitrate'], 
            'audioBitrate': params['audioBitrate'], 
            'players': 0, 
            'broadcasters': 0 
          };
        }

        if (connections[channel][peerID].type == 'player') accountStats[account]['players']++;
        if (connections[channel][peerID].type == 'broadcaster') accountStats[account]['broadcasters']++;
      }

      // Remove empty channels
      if (connections[channel] && Object.keys(connections[channel]).length == 0) 
        {
            delete connections[channel];
            if (channels[channel]) delete channels[channel];
        }
    }

    // Update the number of peers in each channel
    for (let channel in channels)
      if (channels[channel]) {
        channels[channel]['peers'] = connections[channel] ? Object.keys(connections[channel]).length : 0;
      }

    for (let account in accountIssues)
      for (let issue in accountIssues[account]) {
        if (!accountStats[account]) accountStats[account] = {};
        if (!accountStats[account]['issues']) accountStats[account]['issues'] = {};
        accountStats[account]['issues'][issue] = accountStats[account]['issues'][issue] 
          ? accountStats[account]['issues'][issue] + accountIssues[account][issue] 
          : accountIssues[account][issue];
      }

    if (DEVMODE) console.log("updateStats", accountStats);
    
    return accountStats;
  };

  // Function to update account issues
  const updateIssues = (issues, account) => {
    if (!Array.isArray(issues)) return;
    if (!accountIssues[account]) accountIssues[account] = {};   

    issues.forEach(issue => {
      accountIssues[account][issue] = accountIssues[account][issue] ? accountIssues[account][issue] + 1 : 1;
    });
  };

  // Internal function to handle subscribe logic
  const _handleSubscribe = (socket, peerID, channel) => {
    if (DEVMODE) console.log("_handleSubscribe", peerID, channel);
    if (!channel) channel = 'VideoWhisper';
    if (socket.user && socket.user !== peerID) {
      if (DEVMODE) console.warn(`Subscribe mismatch: socket.user=${socket.user}, peerID=${peerID}`);
      socket.emit("subscribeError", { from: "_server_", to: peerID,
        message: `You can not subscribe with different username than you are authenticated with: ${socket.user} != ${peerID}`
      });
      return false;
    }
    socket.join(channel);
    if (!(channel in connections)) connections[channel] = {};
    socket.peerID = peerID;
    socket.channel = channel;
    let found = peerID in connections[channel];
    if (!found) {
      const params = channels[channel];
      const account = accounts[socket.token];
      let issues = [];
      if (params && account) {
        if (stats[account.name]) {
          if (stats[account.name].bitrate + stats[account.name].audioBitrate + params.bitrate + params.audioBitrate > account.plan.totalBitrate) issues.push('totalBitrate');
          if (stats[account.name].conections > account.plan.conections) issues.push('conections');
        }
        if (issues.length) {
          if (DEVMODE) console.warn(`Subscribe rejected for ${account.name}`, params, account.plan);
          socket.emit("subscribeError", { from: "_server_", to: peerID, message: `Unfit: ${issues.join(', ')}.` });
          updateIssues(issues, account.name);
          return false;
        }
      }
      connections[channel][peerID] = { socketId: socket.id, peerID, type: "player", account: socket.account };
      const broadcaster = channels[channel]?.publisher;
      if (broadcaster) {
        const bp = connections[channel][broadcaster];
        if (bp) io.to(bp.socketId).emit("message", { type: "peer", from: "_server_", target: broadcaster, peerID });
      }
    }
    if (channels[channel]) channels[channel].peers = Object.keys(connections[channel]).length;
    return true;
  };

  // Setup socket event handlers
  const setupSocketHandlers = (socket) => {
    // SUBSCRIBE event
    socket.on("subscribe", (peerID, channel) => {
      if (DEVMODE) console.log("socket.on(subscribe", peerID, channel);
      _handleSubscribe(socket, peerID, channel);
    });

    // PUBLISH event
    socket.on("publish", (peerID, channel, params) => {
      if (DEVMODE) console.log("socket.on(publish", peerID, channel, params);
      _handlePublish(socket, peerID, channel, params);
    });

    // MESSAGE event
    socket.on("message", (message) => {
      if (DEVMODE) console.log('socket.on(message', message.type, message.from, message.target);

      // Send message to all peers except the sender
      socket.to(Array.from(socket.rooms)[1]).emit("message", message);
    });

    // MESSAGE PEER event 
    socket.on("messagePeer", (message) => {
      const channel = Array.from(socket.rooms)[1];

      if (!channel) {
        console.log(socket.id, "ERROR socket.on(messagePeer: no channel", socket.rooms);
        return;
      }

      // SDP transform for descriptions
      if (process.env.ENFORCE_SDP) {
        if (message.type === 'offer' || message.type === 'answer') {
          message.content.sdp = enforceSdp(message.content.sdp, socket.account);
        }
      }

      if (DEVMODE) console.log('socket.on(messagePeer', message.type, ":", message.from, ">", message.target, "@", channel);

      const { target } = message;
      const targetPeer = connections[channel][target];
      if (targetPeer) {
        io.to(targetPeer.socketId).emit("message", { ...message });
      } else {
        console.log(`Target ${target} not found in ${channel}`);
      }
    });
  };

  // Internal function to handle publish logic directly (pulled from socket.on("publish") handler)
  const _handlePublish = (socket, peerID, channel, params) => {
    if (DEVMODE) console.log("_handlePublish", peerID, channel, params);
    if (!channel) return false;
    // Verify authentication
    if (socket.user && socket.user !== peerID) {
      if (DEVMODE) console.warn(`WebRTC _handlePublish mismatch: socket.user=${socket.user}, peerID=${peerID}`);
      socket.emit("publishError", {
        from: "_server_",
        to: peerID,
        message: `Authentication mismatch: ${socket.user} != ${peerID}`
      });
      return false;
    }
    if (!(channel in connections)) connections[channel] = {};

    let found = false;
    if (peerID in connections[channel]) {
      found = true;
      if (DEVMODE) console.warn(`WebRTC _handlePublish ${peerID} already published in @${channel}. Updating...`);
    }

    if (params) { 
      params['publisher'] = peerID;
      params['time'] = Date.now();
      let account = accounts[socket.token];

      if (account) {
        if (DEVMODE) console.warn(`WebTC _handlePublish account ${account.name} plan`, account.plan);

        let issues = [];
        
        // Check restrictPublish setting if it exists in account.properties
        if (account.properties && account.properties.restrictPublish) {
          const restrictPublish = account.properties.restrictPublish;
          // Use peerID (the intended publishing username) for restriction checks
          if (DEVMODE) console.log(`Checking restrictPublish=${restrictPublish} for peerID=${peerID} (account=${account.name}) on channel ${channel}`);
          
          if (restrictPublish === 'username' && channel !== peerID) {
            issues.push('nameRestricted');
            if (DEVMODE) console.warn(`Channel name ${channel} doesn't match peerID ${peerID}`);
          } else if (restrictPublish === 'prefix' && !channel.startsWith(peerID)) {
            issues.push('nameRestricted');
            if (DEVMODE) console.warn(`Channel name ${channel} doesn't start with peerID ${peerID}`);
          } else if (restrictPublish === 'suffix' && !channel.endsWith(peerID)) { // Added suffix check
            issues.push('nameRestricted');
            if (DEVMODE) console.warn(`Channel name ${channel} doesn't end with peerID ${peerID}`);
          } else if (restrictPublish === 'contain' && !channel.includes(peerID)) { // Added contain check
            issues.push('nameRestricted');
            if (DEVMODE) console.warn(`Channel name ${channel} doesn't contain peerID ${peerID}`);
          }
        }

        if (params['width'] >= params['height']) {
          if (account.plan.width) if (params['width'] > account.plan.width) issues.push('width');
          if (account.plan.height) if (params['height'] > account.plan.height) issues.push('height');
        } else {
          if (account.plan.width) if (params['height'] > account.plan.width) issues.push('height');
          if (account.plan.height) if (params['width'] > account.plan.height) issues.push('width');                    
          
          if (issues.includes('width') || issues.includes('height')) issues.push('portrait');
        }

        if (account.plan.bitrate) if (params['bitrate'] > account.plan.bitrate) issues.push('bitrate');
        if (account.plan.frameRate) if (params['frameRate'] > account.plan.frameRate) issues.push('frameRate');
        if (account.plan.audioBitrate) if (params['audioBitrate'] > account.plan.audioBitrate) issues.push('audioBitrate');

        if (stats[account.name]) if (stats[account.name].bitrate + stats[account.name].audioBitrate + params['bitrate'] + params['audioBitrate'] > account.plan.totalBitrate) issues.push('totalBitrate');
        if (stats[account.name]) if (stats[account.name].conections > account.plan.conections) issues.push('conections');

        if (issues.length > 0) {
          if (DEVMODE) console.warn(`Publish rejected for ${account.name}`, issues, params, account.plan);

          socket.emit("publishError", {
            from: "_server_",
            to: peerID,
            message: `Unfit: ${issues.join(', ')}.`,
          });

          updateIssues(issues, account.name);
          
          if (found) {
            socket.leave(channel);
            delete connections[channel][peerID];

            if (DEVMODE) console.warn(`${peerID} unpublished from @${channel}. Total connections subscribed to @${channel}: ${Object.keys(connections[channel]).length}`);
          }

          if (channels[channel]) channels[channel]['peers'] = connections[channel] ? Object.keys(connections[channel]).length : 0;

          return;
        }
      }
    }

    channels[channel] = params ? params : { 
      width: 0, 
      height: 0, 
      bitrate: 0, 
      frameRate: 0, 
      audioBitrate: 0, 
      publisher: peerID, 
      time: Date.now()
    };

    if (!found) {
      socket.join(channel);
      if (!(channel in connections)) connections[channel] = {};

      socket.peerID = peerID;
      socket.channel = channel;

      // Add new broadcaster peer
      const newPeer = { socketId: socket.id, peerID, type: "broadcaster", account: socket.account };
      connections[channel][peerID] = newPeer;
    }

    // Let broadcaster know about current peers (to send offers)
    let message = { 
      type: "peers", 
      from: "_channel_", 
      target: peerID, 
      'peers': Object.values(connections[channel]), 
      'peerConfig': peerConfig 
    };
    if (DEVMODE) console.log("WebRTC _handlePublish message", message);
    socket.emit("message", message);
    //socket.send(message);

    if (channels[channel]) channels[channel]['peers'] = connections[channel] ? Object.keys(connections[channel]).length : 0;

    return true;
  };

  // Function to programmatically publish a stream - can be called from other modules
  // Returns true if publishing was successful, false otherwise
  const publish = (socket, peerID, channel, params) => {
    if (DEVMODE) console.log("webrtcModule.publish", peerID, channel, params);
    if (!socket || !peerID || !channel) {
      if (DEVMODE) console.warn("webrtcModule.publish - missing required parameters");
      return false;
    }
    // Call internal handler directly instead of emitting
    return _handlePublish(socket, peerID, channel, params);
  };
  
  // Function to programmatically unpublish a stream - can be called from other modules
  // Returns true if unpublishing was successful, false otherwise
  const unpublish = (socket, peerID, channel) => {
    if (DEVMODE) console.log("webrtcModule.unpublish", peerID, channel);
    
    // Validate required parameters
    if (!socket || !peerID || !channel) {
      if (DEVMODE) console.warn("webrtcModule.unpublish - missing required parameters");
      return false;
    }
    
    // Check if the channel exists and is published by this peerID
    if (!channels[channel] || channels[channel].publisher !== peerID) {
      if (DEVMODE) console.warn(`webrtcModule.unpublish - Channel ${channel} not found or not published by ${peerID}`);
      return false;
    }
    
    // Use the socket to emit an unpublish event
    socket.emit("unpublish", peerID, channel);
    
    // Remove the peer from the channel's connections
    if (connections[channel] && connections[channel][peerID]) {
      delete connections[channel][peerID];
      
      // If there are no more connections in this channel, remove the channel
      if (Object.keys(connections[channel]).length === 0) {
        delete connections[channel];
        if (channels[channel]) delete channels[channel];
        if (DEVMODE) console.log(`webrtcModule.unpublish - Channel ${channel} removed (empty)`);
      }
      
      if (DEVMODE) console.log(`webrtcModule.unpublish - ${peerID} unpublished from @${channel}`);
      return true;
    }
    
    return false;
  };
  
  /**
   * Programmatically subscribe a socket to a WebRTC channel.
   * Delegates to shared _handleSubscribe for consistent logic with client-initiated subscribe.
   * @returns {boolean} true if subscription succeeded, false otherwise.
   */
  const subscribeToChannel = (socket, channel) => {
    if (DEVMODE) console.log("webrtcModule.subscribeToChannel called", socket.id, channel);
    // Validate inputs
    if (!socket || !channel) {
      if (DEVMODE) console.warn("webrtcModule.subscribeToChannel - missing socket or channel");
      return false;
    }
    // Determine peerID from authentication or fallback to socket ID
    const peerID = socket.user || socket.peerID || socket.id;
    if (DEVMODE) console.log("webrtcModule.subscribeToChannel delegating to _handleSubscribe", peerID, channel);
    return _handleSubscribe(socket, peerID, channel);
  };

  // Initialize peerConfig when module is loaded
  peerConfig = initialize();

  // Return the module's public interface
  return {
    initialize,
    testStunTurn,
    setupSocketHandlers,
    publish,
    unpublish,
    subscribeToChannel,
    updateStats
  };
};

/* 
# Further Development Ideas 
 * add specific publish/subscribe approval integration API (check web server if user is allowed to publish/subscribe stream/channel) to allow platforms to restrict access to certain WebRTC channels
 - send parameters (peerID, channel, params) to web server for approval
 - receive json response with status and message
 Done:
 + generic user authentication verification implemented based on account/user/pin connection authentication - socket.user must match peerID when available
 + restrictPublish=empty/prefix/suffix/contain/username account setting to restrict publishing to channel with same name as user or prefix (starting with username)
*/