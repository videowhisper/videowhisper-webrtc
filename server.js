//VideoWhisper WebRTC Signaling Server
const SERVER_VERSION = "2025.04.26";
const SERVER_FEATURES = "WebRTC Signaling, SSL, TURN/STUN configuration for VideoWhisper HTML5 Videochat, MySQL accounts, MySQL plans, plan limitations for connections/bitrate/resolution/framerate, Account registration integration, NGINX server integration for RTMP/HLS stream management with stream pin validation and web server notification, STUN/TURN check, user pin authentication support, rate limiting, rooms, chat.";

//Configuration
require('dotenv').config();
const DEVMODE = ( process.env.NODE_ENV || "development" ) === "development"; //development mode

console.log("VideoWhisper Server", SERVER_VERSION, "\r", SERVER_FEATURES );

//Authentication 
if (process.env.STATIC_TOKEN) console.log("Static token configured", DEVMODE ? process.env.STATIC_TOKEN : ''); else console.log("Static token disabled");

//Account database
var accounts = {};
let accountsLoaded = false;

//for easier access
var accountsByName = {};

//Modules
let nginxModuleInstance;

//create function to update accounts, as used in multiple places
const updateAccounts = () => {
  if (process.env.DB_HOST) {
    const Database = require('./modules/database.js');
    const db = new Database();
    db.getAccounts()
      .then(accts => {
        accounts = accts;
        accountsLoaded = true;

        // Create a reverse lookup object keyed by account name for quick access
        accountsByName = {};
        for (const token in accounts) {
          const account = accounts[token];
          if (account.name) {
            accountsByName[account.name] = account;
          }
        }

        if (DEVMODE) console.log("Loaded accounts", Object.keys(accountsByName));
      
        if (nginxModuleInstance) nginxModuleInstance.updateAccounts(accounts, accountsByName);

      })
      .catch(err => {
        console.error('Error loading accounts:', err);
      });
  } else {
    console.warn("No DB_HOST configured, accounts not loaded from database");
  }
  
  // Add static account to accounts list if configured in .env
  // This happens after DB load to ensure it takes precedence
  if (process.env.STATIC_ACCOUNT && process.env.STATIC_TOKEN) {
    const staticAccount = process.env.STATIC_ACCOUNT;
    const staticToken = process.env.STATIC_TOKEN;
    
    accounts[staticToken] = {
      name: staticAccount,
      token: staticToken,
      properties: {
        loginURL: process.env.STATIC_LOGIN || null  // Store the STATIC_LOGIN URL if provided
      },
      plan: {
        // STATIC_ACCOUNT plan with generous development limits
        connections: 100, //  connections at same time
        totalBitrate: 100000, //  Mbps total account bitrate (all streams)
        bitrate: 5000,  // kbps video bitrate
        audioBitrate: 256,   //  kbps audio bitrate
        width: 1920,    // resolution width
        height: 1080,   // automatically switched limits for portrait/landscape
        frameRate: 30,     // frames per second
        streamPlayers: 100, // NGINX HLS players (per account)
      }
    };
    
    // Add to accountsByName for quick lookups
    accountsByName[staticAccount] = accounts[staticToken];
    
    accountsLoaded = true;  // Mark as loaded if using only static account

    if (DEVMODE) console.log("Added static account:", staticAccount);
  }

  if (accountsLoaded)
    {
     if (nginxModuleInstance) nginxModuleInstance.updateAccounts(accounts, accountsByName);
     if (DEVMODE) console.log("updateAccounts", accountsLoaded);
    }
};
updateAccounts();

// SERVER
const express = require('express');
const app = express();
const cors = require("cors");

// Simple rate limiting implementation that works with older Node versions
const createRateLimiter = (windowMs, maxRequests) => {
  const requests = {};
  
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Clean up old requests
    for (const storedIp in requests) {
      if (requests[storedIp].timestamp < now - windowMs) {
        delete requests[storedIp];
      }
    }
    
    // Initialize or update request tracking for this IP
    if (!requests[ip]) {
      requests[ip] = {
        count: 1,
        timestamp: now
      };
    } else {
      requests[ip].count++;
      if (requests[ip].count > maxRequests) {
        return res.status(429).send('Too many requests: ' + requests[ip].count + '/' +  (windowMs/1000) +'s. Try again in ' + Math.ceil((windowMs - (now - requests[ip].timestamp)) / 1000) + ' seconds.');
      }
    }
    
    next();
  };
};

// Simple security headers middleware compatible with older Node versions
const addSecurityHeaders = (req, res, next) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Only add strict transport security in production
  if (!DEVMODE) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  next();
};

