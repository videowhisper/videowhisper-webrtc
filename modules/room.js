// VideoWhisper Room Management Module for VideoWhisper Server
// Provides support for unlimited rooms with handling of participants, streams, and messaging

/**
 * Room Module
 * 
 * This module manages rooms for real-time communication, supporting:
 * - Multiple participants in rooms (for video conferencing)
 * - Multiple streams per room (WebRTC, RTMP, HLS, etc.)
 * - Room messaging (chat)
 * - Room actions (kick, private call, etc.)
 * 
 * Room structure maintains both server-side data and client-facing data:
 * Server structures:
 * - sockets: Socket connections of room participants
 * - channels: Stream channels used in this room
 * - params: Room parameters (not visible to clients)
 * 
 * Client-facing structures:
 * - participants: User information visible to other clients
 * - streams: Stream information available to clients
 * - messages: Chat history
 * - meta: Room parameters visible to clients
 * 
 * Server handles calls from clients:
  * - roomJoin({roomName}) : Join a room
  * - roomLeave({roomName}) : Leave a room
  * - roomPublish({roomName, streamId, parameters}) : Publish a stream to the room
  * - roomUnpublish({roomName, streamId}) : Unpublish a stream from the room
  * - roomMessage({roomName, message}) : Send a message to the room
  * - roomAction({roomName, action}) : Perform an action in the room (kick, private call, etc.)
  * 
  * Clients receives update from server:
  * - roomUpdate({roomName, update}) : Receive updates about the room state  * 
 */
