module.exports = {
    apps : [{
      name   : "VideoWhisper WebRTC",
      script : "./server.js",
      env_production: {
        NODE_ENV: "production",
        "PORT": 3000,
        "TOKEN": "SecretToken",
        "DEVMODE": false,
        "CERTIFICATE": "/path/to/certificate/filenames",
        "TURN_SERVER": "coturn.yourdomain.com:port",
        "TURN_USER": "coturn_user",
        "TURN_PASSWORD": "coturn_password",
        },
     env_development: {
        NODE_ENV: "development",
        "PORT": 3000,
        "TOKEN": "VideoWhisperS1",
        "DEVMODE": true,
        "CERTIFICATE": "/path/to/certificate/filenames",
        "TURN_SERVER": "coturn.yourdomain.com:port",
        "TURN_USER": "coturn_user",
        "TURN_PASSWORD": "coturn_password",
        }
    }]
  } 