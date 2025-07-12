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
      
      -- Price monitoring (legacy columns for compatibility)
      original_price NUMERIC(10, 2),
      last_checked_price NUMERIC(10, 2),
      departure_date_legacy TIMESTAMP, -- Old column name
      
      -- New price monitoring fields
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
      source VARCHAR(100),
      checked_at TIMESTAMP DEFAULT NOW(),
      
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
      alert_type VARCHAR(50),
      threshold_price NUMERIC(10, 2),
      is_active BOOLEAN DEFAULT TRUE,
      last_triggered TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;

  try {
    // Test the connection
    await pool.query('SELECT NOW()'); 
    console.log('Database connection successful.');

    // Create/update users table
    await pool.query(userTableQuery);
    console.log('Users table ready.');

    // For flights table, we need to check if it exists and migrate if needed
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'flights'
      );
    `;
    
    const tableExists = await pool.query(tableExistsQuery);
    
    if (!tableExists.rows[0].exists) {
      // Table doesn't exist, create it with full schema
      console.log('Creating new flights table...');
      await pool.query(flightTableQuery);
      console.log('Flights table created.');
    } else {
      // Table exists, need to add missing columns
      console.log('Flights table exists, checking for missing columns...');
      
      // Get current columns
      const columnsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'flights'
      `;
      const columns = await pool.query(columnsQuery);
      const existingColumns = columns.rows.map(row => row.column_name);
      
      console.log('Existing columns:', existingColumns);
      
      // Define required columns and their types
      const requiredColumns = {
        'booking_reference': 'VARCHAR(50)',
        'booking_hash': 'VARCHAR(50)',
        'departure_date_time': 'TIMESTAMP',
        'arrival_date_time': 'TIMESTAMP',
        'departure_time': 'VARCHAR(50)',
        'arrival_time': 'VARCHAR(50)',
        'flight_number': 'VARCHAR(20)',
        'aircraft': 'VARCHAR(100)',
        'service_class': 'VARCHAR(50)',
        'base_fare': 'NUMERIC(10, 2)',
        'taxes_fees': 'NUMERIC(10, 2)',
        'total_price_text': 'VARCHAR(100)',
        'currency': 'VARCHAR(10) DEFAULT \'USD\'',
        'lowest_price_seen': 'NUMERIC(10, 2)',
        'price_drop_amount': 'NUMERIC(10, 2)',
        'price_alert_sent': 'BOOLEAN DEFAULT FALSE',
        'passenger_count': 'INTEGER DEFAULT 1',
        'scraped_at': 'TIMESTAMP DEFAULT NOW()',
        'booking_url': 'TEXT',
        'is_active': 'BOOLEAN DEFAULT TRUE',
        'check_frequency_hours': 'INTEGER DEFAULT 24',
        'next_check_at': 'TIMESTAMP DEFAULT NOW() + INTERVAL \'24 hours\'',
        'created_at': 'TIMESTAMP DEFAULT NOW()',
        'updated_at': 'TIMESTAMP DEFAULT NOW()'
      };
      
      // Add missing columns
      for (const [columnName, columnType] of Object.entries(requiredColumns)) {
        if (!existingColumns.includes(columnName)) {
          try {
            const alterQuery = `ALTER TABLE flights ADD COLUMN ${columnName} ${columnType};`;
            await pool.query(alterQuery);
            console.log(`Added column: ${columnName}`);
          } catch (err) {
            console.warn(`Failed to add column ${columnName}:`, err.message);
          }
        }
      }
      
      // Add unique constraint if it doesn't exist
      try {
        await pool.query(`
          ALTER TABLE flights 
          ADD CONSTRAINT unique_booking_per_user_new 
          UNIQUE(user_id, booking_hash);
        `);
        console.log('Added unique constraint.');
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.warn('Constraint warning:', err.message);
        }
      }
    }

    // Create other tables
    await pool.query(priceHistoryTableQuery);
    await pool.query(alertsTableQuery);
    console.log('All tables ready.');

    // Create indexes
    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_flights_user_id ON flights(user_id);`,
      `CREATE INDEX IF NOT EXISTS idx_flights_booking_hash ON flights(booking_hash);`,
      `CREATE INDEX IF NOT EXISTS idx_flights_next_check ON flights(next_check_at) WHERE is_active = true;`,
      `CREATE INDEX IF NOT EXISTS idx_flights_departure_date ON flights(departure_date_time);`,
      `CREATE INDEX IF NOT EXISTS idx_price_history_flight_id ON price_history(flight_id);`,
      `CREATE INDEX IF NOT EXISTS idx_price_history_checked_at ON price_history(checked_at);`
    ];

    for (const indexQuery of indexQueries) {
      try {
        await pool.query(indexQuery);
      } catch (err) {
        console.warn('Index creation warning:', err.message);
      }
    }
    console.log('Database indexes ready.');

    // Add triggers for updated_at timestamps
    try {
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
      console.log('Database triggers ready.');
    } catch (err) {
      console.warn('Trigger creation warning:', err.message);
    }

    console.log('=== DATABASE MIGRATION COMPLETED SUCCESSFULLY ===');

  } catch (err) {
    console.error('Error in database setup:', err);
    throw err;
  }
};

module.exports = {
  pool,
  createTables
};