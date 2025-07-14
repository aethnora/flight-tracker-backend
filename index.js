const express = require('express');
const { createTables, pool } = require('./database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // New: Stripe initialization

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware Setup ---

// Enhanced CORS middleware (Your existing code)
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

// --- New: Stripe Webhook Endpoint ---
// This MUST come BEFORE express.json() to receive the raw request body,
// which is required for Stripe's signature verification.
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`❌ Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    const userId = session.client_reference_id;
    const stripeCustomerId = session.customer;

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    const priceId = lineItems.data[0].price.id;

    let plan = 'free';
    if (priceId === process.env.STRIPE_PRO_PLAN_PRICE_ID) {
        plan = 'pro';
    } else if (priceId === process.env.STRIPE_MAX_PLAN_PRICE_ID) {
        plan = 'max';
    }

    console.log(`✅ Successful payment for user ${userId}. Plan: ${plan}.`);

    // Update the user in your database
    try {
      await pool.query(
        `UPDATE users 
         SET subscription_plan = $1, stripe_customer_id = $2, updated_at = NOW() 
         WHERE user_id = $3`,
        [plan, stripeCustomerId, userId]
      );
      console.log(`   -> Database updated for user ${userId}.`);
    } catch (dbError) {
      console.error(`🚨 Failed to update database for user ${userId}`, dbError);
    }
  }

  res.status(200).json({ received: true });
});


// Enhanced JSON parsing with size limits (Your existing code)
app.use(express.json({ limit: '1mb' }));

// Rate limiting middleware (simple implementation) (Your existing code)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // Max requests per window per IP

app.use((req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitMap.has(clientIp)) {
    rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
  } else {
    const clientData = rateLimitMap.get(clientIp);
    
    if (now > clientData.resetTime) {
      clientData.count = 1;
      clientData.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
      clientData.count++;
      
      if (clientData.count > RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({ 
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
        });
      }
    }
  }
  
  next();
});

// Request logging with performance monitoring (Your existing code)
app.use((req, res, next) => {
  const startTime = Date.now();
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  
  if (req.method === 'POST') {
    console.log('Request body keys:', Object.keys(req.body));
  }
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// Initialize database (Your existing code)
createTables();

// --- API Endpoints ---

// Health check endpoint with detailed metrics (Your existing code)
app.get('/', (req, res) => {
  res.send('Enhanced Flight Tracker Backend v2.0 - Production Ready! 🛫');
});

app.get('/api/health', async (req, res) => {
    // ... (Your existing /api/health logic)
    try {
        const startTime = Date.now();
        const [flightCount, userCount, recentActivity] = await Promise.all([
          pool.query('SELECT COUNT(*) as total_flights FROM flights'),
          pool.query('SELECT COUNT(*) as total_users FROM users'),
          pool.query(`SELECT COUNT(*) as recent_bookings FROM flights WHERE created_at > NOW() - INTERVAL '24 hours'`)
        ]);
        const dbResponseTime = Date.now() - startTime;
        res.json({
          status: 'Database connected',
          timestamp: new Date().toISOString(),
          metrics: {
            total_flights: parseInt(flightCount.rows[0].total_flights),
            total_users: parseInt(userCount.rows[0].total_users),
            recent_bookings_24h: parseInt(recentActivity.rows[0].recent_bookings),
            db_response_time_ms: dbResponseTime
          },
          performance: {
            uptime_seconds: process.uptime(),
            memory_usage: process.memoryUsage(),
            cpu_usage: process.cpuUsage()
          }
        });
    } catch (error) {
        console.error('Database health check failed:', error);
        res.status(500).json({ status: 'Database connection failed', error: error.message, timestamp: new Date().toISOString()});
    }
});

// --- New: Stripe Checkout Endpoint ---
app.post('/create-checkout-session', async (req, res) => {
    const { priceId, userId } = req.body;

    if (!priceId || !userId) {
        return res.status(400).json({ error: 'priceId and userId are required.' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            client_reference_id: userId,
            success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}/`,
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating Stripe checkout session:', error);
        res.status(500).json({ error: 'Failed to create checkout session.' });
    }
});


