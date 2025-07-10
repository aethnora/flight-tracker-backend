const express = require('express');
const app = express();

// Render provides the PORT environment variable
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('Backend server is running!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});