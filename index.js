const express = require('express');
const { createTables, pool } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware to parse incoming JSON requests
app.use(express.json());

// Run the table creation logic on server startup
createTables();

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Backend server is running! Database tables are initialized.');
});

// API endpoint to add a new trip
app.post('/api/trips', async (req, res) => {
  console.log('Received data to save trip:', req.body);
  const { 
    userId, // We will get this from the extension
    airline, 
    bookingReference,
    departureAirport, 
    arrivalAirport, 
    departureDate,
    pricePaid 
  } = req.body;

  // Basic validation
  if (!userId || !bookingReference) {
    return res.status(400).json({ error: 'User ID and booking reference are required.' });
  }

  const insertQuery = `
    INSERT INTO flights(user_id, airline, departure_airport, arrival_airport, departure_date, original_price, last_checked_price)
    VALUES($1, $2, $3, $4, $5, $6, $6)
    RETURNING *; 
  `;
  // Note: We set original_price and last_checked_price to the same initial value.

  try {
    const values = [userId, airline, departureAirport, arrivalAirport, departureDate, pricePaid];
    const result = await pool.query(insertQuery, values);
    res.status(201).json({ message: 'Trip saved successfully!', trip: result.rows[0] });
  } catch (error) {
    console.error('Error saving trip to database:', error);
    res.status(500).json({ error: 'Failed to save trip.' });
  }
});


app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});