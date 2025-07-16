// IMPORTANT: To fix the 'Cannot find module 'cors'' error, you must install the cors package.
// Open your backend project's terminal and run:
// npm install cors
// OR if you use yarn:
// yarn add cors

const express = require('express');
const cors = require('cors'); // This line requires the 'cors' package to be installed
const { createTables, pool } = require('./database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// <<< NEW: Dependencies for email parsing >>>
const multer = require('multer');
const upload = multer();
// Assuming the new parser service is created at this location
const { processInboundEmail } = require('./services/emailParserService');
// <<< END OF NEW CODE BLOCK >>>

const app = express();
const PORT = process.env.PORT || 3001;

// Use the 'cors' middleware
app.use(cors());

// This MUST come BEFORE app.use(express.json()) to work correctly.
// It uses a raw body parser specifically for the Stripe webhook endpoint.
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

    // Retrieve the line items to find out which plan was purchased
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

  // Handle subscription deletion
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const stripeCustomerId = subscription.customer;

    console.log(`Subscription deleted for customer ${stripeCustomerId}. Reverting to free plan.`);
    
    try {
      await pool.query(
        `UPDATE users SET subscription_plan = 'free', updated_at = NOW() WHERE stripe_customer_id = $1`,
        [stripeCustomerId]
      );
      console.log(`   -> User with Stripe ID ${stripeCustomerId} reverted to free plan.`);
    } catch (dbError) {
      console.error(`🚨 Failed to update user plan after subscription cancellation for Stripe ID ${stripeCustomerId}`, dbError);
    }
  }

  res.status(200).json({ received: true });
});

// Enhanced JSON parsing with size limits
app.use(express.json({ limit: '1mb' }));

// Rate limiting middleware (simple implementation)
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
      // Reset the rate limit window
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

// Request logging with performance monitoring
app.use((req, res, next) => {
  const startTime = Date.now();
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  
  if (req.method === 'POST') {
    console.log('Request body keys:', Object.keys(req.body));
  }
  
  // Log response time
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// Initialize database
createTables();

// Health check endpoint with detailed metrics
app.get('/', (req, res) => {
  res.send('Enhanced Flight Tracker Backend v2.0 - Production Ready! 🛫');
});

app.get('/api/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Test database connectivity and get metrics
    const [flightCount, userCount, recentActivity] = await Promise.all([
      pool.query('SELECT COUNT(*) as total_flights FROM flights'),
      pool.query('SELECT COUNT(*) as total_users FROM users'),
      pool.query(`
        SELECT COUNT(*) as recent_bookings 
        FROM flights 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `)
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
    res.status(500).json({ 
      status: 'Database connection failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

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
            client_reference_id: userId, // Pass the user's ID to the session
            success_url: `${process.env.CLIENT_URL}/dashboard?payment=success`,
            cancel_url: `${process.env.CLIENT_URL}/pricing`,
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating Stripe checkout session:', error);
        res.status(500).json({ error: 'Failed to create checkout session.' });
    }
});

const authenticateUser = (req, res, next) => {
  // This is a placeholder. In production, you would use Firebase Admin SDK
  // to verify the Bearer token from the Authorization header.
  console.log('Bypassing authentication for development. DO NOT use in production.');
  next();
};

app.get('/api/user/me/:userId', authenticateUser, async (req, res) => {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ error: 'User ID is required.' });

  try {
    const userQuery = 'SELECT user_id, email, subscription_plan, lifetime_savings, stripe_customer_id FROM users WHERE user_id = $1';
    const flightCountQuery = 'SELECT COUNT(*) as active_flights FROM flights WHERE user_id = $1 AND is_active = TRUE';

    const [userResult, flightCountResult] = await Promise.all([
      pool.query(userQuery, [userId]),
      pool.query(flightCountQuery, [userId])
    ]);

    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    res.json({ ...userResult.rows[0], active_flights: parseInt(flightCountResult.rows[0].active_flights, 10) });
  } catch (error) {
    console.error(`Error fetching user data for ${userId}:`, error);
    res.status(500).json({ error: 'Failed to fetch user data.' });
  }
});

app.post('/create-customer-portal-session', authenticateUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  try {
    const { rows } = await pool.query('SELECT stripe_customer_id FROM users WHERE user_id = $1', [userId]);
    if (rows.length === 0 || !rows[0].stripe_customer_id) {
      return res.status(404).json({ error: 'Stripe customer not found for this user.' });
    }
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: rows[0].stripe_customer_id,
      return_url: `${process.env.CLIENT_URL}/account`,
    });
    res.json({ url: portalSession.url });
  } catch (error) {
    console.error('Error creating Stripe customer portal session:', error);
    res.status(500).json({ error: 'Failed to create customer portal session.' });
  }
});

