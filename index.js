const express = require('express');
const { createTables, pool } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS middleware - Add this BEFORE other middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Middleware to parse incoming JSON requests
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Request body:', req.body);
  next();
});

// Run the table creation logic on server startup
createTables();

// Health check endpoint
app.get('/', (req, res) => {
  console.log('Health check endpoint hit');
  res.send('Backend server is running! Database tables are initialized.');
});

// API endpoint to add a new trip
app.post('/api/trips', async (req, res) => {
  console.log('=== TRIP SAVE REQUEST RECEIVED ===');
  console.log('Full request body:', JSON.stringify(req.body, null, 2));
  
  const { 
    userId, 
    airline, 
    bookingReference,
    departureAirport, 
    arrivalAirport, 
    departureDate,
    pricePaid 
  } = req.body;

  console.log('Extracted fields:', {
    userId,
    airline,
    bookingReference,
    departureAirport,
    arrivalAirport,
    departureDate,
    pricePaid
  });

  // Basic validation
  if (!userId || !bookingReference) {
    console.error('Validation failed: Missing userId or bookingReference');
    return res.status(400).json({ error: 'User ID and booking reference are required.' });
  }

  // First, ensure user exists in users table
  try {
    const userCheckQuery = 'SELECT user_id FROM users WHERE user_id = $1';
    const userExists = await pool.query(userCheckQuery, [userId]);
    
    if (userExists.rows.length === 0) {
      console.log('User not found, creating new user record');
      const insertUserQuery = 'INSERT INTO users (user_id, email) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING';
      await pool.query(insertUserQuery, [userId, 'unknown@email.com']); // You might want to pass email from frontend
    }
  } catch (error) {
    console.error('Error checking/creating user:', error);
  }

  const insertQuery = `
    INSERT INTO flights(user_id, airline, departure_airport, arrival_airport, departure_date, original_price, last_checked_price, last_checked_at)
    VALUES($1, $2, $3, $4, $5, $6, $6, NOW())
    RETURNING *; 
  `;

  try {
    const values = [userId, airline, departureAirport, arrivalAirport, departureDate, pricePaid];
    console.log('Executing query with values:', values);
    
    const result = await pool.query(insertQuery, values);
    console.log('Trip saved successfully:', result.rows[0]);
    
    res.status(201).json({ 
      message: 'Trip saved successfully!', 
      trip: result.rows[0] 
    });
  } catch (error) {
    console.error('Error saving trip to database:', error);
    res.status(500).json({ error: 'Failed to save trip.' });
  }
});

app.listen(PORT, () => {
  console.log(`=== SERVER STARTED ===`);
  console.log(`Server listening on port ${PORT}`);
  console.log(`Time: ${new Date().toISOString()}`);
});