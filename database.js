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
  const userTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      user_id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      subscription_plan VARCHAR(50) DEFAULT 'free'
    );
  `;

  const flightTableQuery = `
    CREATE TABLE IF NOT EXISTS flights (
      flight_id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) REFERENCES users(user_id),
      airline VARCHAR(100),
      departure_airport VARCHAR(10),
      arrival_airport VARCHAR(10),
      departure_date TIMESTAMP,
      original_price NUMERIC(10, 2),
      last_checked_price NUMERIC(10, 2),
      last_checked_at TIMESTAMP
    );
  `;

  try {
    // Test the connection
    await pool.query('SELECT NOW()'); 
    console.log('Database connection successful.');

    await pool.query(userTableQuery);
    await pool.query(flightTableQuery);
    console.log('Tables created or already exist.');
  } catch (err) {
    console.error('Error connecting to database or creating tables:', err);
  }
};

module.exports = {
  pool,
  createTables
};