// Enhanced API endpoint with comprehensive duplicate prevention (Your existing code)
app.post('/api/trips', async (req, res) => {
    // ... (Your existing /api/trips logic)
    const startTime = Date.now();
    console.log('=== ENHANCED TRIP SAVE REQUEST ===');
    const { userId, bookingReference, bookingHash, airline, departureAirport, arrivalAirport, routeText, departureDate, departureTime, arrivalDate, arrivalTime, allDates, allTimes, flightNumber, aircraftType, serviceClass, totalPrice, totalPriceText, currency, passengerInfo, scrapedAt, url } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID is required.' });
    if (!bookingReference || bookingReference === 'Not Found') return res.status(400).json({ error: 'Valid booking reference is required.' });
    if (!departureAirport || !arrivalAirport || departureAirport === 'Not Found' || arrivalAirport === 'Not Found') return res.status(400).json({ error: 'Valid departure and arrival airports are required.' });
    const airportCodeRegex = /^[A-Z]{3}$/;
    if (!airportCodeRegex.test(departureAirport) || !airportCodeRegex.test(arrivalAirport)) return res.status(400).json({ error: 'Invalid airport code format.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const duplicateChecks = [bookingHash ? client.query('SELECT flight_id FROM flights WHERE booking_hash = $1 AND user_id = $2', [bookingHash, userId]) : Promise.resolve({ rows: [] }), client.query(`SELECT flight_id FROM flights WHERE user_id = $1 AND booking_reference = $2 AND departure_airport = $3 AND arrival_airport = $4 AND departure_date = $5`, [userId, bookingReference, departureAirport, arrivalAirport, departureDate])];
        const [hashCheck, detailsCheck] = await Promise.all(duplicateChecks);
        if (hashCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Booking already exists (hash match)', existing_flight_id: hashCheck.rows[0].flight_id, duplicate_type: 'hash' });
        }
        if (detailsCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Booking already exists (details match)', existing_flight_id: detailsCheck.rows[0].flight_id, duplicate_type: 'details' });
        }
        await client.query(`INSERT INTO users (user_id, email, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()`, [userId, 'user@unknown.com']);
        const insertQuery = `INSERT INTO flights(user_id, booking_reference, booking_hash, airline, departure_airport, arrival_airport, route_text, departure_date, departure_time, arrival_date, arrival_time, all_dates, all_times, flight_number, aircraft, service_class, total_price, total_price_text, currency, original_price, last_checked_price, lowest_price_seen, passenger_info, booking_url, scraped_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $17, $17, $17, $20, $21, $22, NOW(), NOW()) RETURNING *;`;
        const values = [userId, bookingReference, bookingHash, airline || 'American Airlines', departureAirport, arrivalAirport, routeText, departureDate, departureTime, arrivalDate, arrivalTime, allDates ? JSON.stringify(allDates) : null, allTimes ? JSON.stringify(allTimes) : null, flightNumber, aircraftType, serviceClass, totalPrice, totalPriceText, currency || 'USD', passengerInfo, url, scrapedAt ? new Date(scrapedAt) : new Date()];
        const result = await client.query(insertQuery, values);
        const savedFlight = result.rows[0];
        if (totalPrice) {
            await client.query(`INSERT INTO price_history (flight_id, price, source, checked_at) VALUES ($1, $2, $3, NOW())`, [savedFlight.flight_id, totalPrice, airline || 'Extension Scrape']);
        }
        await client.query('COMMIT');
        const processingTime = Date.now() - startTime;
        res.status(201).json({ message: 'Flight saved successfully!', flight: { flight_id: savedFlight.flight_id, booking_reference: savedFlight.booking_reference, airline: savedFlight.airline, route: `${savedFlight.departure_airport} → ${savedFlight.arrival_airport}`, departure_date: savedFlight.departure_date, departure_time: savedFlight.departure_time, service_class: savedFlight.service_class, flight_number: savedFlight.flight_number, total_price: savedFlight.total_price }, performance: { processing_time_ms: processingTime } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving enhanced flight:', error);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Booking already exists (database constraint)', duplicate_type: 'constraint' });
        }
        res.status(500).json({ error: 'Failed to save flight.', details: error.message });
    } finally {
        client.release();
    }
});

