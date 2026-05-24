const https = require('https');

function keepAlive(url) {
  setInterval(() => {
    https.get(url, (res) => {
      console.log(`[keep-alive] ping → ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('[keep-alive] ping failed:', err.message);
    });
  }, 14 * 60 * 1000); // every 14 minutes
}

module.exports = keepAlive;
