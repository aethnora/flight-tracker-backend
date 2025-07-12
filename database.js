const { Pool } = require('pg');

console.log('Connecting with DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'Not Found');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const createTables = async () => {
  const userTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      user_id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      subscription_plan VARCHAR(50) DEFAULT 'free',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;

  const flightTableQuery = `
    CREATE TABLE IF NOT EXISTS flights (
      flight_id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) REFERENCES users(user_id),
      
      -- Basic booking information
      booking_reference VARCHAR(50) NOT NULL,
      booking_hash VARCHAR(50) UNIQUE, -- For duplicate prevention
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
      service_class VARCHAR(50), -- First, Business, Premium Economy, Economy, Basic Economy
      
      -- Pricing information
      total_price NUMERIC(10, 2),
      base_fare NUMERIC(10, 2),
      taxes_fees NUMERIC(10, 2),
      total_price_text VARCHAR(100), -- Original price text for reference
      currency VARCHAR(10) DEFAULT 'USD',
      
      -- Price monitoring
      original_price NUMERIC(10, 2), -- Will be same as total_price initially
      last_checked_price NUMERIC(10, 2),
      price_drop_amount NUMERIC(10, 2), -- Calculated field
      lowest_price_seen NUMERIC(10, 2),
      price_alert_sent BOOLEAN DEFAULT FALSE,
      
      -- Additional information
      passenger_count INTEGER DEFAULT 1,
      scraped_at TIMESTAMP DEFAULT NOW(),
      booking_url TEXT,
      
      -- Monitoring metadata
      is_active BOOLEAN DEFAULT TRUE, -- Can be disabled if flight is past or cancelled
      last_checked_at TIMESTAMP DEFAULT NOW(),
      check_frequency_hours INTEGER DEFAULT 24, -- How often to check prices
      next_check_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
      
      -- Timestamps
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      
      -- Add constraint to prevent duplicate bookings
      CONSTRAINT unique_booking_per_user UNIQUE(user_id, booking_hash)
    );
  `;

  const priceHistoryTableQuery = `
    CREATE TABLE IF NOT EXISTS price_history (
      history_id SERIAL PRIMARY KEY,
      flight_id INTEGER REFERENCES flights(flight_id) ON DELETE CASCADE,
      price NUMERIC(10, 2),
      currency VARCHAR(10) DEFAULT 'USD',
      source VARCHAR(100), -- Where the price was found (airline website, etc.)
      checked_at TIMESTAMP DEFAULT NOW(),
      
      -- Additional context
      available_seats INTEGER,
      fare_class VARCHAR(50),
      notes TEXT
    );
  `;

  const alertsTableQuery = `
    CREATE TABLE IF NOT EXISTS price_alerts (
      alert_id SERIAL PRIMARY KEY,
      flight_id INTEGER REFERENCES flights(flight_id) ON DELETE CASCADE,
      user_id VARCHAR(255) REFERENCES users(user_id),
      alert_type VARCHAR(50), -- 'price_drop', 'availability', 'schedule_change'
      threshold_price NUMERIC(10, 2), -- Alert if price drops below this
      is_active BOOLEAN DEFAULT TRUE,
      last_triggered TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;

  // Create indexes for better query performance
  const indexQueries = [
    `CREATE INDEX IF NOT EXISTS idx_flights_user_id ON flights(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_flights_booking_hash ON flights(booking_hash);`,
    `CREATE INDEX IF NOT EXISTS idx_flights_next_check ON flights(next_check_at) WHERE is_active = true;`,
    `CREATE INDEX IF NOT EXISTS idx_flights_departure_date ON flights(departure_date_time);`,
    `CREATE INDEX IF NOT EXISTS idx_price_history_flight_id ON price_history(flight_id);`,
    `CREATE INDEX IF NOT EXISTS idx_price_history_checked_at ON price_history(checked_at);`
  ];

  try {
    // Test the connection
    await pool.query('SELECT NOW()'); 
    console.log('Database connection successful.');

    // Create tables
    await pool.query(userTableQuery);
    await pool.query(flightTableQuery);
    await pool.query(priceHistoryTableQuery);
    await pool.query(alertsTableQuery);
    console.log('All tables created or already exist.');

    // Create indexes
    for (const indexQuery of indexQueries) {
      await pool.query(indexQuery);
    }
    console.log('Database indexes created.');

    // Add triggers for updated_at timestamps
    const triggerQuery = `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      DROP TRIGGER IF EXISTS update_flights_updated_at ON flights;
      CREATE TRIGGER update_flights_updated_at 
        BEFORE UPDATE ON flights 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at 
        BEFORE UPDATE ON users 
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `;
    
    await pool.query(triggerQuery);
    console.log('Database triggers created.');

  } catch (err) {
    console.error('Error connecting to database or creating tables:', err);
  }
};

module.exports = {
  pool,
  createTables
};