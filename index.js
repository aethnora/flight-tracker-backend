const express = require('express');
const { createTables } = require('./database'); // Import the function

const app = express();
const PORT = process.env.PORT || 3001;

// Call createTables to ensure our DB is set up
createTables();

app.get('/', (req, res) => {
  res.send('Backend server is running! Database tables are initialized.');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});