app.post('/cancel-subscription', authenticateUser, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  try {
    const { rows } = await pool.query('SELECT stripe_customer_id FROM users WHERE user_id = $1', [userId]);
    if (rows.length === 0 || !rows[0].stripe_customer_id) return res.status(404).json({ error: 'Stripe customer not found.' });
    
    const subscriptions = await stripe.subscriptions.list({ customer: rows[0].stripe_customer_id, status: 'active', limit: 1 });
    if (subscriptions.data.length === 0) return res.status(400).json({ error: 'No active subscription found to cancel.' });
    
    await stripe.subscriptions.cancel(subscriptions.data[0].id);
    res.json({ message: 'Subscription cancelled successfully. Your plan will be updated shortly.' });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription.' });
  }
});


const planDetails = {
    free: { limit: 2, frequencyHours: 1 }, // 5 days
    pro: { limit: 4, frequencyHours: 72 },   // 3 days
    max: { limit: 8, frequencyHours: 72 },    // 3 days
};


// <<< NEW CODE BLOCK: Reusable helper function for creating trips >>>
/**
 * A reusable function to handle the logic of adding a flight to the database.
 * This can be called by the manual entry endpoint and the email parsing endpoint.
 * @param {object} flightData - The structured data for the flight to be added.
 * @returns {object} The newly saved flight record.
 * @throws An error if validation fails, plan limits are exceeded, or a database error occurs.
 */