module.exports = function(io, webrtcModule, connections, channels, stats, DEVMODE) {
  // Rooms state management
  let rooms = {};
  
  //settings
  const maxMessageHistory = 100; // Max messages to keep in history
  const maxMessageJoin = 10; // Max previous messages for new participants

  // Check if user is a participant in a room
  const isRoomParticipant = (socket, roomName) => {
    if (!rooms[roomName] || !rooms[roomName].sockets[socket.id]) {
      socket.emit("roomUpdate", {
        room: roomName,
        error: "You are not a participant in this room"
      });
      return false;
    }
    return true;
  };

  // get room (new or existing)
  
  const roomGet = (roomName, params = {}) => {
    if (!rooms[roomName]) {
      if (DEVMODE) console.log(`Creating new room: ${roomName}`);
      
      // Create room with both server structures and client-facing structures
      rooms[roomName] = {
        name: roomName,
        
        // Server-side structures (not exposed directly to clients)
        sockets: {},      // Map of socketId to socket object for broadcasting
        channels: {},     // Map of channelId to usage info (tracks which streams use which channels)
        
        // Client-facing structures (exposed to clients via roomUpdate)
        participants: {}, // Map of socketId to participant info (visible to other clients)
        streams: {},      // Streams published in this room
        messages: [],     // Chat history
        createdAt: Date.now(),
        
        // Room configuration - split into server params and client-visible meta
        params: params,   // Server-side configuration parameters (not shared with clients)
        meta: {}          // Client-visible metadata derived from params
      };
      
      // Initialize client-visible metadata from params if provided
      if (params.meta) {
        rooms[roomName].meta = {...params.meta};
        delete params.meta; // Remove from server params to avoid duplication
      }
      
      // Extract allowUsers, allowBroadcasters, and view if provided in params
      if (params.allowUsers) rooms[roomName].meta.allowUsers = params.allowUsers;
      if (params.allowBroadcasters) rooms[roomName].meta.allowBroadcasters = params.allowBroadcasters;
      if (params.view) rooms[roomName].meta.view = params.view;
    }
    
    return rooms[roomName];
  };

  // Get user info for participants (client-facing)
  const getUserInfo = (socket) => {
    // Return participant info (only public data)
    return {
      name: socket.user,
      joinedAt: Date.now()
    };
  };

  // Send room update to all participants
  const broadcastRoomUpdate = (roomName, data) => {
    const room = rooms[roomName];
    if (!room) return;

    // include common data
    data.room = roomName; // Include room name in the update
    data.timestamp = Date.now(); // Add timestamp to the update

    if (DEVMODE) console.log(`Broadcasting room update for ${roomName}`, data);

    // Send to all participants in the room using Socket.IO's room broadcast mechanism
    io.to(roomName).emit("roomUpdate", data);
  };

  // Join a room
  const roomJoin = (socket, roomName) => {
    // Authentication already verified in server.js before setting up handlers
    
    // Create room if it doesn't exist
    const room = roomGet(roomName);
    
    // Add user as participant if not already in the room
    if (!room.sockets[socket.id]) {
      // Get user information for client-facing participant data
      const participantInfo = getUserInfo(socket);
      
      // Store socket for broadcasting and participant info for clients
      room.sockets[socket.id] = socket;  // Store actual socket object for broadcasting
      room.participants[socket.id] = participantInfo;  // Client-facing data (only includes name and join time)
      
      // Join socket to the room
      socket.join(roomName);
      
      if (DEVMODE) console.log(`User ${socket.user} joined room: ${roomName}`);

      //limit to maximum 10 previous messages for new participants
      const messages = room.messages.slice(-maxMessageJoin);

      // Send public room data to the new participant
      socket.emit("roomUpdate", {
        room: roomName,
        participants: room.participants,
        streams: room.streams,
        messages: messages,
        meta: room.meta,
        type: "roomJoin"
      });
      
      // Notify other participants about the new join
      broadcastRoomUpdate(roomName, {participantJoin: participantInfo} );
      
      // Subscribe the user to all streams in the room (except their own)
      Object.keys(room.streams).forEach(streamId => {
        const stream = room.streams[streamId];
        // Skip if this is user's own stream
        if (stream.socketId !== socket.id) {
          // Subscribe based on the stream type
          if (stream.type === 'webrtc') {
            // Create subscription using WebRTC module
            webrtcModule.subscribeToChannel(socket, stream.channel);
          }
          // Handle other stream types in the future (RTMP, HLS, etc.)
        }
      });
      
      return true;
    }
    
    return false;
  };

  // Leave a room
  const roomLeave = (socket, roomName) => {
    // Authentication already verified in server.js before setting up handlers
    if (!isRoomParticipant(socket, roomName)) return false;
    
    const room = rooms[roomName];
    const participant = room.participants[socket.id];
    
    // Remove user's streams from the room
    const userStreams = Object.keys(room.streams).filter(
      streamId => room.streams[streamId].socketId === socket.id
    );
    
    userStreams.forEach(streamId => {
      // Handle stream removal based on type
      const stream = room.streams[streamId];
      
      // Remove stream from room
      delete room.streams[streamId];
      
      // Notify participants about stream removal
      broadcastRoomUpdate(roomName, { "streamRemove": streamId } );
      
      // Handle channel cleanup - only remove the channel if it's not used in any other room
      if (stream.type === 'webrtc') {
        // Remove this room from the channel's room list
        if (room.channels[stream.channel]) {
          delete room.channels[stream.channel];
          
          // Check if this channel is used in any other room
          const channelInUse = Object.keys(rooms).some(otherRoomName => {
            const otherRoom = rooms[otherRoomName];
            return otherRoomName !== roomName && otherRoom.channels && otherRoom.channels[stream.channel];
          });
          
          // If channel is not used anywhere else, request unpublish from WebRTC module
          if (!channelInUse) {
            webrtcModule.unpublish(socket, socket.user, stream.channel);
          }
        }
      }
      // Handle other stream types in the future (RTMP, HLS, etc.)
    });
    
    // Remove participant from both server and client structures
    delete room.sockets[socket.id];
    delete room.participants[socket.id];
    
    // Leave socket room
    socket.leave(roomName);
    
    if (DEVMODE) console.log(`User ${socket.user} left room: ${roomName}`);
    
    // Notify others about participant leaving
    broadcastRoomUpdate(roomName, { "participantLeft": participant } );
    
    // If room is now empty, remove it
    if (Object.keys(room.sockets).length === 0) {
      roomRemove(roomName);
    }
    
    return true;
  };

  // Remove a room entirely
  const roomRemove = (roomName) => {
    if (rooms[roomName]) {
      if (DEVMODE) console.log(`Removing empty room: ${roomName}`);
      delete rooms[roomName];
      return true;
    }
    return false;
  };

  // Publish a stream to a room
  const roomPublish = (socket, roomName, streamId, parameters) => {
    // Authentication already verified in server.js before setting up handlers
    if (!isRoomParticipant(socket, roomName)) return false;

    const room = rooms[roomName];

    // Check if stream already exists
    if (room.streams[streamId]) {
      if (DEVMODE) console.warn(`Stream ${streamId} already published in room ${roomName}. Ignoring.`);
      // Optionally, could update parameters here if needed
      return false;
    }

    // TODO: Add permission checks (e.g., based on room.meta.allowBroadcasters)

    // Validate parameters (basic check)
    if (!parameters || typeof parameters !== 'object') {
      socket.emit("roomUpdate", {
        room: roomName,
        error: "Invalid stream parameters for publishing."
      });
      return false;
    }

    // Add stream information to the room
    const streamInfo = {
      ...parameters,
      streamId: streamId,
      socketId: socket.id,
      user: socket.user,
      publishedAt: Date.now()
    };

    // If it's a WebRTC stream, call the WebRTC module to handle publishing
    if (parameters.type === 'webrtc') {
      // The channel name for WebRTC module is the streamId itself in this context
      const channel = streamId;
      streamInfo.channel = channel; // Store the WebRTC channel name

      // Call webrtcModule.publish - this emits the 'publish' event handled within webrtc.js
      const published = webrtcModule.publish(socket, socket.user, channel, parameters);

      if (!published) {
        // webrtcModule.publish itself doesn't usually fail unless parameters are missing,
        // actual failure (e.g., plan limits) is handled by the 'publishError' event.
        // We might log this, but the client will get publishError if applicable.
        if (DEVMODE) console.warn(`webrtcModule.publish call initiated for ${streamId} in room ${roomName}, but returned false (check parameters).`);
        // Don't add to room.streams if the initial call fails
        return false;
      }

      // Track channel usage within the room (server-side)
      if (!room.channels[channel]) room.channels[channel] = { users: 0 };
      room.channels[channel].users++; // Increment user count for this channel in this room

    } else {
      // Handle other stream types (e.g., RTMP) in the future
      console.warn(`Unsupported stream type for publishing in room: ${parameters.type}`);
      return false;
    }

    // Store the stream info in the room's state
    room.streams[streamId] = streamInfo;

    if (DEVMODE) console.log(`User ${socket.user} published ${parameters.type} stream ${streamId} in room ${roomName}`);

    // Notify other participants about the new stream
    broadcastRoomUpdate(roomName, { "streamNew": streamInfo } );

    return true;
  };

  // Unpublish a stream from a room
  const roomUnpublish = (socket, roomName, streamId) => {
    if (!isRoomParticipant(socket, roomName)) return false;

    const room = rooms[roomName];
    const stream = room.streams[streamId];

    // Check if stream exists and belongs to the user
    if (!stream || stream.socketId !== socket.id) {
      if (DEVMODE) console.warn(`Stream ${streamId} not found or does not belong to user ${socket.user} in room ${roomName}.`);
      return false;
    }

    // Remove stream from room state
    delete room.streams[streamId];

    // Notify participants
    broadcastRoomUpdate(roomName, { "streamRemove": streamId });

    // Handle WebRTC unpublishing
    if (stream.type === 'webrtc' && stream.channel) {
      const channel = stream.channel;

      // Decrement channel usage count for this room
      if (room.channels[channel]) {
        room.channels[channel].users--;
        if (room.channels[channel].users <= 0) {
          delete room.channels[channel]; // Remove channel tracking if no longer used in this room
        }
      }

      // Check if the channel is used in any OTHER room
      const channelInUseElsewhere = Object.keys(rooms).some(otherRoomName => {
        const otherRoom = rooms[otherRoomName];
        return otherRoomName !== roomName && otherRoom.channels && otherRoom.channels[channel];
      });

      // If channel is not used anywhere else, request unpublish from WebRTC module
      if (!channelInUseElsewhere) {
        webrtcModule.unpublish(socket, socket.user, channel);
      } else {
        if (DEVMODE) console.log(`Channel ${channel} still in use in other rooms, not unpublishing from webrtcModule.`);
      }
    }

    if (DEVMODE) console.log(`User ${socket.user} unpublished stream ${streamId} from room ${roomName}`);

    return true;
  };

  // Add message to room chat
  const roomMessage = (socket, roomName, message) => {
    if (!isRoomParticipant(socket, roomName)) 
      {
        if (DEVMODE) console.warn(`User ${socket.user} not in room ${roomName}, cannot send message.`);
        socket.emit("roomUpdate", {
          room: roomName,
          error: "You are not a participant in this room"
        });
        return false;
      }

    const room = rooms[roomName];

    //override system properties
    message.user = socket.user;
    message.timestamp = Date.now();

    // Add to room messages (limit history if needed)
    room.messages.push(message);
    if (room.messages.length > maxMessageHistory) {
      room.messages.shift();
    }

    // Broadcast the message
    broadcastRoomUpdate(roomName, { "messageNew": message } );

    return true;
  };

  // --- Socket Event Handlers Setup ---
  const setupRoomHandlers = (socket) => {
    if (!socket.user) {
      console.error("Cannot setup room handlers: socket.user is not defined.");
      return;
    }
    if (DEVMODE) console.log(`Room handlers set up for user ${socket.user}`);

    socket.on('roomJoin', ({ room }) => {
      if (DEVMODE) console.log(`roomJoin`, socket.user, room);
      if (room) roomJoin(socket, room);
    });

    socket.on('roomLeave', ({ room }) => {
      if (DEVMODE) console.log(`roomLeave`, socket.user, room);
      if (room) roomLeave(socket, room);
    });

    socket.on('roomPublish', ({ room, stream, parameters }) => {
      if (DEVMODE) console.log(`roomPublish`, socket.user, room, stream, parameters);
      if (room && stream && parameters) roomPublish(socket, room, stream, parameters);
    });

    socket.on('roomUnpublish', ({ room, stream }) => {
      if (DEVMODE) console.log(`roomUnpublish`, socket.user, room, stream);
      if (room && stream) roomUnpublish(socket, room, stream);
    });

    socket.on('roomMessage', ({ room, message }) => {
      if (DEVMODE) console.log(`roomMessage`, socket.user, room, message);
      if (room && message) roomMessage(socket, room, message);
    });

    // Handle disconnect within room context
    socket.on('disconnect', (reason) => {
      if (DEVMODE) console.log(`User ${socket.user} disconnected (${reason}), cleaning up rooms.`);
      // Iterate through rooms the user might be in
      Object.keys(rooms).forEach(roomName => {
        if (rooms[roomName].sockets[socket.id]) {
          roomLeave(socket, roomName); // Use roomLeave for proper cleanup
        }
      });
    });
  };

  // Return public interface
  return {
    setupRoomHandlers,
    // Expose other functions if needed for direct server interaction
    // roomGet,
    // roomRemove,
  };
};
