module.exports = {
    apps : [{
      name   : "VideoWhisper WebRTC",
      script : "./server.js",
      env_production: {
        NODE_ENV: "production",
    "PORT": 3000,
    "TOKEN": "VideoWhisperS1",
    "DEVMODE": false,
    "CERTIFICATE": "/home/hostforstreaming/certificate/hostforstreaming.com",
    "TURN_SERVER": "hostforstreaming.com:13478",
    "TURN_USER": "VideoWhisper",
    "TURN_PASSWORD": "WhisperVideo",
     },
     env_development: {
        NODE_ENV: "development",
    "PORT": 3000,
    "TOKEN": "VideoWhisperS1",
    "DEVMODE": true,
    "CERTIFICATE": "/home/hostforstreaming/certificate/hostforstreaming.com",
    "TURN_SERVER": "hostforstreaming.com:13478",
    "TURN_USER": "VideoWhisper",
    "TURN_PASSWORD": "WhisperVideo",
     }
    }]
  } 