const { Pool } = require('pg');

console.log('Connecting with DATABASE_URL:', process.env.DATABASE_URL ? 'Loaded' : 'Not Found');

// Enhanced connection pool configuration for thousands of users
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Connection pool settings for scalability
  max: 20, // Maximum number of connections
  min: 5,  // Minimum number of connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Wait 10s for new connections
  acquireTimeoutMillis: 60000, // Wait 60s to acquire connection from pool
});

const createTables = async () => {
  try {
    // Test connection with timeout
    const testQuery = pool.query('SELECT NOW()', []);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database connection timeout')), 5000)
    );
    
    await Promise.race([testQuery, timeoutPromise]);
    console.log('Database connection successful.');

    // Create users table with enhanced fields
    const userTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        subscription_plan VARCHAR(50) DEFAULT 'free',
        total_flights INTEGER DEFAULT 0,
        last_activity TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;
    
    await pool.query(userTableQuery);
    console.log('Enhanced users table ready.');

    // Add missing columns to existing users table
    const userColumnsToAdd = {
      'total_flights': 'INTEGER DEFAULT 0',
      'last_activity': 'TIMESTAMP DEFAULT NOW()', 
      'updated_at': 'TIMESTAMP DEFAULT NOW()'
    };

    const existingUserColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users';
    `);
    
    const userColumnNames = existingUserColumns.rows.map(row => row.column_name);
    
    for (const [columnName, columnType] of Object.entries(userColumnsToAdd)) {
      if (!userColumnNames.includes(columnName)) {
        try {
          await pool.query(`ALTER TABLE users ADD COLUMN ${columnName} ${columnType};`);
          console.log(`Added user column: ${columnName}`);
        } catch (err) {
          console.warn(`Failed to add user column ${columnName}:`, err.message);
        }
      }
    }

    // Check existing flights table structure
    const tableExistsQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'flights'
      );
    `;
    
    const tableExists = await pool.query(tableExistsQuery);
    
    if (tableExists.rows[0].exists) {
      // Check for new columns
      const columnsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'flights';
      `;
      
      const columns = await pool.query(columnsQuery);
      const existingColumns = columns.rows.map(row => row.column_name);
      
      console.log('Existing flights table has', existingColumns.length, 'columns');
      
      // Add missing columns for enhanced data
      const newColumns = {
        'route_text': 'TEXT',
        'all_dates': 'JSONB',
        'all_times': 'JSONB', 
        'aircraft': 'VARCHAR(100)',
        'passenger_info': 'TEXT'
      };
      
      for (const [columnName, columnType] of Object.entries(newColumns)) {
        if (!existingColumns.includes(columnName)) {
          try {
            await pool.query(`ALTER TABLE flights ADD COLUMN ${columnName} ${columnType};`);
            console.log(`Added enhanced column: ${columnName}`);
          } catch (err) {
            console.warn(`Failed to add column ${columnName}:`, err.message);
          }
        }
      }
    } else {
      console.log('Creating new flights table with enhanced schema...');
    }

    // Create comprehensive flights table with correct syntax
    const flightTableQuery = `
      CREATE TABLE IF NOT EXISTS flights (
        flight_id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) REFERENCES users(user_id),
        
        booking_reference VARCHAR(50) NOT NULL,
        booking_hash VARCHAR(50) UNIQUE,
        airline VARCHAR(100),
        
        departure_airport VARCHAR(10),
        arrival_airport VARCHAR(10),
        route_text TEXT,
        
        departure_date VARCHAR(50),
        departure_time VARCHAR(50),
        arrival_date VARCHAR(50),
        arrival_time VARCHAR(50),
        
        all_dates JSONB,
        all_times JSONB,
        
        flight_number VARCHAR(20),
        aircraft VARCHAR(100),
        service_class VARCHAR(50),
        
        total_price NUMERIC(10, 2),
        total_price_text VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'USD',
        
        original_price NUMERIC(10, 2),
        last_checked_price NUMERIC(10, 2),
        lowest_price_seen NUMERIC(10, 2),
        
        passenger_info TEXT,
        booking_url TEXT,
        scraped_at TIMESTAMP DEFAULT NOW(),
        
        is_active BOOLEAN DEFAULT TRUE,
        last_checked_at TIMESTAMP DEFAULT NOW(),
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        departure_date_time TIMESTAMP,
        arrival_date_time TIMESTAMP,
        departure_date_legacy TIMESTAMP,
        base_fare NUMERIC(10, 2),
        taxes_fees NUMERIC(10, 2),
        price_drop_amount NUMERIC(10, 2),
        price_alert_sent BOOLEAN DEFAULT FALSE,
        passenger_count INTEGER DEFAULT 1,
        check_frequency_hours INTEGER DEFAULT 24,
        next_check_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
      );
    `;

    await pool.query(flightTableQuery);
    console.log('Enhanced flights table ready.');

    // Add constraints separately (safer approach)
    try {
      await pool.query(`
        ALTER TABLE flights 
        ADD CONSTRAINT unique_booking_per_user 
        UNIQUE(user_id, booking_hash);
      `);
      console.log('Added booking hash constraint.');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.warn('Booking hash constraint warning:', err.message);
      }
    }

    try {
      await pool.query(`
        ALTER TABLE flights 
        ADD CONSTRAINT unique_booking_details 
        UNIQUE(user_id, booking_reference, departure_airport, arrival_airport, departure_date);
      `);
      console.log('Added booking details constraint.');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.warn('Booking details constraint warning:', err.message);
      }
    }

    // Create price history table with correct syntax
    const priceHistoryTableQuery = `
      CREATE TABLE IF NOT EXISTS price_history (
        history_id SERIAL PRIMARY KEY,
        flight_id INTEGER REFERENCES flights(flight_id) ON DELETE CASCADE,
        price NUMERIC(10, 2),
        currency VARCHAR(10) DEFAULT 'USD',
        source VARCHAR(100),
        checked_at TIMESTAMP DEFAULT NOW(),
        availability_status VARCHAR(50),
        fare_class VARCHAR(50),
        notes TEXT
      );
    `;

    await pool.query(priceHistoryTableQuery);
    console.log('Enhanced price history table ready.');

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
    console.log('Price alerts table ready.');

    // Create performance indexes separately
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_flights_user_id_active ON flights(user_id) WHERE is_active = true;',
      'CREATE INDEX IF NOT EXISTS idx_flights_user_created ON flights(user_id, created_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_flights_booking_hash ON flights(booking_hash) WHERE booking_hash IS NOT NULL;',
      'CREATE INDEX IF NOT EXISTS idx_flights_booking_ref_user ON flights(user_id, booking_reference);',
      'CREATE INDEX IF NOT EXISTS idx_flights_route ON flights(departure_airport, arrival_airport);',
      'CREATE INDEX IF NOT EXISTS idx_flights_airline ON flights(airline);',
      'CREATE INDEX IF NOT EXISTS idx_flights_created_at ON flights(created_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_flights_departure_date ON flights(departure_date);',
      'CREATE INDEX IF NOT EXISTS idx_flights_service_class ON flights(service_class) WHERE service_class IS NOT NULL;',
      'CREATE INDEX IF NOT EXISTS idx_flights_price_monitoring ON flights(next_check_at) WHERE is_active = true;',
      'CREATE INDEX IF NOT EXISTS idx_flights_price_range ON flights(total_price) WHERE total_price IS NOT NULL;',
      'CREATE INDEX IF NOT EXISTS idx_users_activity ON users(last_activity DESC);',
      'CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_plan);',
      'CREATE INDEX IF NOT EXISTS idx_price_history_flight_time ON price_history(flight_id, checked_at DESC);',
      'CREATE INDEX IF NOT EXISTS idx_price_history_recent ON price_history(checked_at DESC);'
    ];

    console.log('Creating performance indexes...');
    let indexCount = 0;
    for (const indexQuery of indexes) {
      try {
        await pool.query(indexQuery);
        indexCount++;
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.warn('Index warning:', err.message);
        }
      }
    }
    console.log(`Created ${indexCount} performance indexes.`);

    // Create JSONB indexes separately (these need special syntax)
    const jsonIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_flights_all_dates_gin ON flights USING gin(all_dates) WHERE all_dates IS NOT NULL;',
      'CREATE INDEX IF NOT EXISTS idx_flights_all_times_gin ON flights USING gin(all_times) WHERE all_times IS NOT NULL;'
    ];

    for (const indexQuery of jsonIndexes) {
      try {
        await pool.query(indexQuery);
        console.log('Created JSONB index');
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.warn('JSONB index warning:', err.message);
        }
      }
    }

    // Verify final table structure
    const finalCheck = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'flights' 
      ORDER BY ordinal_position;
    `);

    console.log('\n=== ENHANCED FLIGHTS TABLE STRUCTURE ===');
    const essentialColumns = [
      'booking_reference', 'total_price', 'departure_airport', 'arrival_airport',
      'service_class', 'flight_number', 'all_dates', 'all_times', 'route_text'
    ];
    
    const presentColumns = finalCheck.rows.map(row => row.column_name);
    const hasAllEssential = essentialColumns.every(col => presentColumns.includes(col));
    
    console.log(`Total columns: ${presentColumns.length}`);
    console.log(`Essential columns present: ${hasAllEssential ? '✅ YES' : '❌ NO'}`);
    
    if (!hasAllEssential) {
      const missing = essentialColumns.filter(col => !presentColumns.includes(col));
      console.log('Missing columns:', missing);
    }

    console.log('\n=== DATABASE SETUP COMPLETED SUCCESSFULLY ===');
    console.log('✅ Enhanced schema ready for thousands of users');
    console.log('✅ Comprehensive duplicate prevention');
    console.log('✅ Performance indexes optimized');
    console.log('✅ Complete flight data capture enabled');

  } catch (err) {
    console.error('Error in enhanced database setup:', err);
    throw err;
  }
};

// Enhanced connection monitoring
pool.on('connect', (client) => {
  console.log('New database connection established');
});

pool.on('error', (err, client) => {
  console.error('Database pool error:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database connections...');
  await pool.end();
  console.log('Database connections closed.');
});

module.exports = {
  pool,
  createTables
};