// Optimized endpoint to get trips for a user with pagination (Your existing code)
app.get('/api/trips/:userId', async (req, res) => {
    // ... (Your existing /api/trips/:userId logic)
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    try {
        const [flights, totalCount] = await Promise.all([pool.query(`SELECT flight_id, booking_reference, airline, departure_airport, arrival_airport, departure_date, departure_time, arrival_date, arrival_time, flight_number, service_class, aircraft, total_price, original_price, last_checked_price, is_active, created_at, scraped_at FROM flights WHERE user_id = $1 ORDER BY COALESCE(departure_date::date, created_at::date) DESC, created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]), pool.query('SELECT COUNT(*) FROM flights WHERE user_id = $1', [userId])]);
        const totalFlights = parseInt(totalCount.rows[0].count);
        const totalPages = Math.ceil(totalFlights / limit);
        res.json({ message: `Found ${flights.rows.length} flights (page ${page} of ${totalPages})`, flights: flights.rows, pagination: { current_page: page, total_pages: totalPages, total_flights: totalFlights, per_page: limit } });
    } catch (error) {
        console.error('Error fetching user flights:', error);
        res.status(500).json({ error: 'Failed to fetch flights.' });
    }
});

// Enhanced endpoint to get all trips with filters and pagination (Your existing code)
app.get('/api/trips', async (req, res) => {
    // ... (Your existing /api/trips logic)
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const airline = req.query.airline;
    const fromDate = req.query.from_date;
    const toDate = req.query.to_date;
    try {
        let whereClause = '';
        let queryParams = [limit, offset];
        let paramIndex = 3;
        const conditions = [];
        if (airline) {
            conditions.push(`airline ILIKE $${paramIndex}`);
            queryParams.push(`%${airline}%`);
            paramIndex++;
        }
        if (fromDate) {
            conditions.push(`created_at >= $${paramIndex}`);
            queryParams.push(fromDate);
            paramIndex++;
        }
        if (toDate) {
            conditions.push(`created_at <= $${paramIndex}`);
            queryParams.push(toDate);
            paramIndex++;
        }
        if (conditions.length > 0) {
            whereClause = 'WHERE ' + conditions.join(' AND ');
        }
        const query = `SELECT flight_id, user_id, booking_reference, airline, departure_airport, arrival_airport, departure_date, departure_time, service_class, flight_number, total_price, created_at FROM flights ${whereClause} ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
        const [flights, totalCount] = await Promise.all([pool.query(query, queryParams), pool.query(`SELECT COUNT(*) FROM flights ${whereClause}`, queryParams.slice(2))]);
        const totalFlights = parseInt(totalCount.rows[0].count);
        const totalPages = Math.ceil(totalFlights / limit);
        res.json({ message: `Found ${flights.rows.length} total flights`, flights: flights.rows, pagination: { current_page: page, total_pages: totalPages, total_flights: totalFlights, per_page: limit }, filters: { airline, from_date: fromDate, to_date: toDate } });
    } catch (error) {
        console.error('Error fetching all flights:', error);
        res.status(500).json({ error: 'Failed to fetch flights.' });
    }
});

// Get system statistics (Your existing code)
app.get('/api/stats', async (req, res) => {
    // ... (Your existing /api/stats logic)
    try {
        const [userStats, flightStats, recentActivity, popularRoutes, averagePrice] = await Promise.all([pool.query(`SELECT COUNT(*) as total_users, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_users_week FROM users`), pool.query(`SELECT COUNT(*) as total_flights, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as flights_today, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as flights_week FROM flights`), pool.query(`SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as flight_count FROM flights WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY DATE_TRUNC('day', created_at) ORDER BY date DESC`), pool.query(`SELECT departure_airport || '→' || arrival_airport as route, COUNT(*) as booking_count FROM flights WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY departure_airport, arrival_airport ORDER BY booking_count DESC LIMIT 10`), pool.query(`SELECT AVG(total_price) as avg_price, MIN(total_price) as min_price, MAX(total_price) as max_price FROM flights WHERE total_price IS NOT NULL AND created_at > NOW() - INTERVAL '30 days'`)]);
        res.json({ users: userStats.rows[0], flights: flightStats.rows[0], recent_activity: recentActivity.rows, popular_routes: popularRoutes.rows, pricing: averagePrice.rows[0] });
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({ error: 'Failed to fetch statistics.' });
    }
});

// --- Final Middleware and Server Start ---

// Error handling middleware (Your existing code)
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handling (Your existing code)
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  pool.end(() => {
    console.log('Database connections closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  pool.end(() => {
    console.log('Database connections closed.');
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`=== ENHANCED FLIGHT TRACKER BACKEND v2.0 ===`);
  console.log(`Server listening on port ${PORT}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Production ready for thousands of users!`);
  console.log(`Database: Enhanced with comprehensive duplicate prevention`);
  console.log(`Features: Rate limiting, performance monitoring, pagination`);
  console.log(`   -> New: Stripe integration is active.`); // New log message
});