// Apply the middlewares
app.use(express.json());
app.use(cors({
  origin: true, // Allow all origins
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(addSecurityHeaders);

const fs = require('fs');
const https = require('https');

//i.e. cPanel > SSL/TLS > Certificates > Install : get certificate and key
const options = {
  key: fs.readFileSync(process.env.CERTIFICATE  + '.key'),
  cert: fs.readFileSync(process.env.CERTIFICATE  + '.crt'),
  ca: fs.readFileSync(process.env.CERTIFICATE  + '.pem') // crt + intermediate if necessary
};
const server = https.createServer(options, app);

// Suppress deprecation warnings in production
if (!DEVMODE) {
  process.noDeprecation = true;
}

// Configure Socket.IO with modern options
const io = require('socket.io')(server, {
  cors: {
    origin: '*', // Match your CORS settings from Express
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 1e8, // 100MB for large data transmission if needed
  pingTimeout: 60000, // 1 minute
  pingInterval: 5000, // 5 seconds
  transports: ['websocket', 'polling'] // Prefer WebSocket, fallback to polling
});

// Avoid using deprecated properties
// io.eio.pingTimeout = 60000; // This was using deprecated properties
// io.eio.pingInterval = 5000;  // This was using deprecated properties

// API ENDPOINT TO DISPLAY THE CONNECTION TO THE SIGNALING SERVER
let connections = {};
let channels = {}; //webrtc channels are for streaming
let stats = {};
let accountIssues = {};

// Import modules
const webrtcModule = require('./modules/webrtc.js')(io, connections, channels, stats, DEVMODE, accounts, accountIssues);

// Pass the required dependencies to the room module
const roomModule = require('./modules/room.js')(io, webrtcModule, connections, channels, stats, DEVMODE);

//[GET] https://yourDomain:PORT/
app.get("/", async (req, res) => { // Mark function as async

  let result = {
    "server": "VideoWhisper WebRTC",
    "version": SERVER_VERSION,
    "features": SERVER_FEATURES,
    "nginx-module": (nginxModuleInstance ? true : false)
  };

  try {
      // Use the testStunTurn function from the webrtc module
      const stunTurnStatus = await webrtcModule.testStunTurn();

      let testResult = {
        "webrtc-test": stunTurnStatus.error ? `Error: ${stunTurnStatus.error}` : "STUN/TURN check passed",
        "stun": stunTurnStatus.stun,
        "turn": stunTurnStatus.turn
      };
      
      // Add the timeSinceTested as webrtcTestAge if available
      if (stunTurnStatus.timeSinceTested !== undefined) {
        testResult.webrtcTestAge = stunTurnStatus.timeSinceTested;
      }

      //add these properties to the existing result object
      result = { ...result, ...testResult };

      if (DEVMODE) console.log("API /", result);
      res.json(result);
  } catch (error) {
      let testResult = {
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

    // Validate input parameters
    if (token && !/^[a-zA-Z0-9_\-\.]+$/.test(token)) {
      return res.status(400).send('Invalid token format');
    }

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
        updateAccounts();
        res.json({ "status": "Updating Accounts" });
      }
    });
}

// Define serverUpdateStats function before using it in the Nginx module
const serverUpdateStats = () => {
  if (DEVMODE) console.log("serverUpdateStats");
  
  // Use webrtc module to update stats
  const accountStats = webrtcModule.updateStats();
  
  // Update our global stats object
  stats = accountStats;
  
  return stats;
};

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


// Add a simple authentication rate limiter
const authRateLimiter = createRateLimiter(
  10 * 60 * 1000, // 10 minutes window
  DEVMODE ? 120 : 30 // Higher limit in development
);

// Apply the authentication rate limiter to socket.io connections
// by modifying the authenticate middleware to use it
const authenticate = async (socket, next) => {
  try {
    // Simple rate limiting for socket authentication
    const mockReq = { ip: socket.handshake.address };
    const mockRes = {
      status: (code) => ({
        send: (message) => {
          next(new Error(message));
          return mockRes;
        }
      })
    };
    const mockNext = () => {
      // Continue with normal authentication flow
      authenticateSocket(socket, next);
    };
    
    // Apply rate limiting
    authRateLimiter(mockReq, mockRes, mockNext);
  } catch (error) {
    console.error('Rate limiting error:', error);
    next(new Error(DEVMODE ? `ERROR: ${error.message}` : "ERROR: Authentication error"));
  }
};

// Move the actual socket authentication logic to a separate function
const authenticateSocket = async (socket, next) => {
  try {
    // Get authentication parameters from handshake
    const token = socket.handshake.auth.token;
    const account = socket.handshake.auth.account;
    const user = socket.handshake.auth.user;
    const pin = socket.handshake.auth.pin;
    const staticToken = process.env.STATIC_TOKEN || '';
    const hideDetailedErrors = process.env.EXTRA_SECURITY === 'true' && !DEVMODE;

    // Validate input parameters (while providing detailed errors in DEVMODE)
    if (token && typeof token !== 'string') {
      const message = "Invalid token parameter";
      if (DEVMODE) console.log(`Authentication error: ${message}`);
      return next(new Error(DEVMODE ? `ERROR: ${message}` : "ERROR: Authentication error"));
    }
    
    if (token && !/^[a-zA-Z0-9_\-\.]+$/.test(token)) {
      const message = "Invalid token format";
      if (DEVMODE) console.log(`Authentication error: ${message}`);
      return next(new Error(DEVMODE ? `ERROR: ${message}` : "ERROR: Authentication error"));
    }
    
    if (account && typeof account !== 'string') {
      const message = "Invalid account parameter";
      if (DEVMODE) console.log(`Authentication error: ${message}`);
      return next(new Error(DEVMODE ? `ERROR: ${message}` : "ERROR: Authentication error"));
    }
    
    if (account && !/^[a-zA-Z0-9_\-\.]+$/.test(account)) {
      const message = "Invalid account format";
      if (DEVMODE) console.log(`Authentication error: ${message}`);
      return next(new Error(DEVMODE ? `ERROR: ${message}` : "ERROR: Authentication error"));
    }

    // Static token authentication (highest priority)
    if (staticToken && token === staticToken) {
      socket.account = '_static';
      socket.token = staticToken;

      if (DEVMODE) console.log("Authenticated with STATIC_TOKEN #", socket.id);
      return next();
    }

    // Account/user/pin authentication
    if (account && user && pin) {      
      // Check if the account exists
      if (!accountsByName[account]) {
        const errorMsg = hideDetailedErrors ? "Authentication failed" : "Account not found";
        return next(new Error(`ERROR: ${errorMsg}`));
      }

      // Check if the account supports loginURL authentication
      if (!accountsByName[account].properties || !accountsByName[account].properties.loginURL) {
        const errorMsg = hideDetailedErrors ? "Authentication failed" : "This account does not support user/pin authentication";
        return next(new Error(`ERROR: ${errorMsg}`));
      }

      try {
        // Use the account's login URL and token
        const loginURL = accountsByName[account].properties.loginURL;
        const tokenToUse = accountsByName[account].token || '';
        
        // Authenticate the user with the pin
        const authResult = await authenticateUserPin(account, user, pin, loginURL, tokenToUse);
        
        if (authResult.login === true) {
          // Authentication successful
          socket.account = account;
          socket.token = accountsByName[account].token;
          socket.user = user;

          if (DEVMODE) console.log(`Authenticated with user/pin for account ${account} user ${user} #`, socket.id);

          // Check account limits 
            const accountInfo = accountsByName[account];
            const limitError = checkAccountLimits(account, accountInfo);
            if (limitError) {
              if (DEVMODE) console.warn(`Limit check failed for ${account}: ${limitError}`);
              const errorMsg = hideDetailedErrors ? "Authentication failed" : limitError;
              return next(new Error(`ERROR: ${errorMsg}`));
            }

          return next();
        } else {
          // Authentication failed
          const errorMessage = authResult.message || 'User authentication failed';
          if (DEVMODE) console.warn(`Authentication failed for ${account}/${user}: ${errorMessage}`);
          const errorMsg = hideDetailedErrors ? "Authentication failed" : errorMessage;
          return next(new Error(`ERROR: ${errorMsg}`));
        }
      } catch (error) {
        console.error('Error during user/pin authentication:', error);
        return next(new Error('ERROR: Authentication error'));
      }
    }

    // Traditional token-based authentication (fallback for backward compatibility)
    if (!accounts) return next(new Error("ERROR: No static token configured or accounts loaded, yet"));

    const accountInfo = accounts[token];

    if (accountInfo) {
      socket.account = accountInfo.name;
      socket.token = token;

      // Check account limits
      const limitError = checkAccountLimits(accountInfo.name, accountInfo);
      if (limitError) {
        if (DEVMODE) console.warn(`Limit check failed for ${accountInfo.name}: ${limitError}`);
        const errorMsg = hideDetailedErrors ? "Authentication failed" : limitError;
        return next(new Error(`ERROR: ${errorMsg}`));
      }

      // Accept connection
      if (DEVMODE) console.log(`Authenticated with token from account ${accountInfo.name} #`, socket.id);
      return next();

    } else {
      return next(new Error("ERROR: Authentication error"));
    }
  } catch (error) {
    console.error('Authentication error:', error);
    return next(new Error(DEVMODE ? `ERROR: ${error.message}` : "ERROR: Authentication error"));
  }
};

// Function to authenticate user with account, user, pin from account.loginURL integration
// loginURL and token parameters are now provided by the authenticateSocket function
const authenticateUserPin = async (account, user, pin, loginURL, token) => {
  // No need to determine login URL or token - they are provided as parameters
  const isStaticAccount = account === process.env.STATIC_ACCOUNT;
  
  // If no loginURL was provided, authentication can't proceed
  if (!loginURL) {
    const message = 'Login URL not available';
    if (DEVMODE) console.log(`Authentication failed: ${message}`);
    return { login: false, message: DEVMODE ? message : 'Authentication failed' };
  }

  // Make the HTTP request to authenticate
  try {
    const fetch = require('node-fetch');
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(loginURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
 //     account: account, //acounts are identified by token
        token: token,
        user: user,
        pin: pin
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);

    if (!response.ok) {
      const message = `Server responded with ${response.status}: ${response.statusText}`;
      if (DEVMODE) console.log(`Authentication failed: ${message}`);
      return { login: false, message: DEVMODE ? message : 'Authentication failed' };
    }

    const result = await response.json();
    if (DEVMODE && isStaticAccount) {
      console.log(`Static account authentication result for ${account}/${user}:`, result);
    }
    return result;
  } catch (error) {
    console.error(`Error authenticating with ${isStaticAccount ? 'static account' : 'user/pin'}:`, error);
    return { 
      login: false, 
      message: DEVMODE ? `Authentication error: ${error.message}` : 'Authentication failed'
    };
  }
};

// Helper function to check account limits
// Returns null if all checks pass, or an error message if any limits are exceeded
const checkAccountLimits = (accountName, accountInfo) => {
  // Check connection limit
  if (accountInfo.plan.connections && 
      stats[accountName] && 
      stats[accountName].connections >= accountInfo.plan.connections) {
    return 'Account connection limit exceeded:' + stats[accountName].connections + '/' + accountInfo.plan.connections;
  }
  
  // Check bitrate limit
  if (accountInfo.plan.totalBitrate && 
      stats[accountName] && 
      stats[accountName].bitrate + stats[accountName].audioBitrate >= accountInfo.plan.totalBitrate) {
    return 'Account bitrate limit exceeded: ' + accountInfo.plan.totalBitrate + ' kbps';
  }
  
  // Check if account is suspended
  if (accountInfo.properties.suspended) {
    return 'Account is suspended: ' + accountName;
  }
  
  // All checks passed
  return null;
};

// Use the authentication middleware
io.use(authenticate);

// SIGNALING LOGIC
io.on("connection", (socket) => {
  if (DEVMODE) console.log("Socket connected #", socket.id, "from account", socket.account);
  
  // Setup WebRTC event handlers from module
  webrtcModule.setupSocketHandlers(socket);
  
  // Setup Room event handlers if user is authenticated with user/pin
  if (socket.user) {
    roomModule.setupRoomHandlers(socket);
    if (DEVMODE) console.log(`Room handlers set up for user ${socket.user}`);
  }

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
      // remove disconnecting peer from connections
      delete connections[channel][disconnectingPeer.peerID];
    }
    else {
      console.log(socket.id, " disconnected (unregistered peer from", channel);
    }


    //update live stats after removing connection
    serverUpdateStats();
  });
});

//handle exceptions and exit gracefully 
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Add graceful shutdown
// Flag to track shutdown in progress to prevent double shutdown
let isShuttingDown = false;

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('Received shutdown signal. Allow 10s for graceful shutdown. Closing connections...');
  
  // Close all socket.io connections first
  if (io) {
    const sockets = io.sockets.sockets;
    if (sockets) {
      // Disconnect all Socket.IO clients
      sockets.forEach(socket => {
        if (socket.connected) {
          socket.disconnect(true);
        }
      });
    }
  }
  
  // Then close the server
  server.close(() => {
    console.log('Server closed successfully');
    process.exit(0);
  });
  
  // Force close after 10 seconds if not closed gracefully
  setTimeout(() => {
    console.log('Forcing server shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// START SERVER
const PORT = process.env.PORT || 3000; //port to listen on
server.listen(PORT, () => console.log(`Server listening on PORT ${PORT}`));
