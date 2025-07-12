const { Pool } = require('pg');

console.log('Connecting with DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'Not Found');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const createTables = async () => {
  try {
    // Test the connection
    await pool.query('SELECT NOW()'); 
    console.log('Database connection successful.');

    // First, let's see what we have
    console.log('Checking current table structure...');
    
    try {
      const result = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'flights' 
        ORDER BY ordinal_position;
      `);
      
      console.log('Current flights table columns:');
      result.rows.forEach(row => {
        console.log(`  ${row.column_name}: ${row.data_type}`);
      });
      
    } catch (err) {
      console.log('Flights table does not exist yet');
    }

    // Drop and recreate the flights table with complete schema
    console.log('Recreating flights table with complete schema...');
    
    // First, drop existing table
    await pool.query('DROP TABLE IF EXISTS price_history CASCADE;');
    await pool.query('DROP TABLE IF EXISTS price_alerts CASCADE;');
    await pool.query('DROP TABLE IF EXISTS flights CASCADE;');
    console.log('Dropped existing tables');
    
    // Create users table
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
    console.log('Users table created');

    // Create flights table with ALL columns
    const flightTableQuery = `
      CREATE TABLE flights (
        flight_id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(user_id),
        
        -- Basic booking information
        booking_reference VARCHAR(50) NOT NULL,
        booking_hash VARCHAR(50) UNIQUE,
        airline VARCHAR(100),
        
        -- Route information
        departure_airport VARCHAR(10),
        arrival_airport VARCHAR(10),
        
        -- Detailed timing information
        departure_date_time TIMESTAMP,
        arrival_date_time TIMESTAMP,
        departure_date VARCHAR(50),
        departure_time VARCHAR(50),
        arrival_date VARCHAR(50),
        arrival_time VARCHAR(50),
        
        -- Flight details
        flight_number VARCHAR(20),
        aircraft VARCHAR(100),
        service_class VARCHAR(50),
        
        -- Pricing information
        total_price NUMERIC(10, 2),
        base_fare NUMERIC(10, 2),
        taxes_fees NUMERIC(10, 2),
        total_price_text VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'USD',
        
        -- Price monitoring
        original_price NUMERIC(10, 2),
        last_checked_price NUMERIC(10, 2),
        lowest_price_seen NUMERIC(10, 2),
        price_drop_amount NUMERIC(10, 2),
        price_alert_sent BOOLEAN DEFAULT FALSE,
        
        -- Additional information
        passenger_count INTEGER DEFAULT 1,
        scraped_at TIMESTAMP DEFAULT NOW(),
        booking_url TEXT,
        
        -- Monitoring metadata
        is_active BOOLEAN DEFAULT TRUE,
        last_checked_at TIMESTAMP DEFAULT NOW(),
        check_frequency_hours INTEGER DEFAULT 24,
        next_check_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        -- Legacy compatibility
        departure_date_legacy TIMESTAMP,
        
        -- Constraints
        CONSTRAINT unique_booking_per_user UNIQUE(user_id, booking_hash)
      );
    `;
    
    await pool.query(flightTableQuery);
    console.log('Flights table created with complete schema');

    // Create price history table
    const priceHistoryTableQuery = `
      CREATE TABLE price_history (
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
    console.log('Price history table created');

    // Create alerts table
    const alertsTableQuery = `
      CREATE TABLE price_alerts (
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
    console.log('Price alerts table created');

    // Create indexes
    const indexQueries = [
      `CREATE INDEX idx_flights_user_id ON flights(user_id);`,
      `CREATE INDEX idx_flights_booking_hash ON flights(booking_hash);`,
      `CREATE INDEX idx_flights_next_check ON flights(next_check_at) WHERE is_active = true;`,
      `CREATE INDEX idx_flights_departure_date ON flights(departure_date_time);`,
      `CREATE INDEX idx_price_history_flight_id ON price_history(flight_id);`,
      `CREATE INDEX idx_price_history_checked_at ON price_history(checked_at);`
    ];

    for (const indexQuery of indexQueries) {
      await pool.query(indexQuery);
    }
    console.log('Database indexes created');

    // Create triggers
    const triggerQuery = `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      CREATE TRIGGER update_flights_updated_at 
        BEFORE UPDATE ON flights 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      CREATE TRIGGER update_users_updated_at 
        BEFORE UPDATE ON users 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `;
    
    await pool.query(triggerQuery);
    console.log('Database triggers created');

    // Verify the new structure
    const verifyResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'flights' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\n=== NEW FLIGHTS TABLE STRUCTURE ===');
    verifyResult.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });

    console.log('\n=== DATABASE SETUP COMPLETED SUCCESSFULLY ===');
    console.log('All tables recreated with complete schema');
    console.log('Ready for flight data insertion');

  } catch (err) {
    console.error('Error in database setup:', err);
    throw err;
  }
};

module.exports = {
  pool,
  createTables
};