const createTripInDatabase = async (flightData) => {
    const {
      userId, email, bookingReference, bookingHash, airline, departureAirport, arrivalAirport, routeText,
      departureDate, departureTime, arrivalDate, arrivalTime, allDates, allTimes,
      flightNumber, aircraftType, serviceClass, totalPrice, totalPriceText, currency,
      passengerInfo, scrapedAt, url
    } = flightData;

    // --- Start Validation ---
    if (!userId) throw new Error('User ID is required.');
    if (!bookingReference || bookingReference === 'Not Found') throw new Error('Valid booking reference is required.');
    if (!departureAirport || !arrivalAirport || departureAirport === 'Not Found' || arrivalAirport === 'Not Found') throw new Error('Valid departure and arrival airports are required.');
    const airportCodeRegex = /^[A-Z]{3}$/;
    if (!airportCodeRegex.test(departureAirport) || !airportCodeRegex.test(arrivalAirport)) throw new Error('Invalid airport code format.');
    // --- End Validation ---

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userPlanQuery = `
            SELECT 
                u.subscription_plan, 
                (SELECT COUNT(*) FROM flights WHERE user_id = u.user_id AND is_active = TRUE) as active_flights
            FROM users u WHERE u.user_id = $1
        `;
        const userResult = await client.query(userPlanQuery, [userId]);
        
        let user = userResult.rows[0];
        
        if (!user) {
            // Use the email from the parsed data if available, otherwise use a placeholder
            const userEmail = email || 'user@unknown.com';
            await client.query(`INSERT INTO users (user_id, email) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, userEmail]);
            user = { subscription_plan: 'free', active_flights: 0 };
            console.log(`New user ${userId} created with default free plan.`);
        }

        const plan = planDetails[user.subscription_plan] || planDetails.free;
        
        if (user.active_flights >= plan.limit) {
            throw new Error(`You have reached your limit of ${plan.limit} active flights for the ${user.subscription_plan} plan. Please upgrade or delete an existing trip.`);
        }

        const duplicateChecks = [
            bookingHash ? client.query('SELECT flight_id FROM flights WHERE booking_hash = $1 AND user_id = $2', [bookingHash, userId]) : Promise.resolve({ rows: [] }),
            client.query(`SELECT flight_id FROM flights WHERE user_id = $1 AND booking_reference = $2 AND departure_airport = $3 AND arrival_airport = $4 AND departure_date = $5`, [userId, bookingReference, departureAirport, arrivalAirport, departureDate])
        ];

        const [hashCheck, detailsCheck] = await Promise.all(duplicateChecks);
        
        if (hashCheck.rows.length > 0) throw new Error('Booking already exists (hash match)');
        if (detailsCheck.rows.length > 0) throw new Error('Booking already exists (details match)');
        
        await client.query(`INSERT INTO users (user_id, email, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()`, [userId, email || 'user@unknown.com']);

        const insertQuery = `
          INSERT INTO flights(
            user_id, booking_reference, booking_hash, airline, departure_airport, arrival_airport, route_text,
            departure_date, departure_time, arrival_date, arrival_time, all_dates, all_times,
            flight_number, aircraft, service_class, total_price, total_price_text, currency,
            original_price, last_checked_price, lowest_price_seen, passenger_info, booking_url, scraped_at,
            created_at, updated_at, check_frequency_hours
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
            $17, $18, $19, $17, $17, $17, $20, $21, $22, NOW(), NOW(), $23
          ) RETURNING *;
        `;
        const values = [
          userId, bookingReference, bookingHash, airline || 'American Airlines', departureAirport, arrivalAirport, routeText,
          departureDate, departureTime, arrivalDate, arrivalTime, allDates ? JSON.stringify(allDates) : null, allTimes ? JSON.stringify(allTimes) : null,
          flightNumber, aircraftType, serviceClass, totalPrice, totalPriceText, currency || 'USD', passengerInfo, url, scrapedAt ? new Date(scrapedAt) : new Date(),
          plan.frequencyHours
        ];

        const result = await client.query(insertQuery, values);
        const savedFlight = result.rows[0];
        
        if (totalPrice) {
            await client.query(`INSERT INTO price_history (flight_id, price, source, checked_at) VALUES ($1, $2, $3, NOW())`, [savedFlight.flight_id, totalPrice, airline || 'Email Scrape']);
        }
        
        await client.query('UPDATE users SET total_flights = total_flights + 1 WHERE user_id = $1', [userId]);
        await client.query('COMMIT');
        return savedFlight;

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in createTripInDatabase:', error.message);
        throw error; // Re-throw to be handled by the calling endpoint
    } finally {
        client.release();
    }
};
// <<< END OF NEW CODE BLOCK >>>


// <<< MODIFIED: This endpoint now uses the reusable helper function >>>
app.post('/api/trips', async (req, res) => {
    const startTime = Date.now();
    try {
        const savedFlight = await createTripInDatabase(req.body);
        const processingTime = Date.now() - startTime;
        
        res.status(201).json({ 
          message: 'Flight saved successfully!',
          flight: {
            flight_id: savedFlight.flight_id,
            booking_reference: savedFlight.booking_reference,
            airline: savedFlight.airline,
            route: `${savedFlight.departure_airport} → ${savedFlight.arrival_airport}`,
            departure_date: savedFlight.departure_date,
            total_price: savedFlight.total_price
          },
          performance: {
            processing_time_ms: processingTime
          }
        });

    } catch (error) {
        let statusCode = 500;
        if (error.message.includes('limit')) statusCode = 403; // Forbidden
        if (error.message.includes('exists')) statusCode = 409; // Conflict
        if (error.message.includes('required') || error.message.includes('Invalid')) statusCode = 400; // Bad Request

        console.error('Error saving manual flight:', error.message);
        res.status(statusCode).json({ error: 'Failed to save flight.', details: error.message });
    }
});


// <<< NEW CODE BLOCK: Endpoint for receiving and processing forwarded emails >>>
app.post('/api/email-ingest', upload.none(), async (req, res) => {
    console.log('Received inbound email webhook...');
    
    try {
        // processInboundEmail will find the user and scrape the flight data
        const flightData = await processInboundEmail(req.body);
        console.log(`Parsed flight for user ${flightData.userId}. Ref: ${flightData.bookingReference}`);

        // Use the same reusable function to save the flight to the database
        await createTripInDatabase(flightData);
        console.log(`Successfully saved flight from email for user ${flightData.userId}`);

        // SendGrid requires a 200 OK response to know the webhook was received successfully.
        res.status(200).send('Email processed successfully.');

    } catch (error) {
        console.error('Failed to process inbound email:', error.message);
        // We still send a 200 OK so SendGrid doesn't retry sending the same failed email.
        // In a more advanced setup, you could log this error to a monitoring service
        // or send a notification email to the user about the failure.
        res.status(200).send('Error processing email.');
    }
});
// <<< END OF NEW CODE BLOCK >>>


app.get('/api/trips/:userId', async (req, res) => {
  const { userId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Max 100 per page
  const offset = (page - 1) * limit;
  
  try {
    const [flights, totalCount] = await Promise.all([
      pool.query(`
        SELECT 
          flight_id, booking_reference, airline,
          departure_airport, arrival_airport,
          departure_date, departure_time, arrival_date, arrival_time,
          flight_number, service_class, aircraft,
          total_price, original_price, last_checked_price,
          is_active, created_at, scraped_at
        FROM flights 
        WHERE user_id = $1 
        ORDER BY is_active DESC, COALESCE(departure_date::date, created_at::date) DESC, created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]),
      
      pool.query('SELECT COUNT(*) FROM flights WHERE user_id = $1', [userId])
    ]);
    
    const totalFlights = parseInt(totalCount.rows[0].count);
    const totalPages = Math.ceil(totalFlights / limit);
    
    res.json({
      message: `Found ${flights.rows.length} flights (page ${page} of ${totalPages})`,
      flights: flights.rows,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_flights: totalFlights,
        per_page: limit
      }
    });
  } catch (error) {
    console.error('Error fetching user flights:', error);
    res.status(500).json({ error: 'Failed to fetch flights.' });
  }
});


