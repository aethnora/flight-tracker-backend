const express = require('express');
const { createTables, pool } = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.method === 'POST') {
    console.log('Request body keys:', Object.keys(req.body));
  }
  next();
});

createTables();

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Enhanced Flight Tracker Backend is running! 🛫');
});

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time, COUNT(*) as total_flights FROM flights');
    res.json({
      status: 'Database connected',
      timestamp: result.rows[0].current_time,
      total_flights: result.rows[0].total_flights
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Enhanced API endpoint to save a new trip with complete data
app.post('/api/trips', async (req, res) => {
  console.log('=== ENHANCED TRIP SAVE REQUEST ===');
  
  const {
    userId,
    bookingReference,
    bookingHash,
    airline,
    departureAirport,
    arrivalAirport,
    
    // Timing information
    departureDateTime,
    arrivalDateTime,
    departureDate,
    departureTime,
    arrivalDate,
    arrivalTime,
    
    // Flight details
    flightNumber,
    aircraft,
    serviceClass,
    
    // Pricing information
    totalPrice,
    baseFare,
    taxes,
    totalPriceText,
    
    // Additional information
    passengerCount,
    scrapedAt,
    url
  } = req.body;

  console.log('Processing flight data:', {
    userId,
    bookingReference,
    airline,
    route: `${departureAirport} → ${arrivalAirport}`,
    totalPrice,
    serviceClass
  });

  // Enhanced validation
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required.' });
  }
  
  if (!bookingReference) {
    return res.status(400).json({ error: 'Booking reference is required.' });
  }

  if (!departureAirport || !arrivalAirport) {
    return res.status(400).json({ error: 'Departure and arrival airports are required.' });
  }

  try {
    // Check for duplicate booking using booking hash
    if (bookingHash) {
      const duplicateCheck = await pool.query(
        'SELECT flight_id FROM flights WHERE booking_hash = $1 AND user_id = $2',
        [bookingHash, userId]
      );
      
      if (duplicateCheck.rows.length > 0) {
        console.log('Duplicate booking detected:', bookingHash);
        return res.status(409).json({ 
          error: 'Booking already exists',
          existing_flight_id: duplicateCheck.rows[0].flight_id 
        });
      }
    }

    // Ensure user exists
    const userCheckQuery = 'SELECT user_id FROM users WHERE user_id = $1';
    const userExists = await pool.query(userCheckQuery, [userId]);
    
    if (userExists.rows.length === 0) {
      console.log('Creating new user record for:', userId);
      const insertUserQuery = `
        INSERT INTO users (user_id, email) 
        VALUES ($1, $2) 
        ON CONFLICT (user_id) DO NOTHING
      `;
      await pool.query(insertUserQuery, [userId, 'user@email.com']); // Email will be updated later
    }

    // Insert flight with complete data
    const insertQuery = `
      INSERT INTO flights(
        user_id, booking_reference, booking_hash, airline,
        departure_airport, arrival_airport,
        departure_date_time, arrival_date_time,
        departure_date, departure_time, arrival_date, arrival_time,
        flight_number, aircraft, service_class,
        total_price, base_fare, taxes_fees, total_price_text,
        original_price, last_checked_price, lowest_price_seen,
        passenger_count, booking_url, scraped_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
        $16, $17, $18, $19, $16, $16, $16, $20, $21, $22
      ) RETURNING *;
    `;

    const values = [
      userId,
      bookingReference,
      bookingHash,
      airline || 'Unknown',
      departureAirport,
      arrivalAirport,
      
      // Parse date times
      departureDateTime ? new Date(departureDateTime) : null,
      arrivalDateTime ? new Date(arrivalDateTime) : null,
      departureDate,
      departureTime,
      arrivalDate,
      arrivalTime,
      
      flightNumber,
      aircraft,
      serviceClass,
      
      // Pricing (using totalPrice for original_price, last_checked_price, lowest_price_seen)
      totalPrice,
      baseFare,
      taxes,
      totalPriceText,
      
      passengerCount || 1,
      url || window?.location?.href,
      scrapedAt ? new Date(scrapedAt) : new Date()
    ];

    console.log('Executing enhanced insert with', values.length, 'parameters');
    const result = await pool.query(insertQuery, values);
    
    const savedFlight = result.rows[0];
    
    // Create initial price history entry
    if (totalPrice) {
      const priceHistoryQuery = `
        INSERT INTO price_history (flight_id, price, source, checked_at)
        VALUES ($1, $2, $3, $4)
      `;
      await pool.query(priceHistoryQuery, [
        savedFlight.flight_id,
        totalPrice,
        airline || 'Extension Scrape',
        new Date()
      ]);
    }

    console.log('Flight saved successfully:', {
      flight_id: savedFlight.flight_id,
      booking_reference: savedFlight.booking_reference,
      route: `${savedFlight.departure_airport} → ${savedFlight.arrival_airport}`,
      price: savedFlight.total_price
    });

    res.status(201).json({ 
      message: 'Flight saved successfully!',
      flight: {
        flight_id: savedFlight.flight_id,
        booking_reference: savedFlight.booking_reference,
        airline: savedFlight.airline,
        route: `${savedFlight.departure_airport} → ${savedFlight.arrival_airport}`,
        departure_date_time: savedFlight.departure_date_time,
        total_price: savedFlight.total_price,
        service_class: savedFlight.service_class
      }
    });

  } catch (error) {
    console.error('Error saving flight:', error);
    res.status(500).json({ 
      error: 'Failed to save flight.',
      details: error.message 
    });
  }
});

// Get all trips for a user
app.get('/api/trips/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const query = `
      SELECT 
        flight_id, booking_reference, airline,
        departure_airport, arrival_airport,
        departure_date_time, arrival_date_time,
        flight_number, service_class,
        total_price, original_price, last_checked_price,
        is_active, created_at
      FROM flights 
      WHERE user_id = $1 
      ORDER BY departure_date_time DESC, created_at DESC
      LIMIT 50
    `;
    
    const result = await pool.query(query, [userId]);
    
    res.json({
      message: `Found ${result.rows.length} flights`,
      flights: result.rows
    });
  } catch (error) {
    console.error('Error fetching user flights:', error);
    res.status(500).json({ error: 'Failed to fetch flights.' });
  }
});

// Get all trips (for debugging)
app.get('/api/trips', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        flight_id, user_id, booking_reference, airline,
        departure_airport, arrival_airport, departure_date_time,
        total_price, service_class, created_at
      FROM flights 
      ORDER BY created_at DESC 
      LIMIT 20
    `);
    
    res.json({
      message: `Found ${result.rows.length} total flights`,
      flights: result.rows
    });
  } catch (error) {
    console.error('Error fetching all flights:', error);
    res.status(500).json({ error: 'Failed to fetch flights.' });
  }
});

// Get flights that need price checking
app.get('/api/flights/check-needed', async (req, res) => {
  try {
    const query = `
      SELECT flight_id, booking_reference, airline,
             departure_airport, arrival_airport, 
             departure_date_time, last_checked_at
      FROM flights 
      WHERE is_active = true 
        AND next_check_at <= NOW()
        AND departure_date_time > NOW()
      ORDER BY next_check_at ASC
      LIMIT 100
    `;
    
    const result = await pool.query(query);
    
    res.json({
      message: `Found ${result.rows.length} flights needing price checks`,
      flights: result.rows
    });
  } catch (error) {
    console.error('Error fetching flights needing checks:', error);
    res.status(500).json({ error: 'Failed to fetch flights for checking.' });
  }
});

// Get all users (for debugging)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT user_id, email, subscription_plan, created_at FROM users ORDER BY created_at DESC');
    res.json({
      message: `Found ${result.rows.length} users`,
      users: result.rows
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

app.listen(PORT, () => {
  console.log(`=== ENHANCED FLIGHT TRACKER BACKEND STARTED ===`);
  console.log(`Server listening on port ${PORT}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Database: Connected with enhanced schema`);
});