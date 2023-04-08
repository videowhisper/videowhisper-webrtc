module.exports = {
    apps : [{
      name   : "VideoWhisper WebRTC",
      script : "./server.js",
      env_production: {
        NODE_ENV: "production",
        "DEVMODE": false,
        },
      env_development: {
        NODE_ENV: "development",
        "DEVMODE": true,
        }
    }]
  } 