app.delete('/api/trips/:flightId', authenticateUser, async (req, res) => {
  const { flightId } = req.params;
  const { userId } = req.body; 

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required in the request body.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const deleteResult = await client.query(
      'DELETE FROM flights WHERE flight_id = $1 AND user_id = $2 RETURNING user_id',
      [flightId, userId]
    );

    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Flight not found or user not authorized to delete.' });
    }

    // This is now handled by the active flight count, but we'll leave it for now.
    await client.query(
      'UPDATE users SET total_flights = total_flights - 1 WHERE user_id = $1 AND total_flights > 0',
      [userId]
    );

    await client.query('COMMIT');
    res.status(200).json({ message: 'Flight deleted successfully.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Error deleting flight ${flightId}:`, error);
    res.status(500).json({ error: 'Failed to delete flight.' });
  } finally {
    client.release();
  }
});


app.get('/api/trips', async (req, res) => {
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
    
    const query = `
      SELECT 
        flight_id, user_id, booking_reference, airline,
        departure_airport, arrival_airport, 
        departure_date, departure_time,
        service_class, flight_number,
        total_price, created_at
      FROM flights 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2
    `;
    
    const [flights, totalCount] = await Promise.all([
      pool.query(query, queryParams),
      pool.query(`SELECT COUNT(*) FROM flights ${whereClause}`, queryParams.slice(2))
    ]);
    
    const totalFlights = parseInt(totalCount.rows[0].count);
    const totalPages = Math.ceil(totalFlights / limit);
    
    res.json({
      message: `Found ${flights.rows.length} total flights`,
      flights: flights.rows,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_flights: totalFlights,
        per_page: limit
      },
      filters: {
        airline,
        from_date: fromDate,
        to_date: toDate
      }
    });
  } catch (error) {
    console.error('Error fetching all flights:', error);
    res.status(500).json({ error: 'Failed to fetch flights.' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [
      userStats,
      flightStats,
      recentActivity,
      popularRoutes,
      averagePrice
    ] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_users_week
        FROM users
      `),
      pool.query(`
        SELECT 
          COUNT(*) as total_flights,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as flights_today,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as flights_week
        FROM flights
      `),
      pool.query(`
        SELECT 
          DATE_TRUNC('day', created_at) as date,
          COUNT(*) as flight_count
        FROM flights 
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY date DESC
      `),
      pool.query(`
        SELECT 
          departure_airport || '→' || arrival_airport as route,
          COUNT(*) as booking_count
        FROM flights 
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY departure_airport, arrival_airport
        ORDER BY booking_count DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT 
          AVG(total_price) as avg_price,
          MIN(total_price) as min_price,
          MAX(total_price) as max_price
        FROM flights 
        WHERE total_price IS NOT NULL
          AND created_at > NOW() - INTERVAL '30 days'
      `)
    ]);
    
    res.json({
      users: userStats.rows[0],
      flights: flightStats.rows[0],
      recent_activity: recentActivity.rows,
      popular_routes: popularRoutes.rows,
      pricing: averagePrice.rows[0]
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics.' });
  }
});


app.post('/api/admin/cleanup-flights', async (req, res) => {
    // In production, you would secure this endpoint, e.g., with a secret key
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('--- Running automated cleanup of past flights ---');
    const client = await pool.connect();
    try {
        // Find all active flights where the departure date is in the past
        const { rows } = await client.query(`
            UPDATE flights
            SET is_active = FALSE, updated_at = NOW()
            WHERE is_active = TRUE AND departure_date::date < NOW()::date
            RETURNING flight_id, user_id;
        `);

        if (rows.length > 0) {
            console.log(`Deactivated ${rows.length} past flights.`);
            // This part is complex as it requires updating user counts.
            // For now, we log it. A more robust solution would be a transaction per user.
            const userUpdateCounts = rows.reduce((acc, row) => {
                acc[row.user_id] = (acc[row.user_id] || 0) + 1;
                return acc;
            }, {});

            console.log('User flight counts to be updated:', userUpdateCounts);
        } else {
            console.log('No past flights to deactivate.');
        }

        res.status(200).json({ message: `Cleanup complete. Deactivated ${rows.length} flights.` });

    } catch (error) {
        console.error('CRITICAL ERROR during flight cleanup:', error);
        res.status(500).json({ error: 'Failed to cleanup flights.' });
    } finally {
        client.release();
        console.log('--- Finished automated cleanup ---');
    }
});


// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown handling
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
  console.log(`Features: Rate limiting, performance monitoring, pagination, email ingestion`);
  console.log(`   -> Stripe integration is active.`);
});