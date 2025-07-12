const { Pool } = require('pg');

// Log the database URL to ensure it's being loaded from the environment
console.log('Connecting with DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'Not Found');

// Initialize the connection pool
const pool = new Pool({
  // The connectionString is automatically read from the DATABASE_URL environment variable
  connectionString: process.env.DATABASE_URL,
  // Add this SSL configuration for connecting to Render's managed databases
  ssl: {
    rejectUnauthorized: false
  }
});

const createTables = async () => {
  try {
    // Test the connection
    await pool.query('SELECT NOW()'); 
    console.log('Database connection successful.');

    // Create users table first
    const userTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        subscription_plan VARCHAR(50) DEFAULT 'free',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;
    
    await pool.query(userTableQuery);
    console.log('Users table ready.');

    // Check if flights table exists and what columns it has
    console.log('Checking flights table...');
    
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'flights'
      );
    `;
    
    const tableExists = await pool.query(tableExistsQuery);
    
    if (tableExists.rows[0].exists) {
      console.log('Flights table exists, checking columns...');
      
      const columnsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'flights';
      `;
      
      const columns = await pool.query(columnsQuery);
      const existingColumns = columns.rows.map(row => row.column_name);
      
      console.log('Existing columns:', existingColumns.length);
      
      // Check if we have the essential columns
      const requiredColumns = ['booking_reference', 'total_price', 'arrival_date', 'departure_date'];
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
      
      if (missingColumns.length > 0) {
        console.log('Missing columns detected. Recreating table...');
        
        // Drop existing tables in correct order
        await pool.query('DROP TABLE IF EXISTS price_history CASCADE;');
        await pool.query('DROP TABLE IF EXISTS price_alerts CASCADE;');
        await pool.query('DROP TABLE IF EXISTS flights CASCADE;');
        console.log('Dropped existing incomplete table.');
      } else {
        console.log('Table has all required columns.');
      }
    }

    // Create or recreate flights table with complete schema
    const flightTableQuery = `
      CREATE TABLE IF NOT EXISTS flights (
        flight_id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(user_id),
        
        booking_reference VARCHAR(50) NOT NULL,
        booking_hash VARCHAR(50) UNIQUE,
        airline VARCHAR(100),
        
        departure_airport VARCHAR(10),
        arrival_airport VARCHAR(10),
        
        departure_date_time TIMESTAMP,
        arrival_date_time TIMESTAMP,
        departure_date VARCHAR(50),
        departure_time VARCHAR(50),
        arrival_date VARCHAR(50),
        arrival_time VARCHAR(50),
        
        flight_number VARCHAR(20),
        aircraft VARCHAR(100),
        service_class VARCHAR(50),
        
        total_price NUMERIC(10, 2),
        base_fare NUMERIC(10, 2),
        taxes_fees NUMERIC(10, 2),
        total_price_text VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'USD',
        
        original_price NUMERIC(10, 2),
        last_checked_price NUMERIC(10, 2),
        lowest_price_seen NUMERIC(10, 2),
        price_drop_amount NUMERIC(10, 2),
        price_alert_sent BOOLEAN DEFAULT FALSE,
        
        passenger_count INTEGER DEFAULT 1,
        scraped_at TIMESTAMP DEFAULT NOW(),
        booking_url TEXT,
        
        is_active BOOLEAN DEFAULT TRUE,
        last_checked_at TIMESTAMP DEFAULT NOW(),
        check_frequency_hours INTEGER DEFAULT 24,
        next_check_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        departure_date_legacy TIMESTAMP
      );
    `;

    await pool.query(flightTableQuery);
    console.log('Flights table created with complete schema.');

    // Create price history table
    const priceHistoryTableQuery = `
      CREATE TABLE IF NOT EXISTS price_history (
        history_id SERIAL PRIMARY KEY,
        flight_id INTEGER REFERENCES flights(flight_id) ON DELETE CASCADE,
        price NUMERIC(10, 2),
        currency VARCHAR(10) DEFAULT 'USD',
        source VARCHAR(100),
        checked_at TIMESTAMP DEFAULT NOW(),
        available_seats INTEGER,
        fare_class VARCHAR(50),
        notes TEXT
      );
    `;

    await pool.query(priceHistoryTableQuery);
    console.log('Price history table created.');

    // Create alerts table
    const alertsTableQuery = `
      CREATE TABLE IF NOT EXISTS price_alerts (
        alert_id SERIAL PRIMARY KEY,
        flight_id INTEGER REFERENCES flights(flight_id) ON DELETE CASCADE,
        user_id VARCHAR(255) REFERENCES users(user_id),
        alert_type VARCHAR(50),
        threshold_price NUMERIC(10, 2),
        is_active BOOLEAN DEFAULT TRUE,
        last_triggered TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;

    await pool.query(alertsTableQuery);
    console.log('Price alerts table created.');

    // Add unique constraint if it doesn't exist
    try {
      await pool.query(`
        ALTER TABLE flights 
        ADD CONSTRAINT unique_booking_per_user 
        UNIQUE(user_id, booking_hash);
      `);
      console.log('Added unique constraint.');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('Unique constraint already exists.');
      } else {
        console.warn('Constraint warning:', err.message);
      }
    }

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_flights_user_id ON flights(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_flights_booking_hash ON flights(booking_hash);',
      'CREATE INDEX IF NOT EXISTS idx_flights_next_check ON flights(next_check_at) WHERE is_active = true;',
      'CREATE INDEX IF NOT EXISTS idx_flights_departure_date ON flights(departure_date_time);',
      'CREATE INDEX IF NOT EXISTS idx_price_history_flight_id ON price_history(flight_id);',
      'CREATE INDEX IF NOT EXISTS idx_price_history_checked_at ON price_history(checked_at);'
    ];

    for (const indexQuery of indexes) {
      try {
        await pool.query(indexQuery);
      } catch (err) {
        console.warn('Index warning:', err.message);
      }
    }
    console.log('Database indexes created.');

    // Verify final table structure
    const finalCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'flights' 
      ORDER BY ordinal_position;
    `);

    console.log('\n=== FINAL FLIGHTS TABLE STRUCTURE ===');
    const columnNames = finalCheck.rows.map(row => row.column_name);
    console.log('Total columns:', columnNames.length);
    
    // Check for essential columns
    const essentialColumns = ['booking_reference', 'total_price', 'departure_airport', 'arrival_airport'];
    const hasAllEssential = essentialColumns.every(col => columnNames.includes(col));
    
    if (hasAllEssential) {
      console.log('✅ All essential columns present!');
    } else {
      console.log('❌ Missing essential columns!');
    }

    console.log('\n=== DATABASE SETUP COMPLETED SUCCESSFULLY ===');
    console.log('Ready to accept flight data!');

  } catch (err) {
    console.error('Error connecting to database or creating tables:', err);
    throw err;
  }
};

module.exports = {
  pool,
  createTables
};