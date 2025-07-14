const { pool } = require('../database');
const { getFlightPrice } = require('./amadeusService');
// const notificationService = require('./notificationService'); // Will be used in the future

/**
 * Processes a single flight, checks its price, and triggers alerts if necessary.
 * @param {object} flight - A flight object from the database.
 */
const checkFlightPrice = async (flight) => {
    console.log(`Checking price for flight ID: ${flight.flight_id} (${flight.departure_airport} to ${flight.arrival_airport})`);

    const priceData = await getFlightPrice({
        departureAirport: flight.departure_airport,
        arrivalAirport: flight.arrival_airport,
        departureDate: flight.departure_date, // Assuming YYYY-MM-DD format
        airline: flight.airline_iata_code, // Assumes you have the IATA code, e.g., 'AA'
    });

    if (!priceData) {
        console.log(`No current price found for flight ID: ${flight.flight_id}. Skipping.`);
        // Update the last_checked_at time even if no price is found
        await pool.query('UPDATE flights SET last_checked_at = NOW() WHERE flight_id = $1', [flight.flight_id]);
        return;
    }

    const { currentPrice } = priceData;
    const { original_price, last_alerted_price, user_id, flight_id } = flight;

    let shouldAlert = false;
    let priceThreshold = 0;

    // Logic for the first alert
    if (last_alerted_price === null) {
        priceThreshold = original_price * 0.90; // 10% drop from original price
        if (currentPrice < priceThreshold) {
            shouldAlert = true;
            console.log(`ALERT TRIGGER (Initial): Flight ${flight_id} dropped from $${original_price} to $${currentPrice}.`);
        }
    } else { // Logic for subsequent alerts
        priceThreshold = last_alerted_price * 0.90; // 10% drop from the last alerted price
        if (currentPrice < priceThreshold) {
            shouldAlert = true;
            console.log(`ALERT TRIGGER (Subsequent): Flight ${flight_id} dropped from $${last_alerted_price} to $${currentPrice}.`);
        }
    }

    if (shouldAlert) {
        const previousPrice = last_alerted_price || original_price;
        const savingsThisDrop = previousPrice - currentPrice;
        
        await triggerPriceDropAlert({
            flight_id,
            user_id,
            currentPrice,
            previousPrice,
            savingsThisDrop,
        });
    } else {
        // If no alert, just update the current price and last checked time
        await pool.query(
            'UPDATE flights SET current_price = $1, last_checked_at = NOW() WHERE flight_id = $2',
            [currentPrice, flight_id]
        );
        console.log(`No significant price drop for flight ${flight_id}. Current price: $${currentPrice}`);
    }
};

/**
 * Handles the database updates and notification triggers for a price drop.
 * @param {object} alertData - Data required to process the alert.
 */
const triggerPriceDropAlert = async (alertData) => {
    const { flight_id, user_id, currentPrice, previousPrice, savingsThisDrop } = alertData;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Update the flight with the new current price and last alerted price
        const flightUpdateQuery = `
            UPDATE flights 
            SET current_price = $1, last_alerted_price = $1, last_checked_at = NOW() 
            WHERE flight_id = $2
        `;
        await client.query(flightUpdateQuery, [currentPrice, flight_id]);

        // 2. Update the user's lifetime savings
        const userUpdateQuery = `
            UPDATE users 
            SET lifetime_savings = lifetime_savings + $1 
            WHERE user_id = $2
        `;
        await client.query(userUpdateQuery, [savingsThisDrop, user_id]);

        await client.query('COMMIT');
        console.log(`SUCCESS: Database updated for flight ${flight_id} and user ${user_id}. Savings of $${savingsThisDrop.toFixed(2)} added.`);

        // 3. Send notification (in the future)
        // await notificationService.sendPriceDropEmail({ userId, flightId, currentPrice, savingsThisDrop });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`DATABASE ERROR during alert trigger for flight ${flight_id}:`, error);
    } finally {
        client.release();
    }
};

/**
 * The main function to be called by a cron job.
 * It fetches all active, due flights and processes them.
 */
const processAllDueFlights = async () => {
    console.log('--- Starting scheduled flight price check process ---');
    const client = await pool.connect();

    try {
        // Get all active flights that are due for a check
        const dueFlightsResult = await client.query(`
            SELECT * FROM flights 
            WHERE is_active = TRUE 
            AND departure_date::date > NOW() 
            AND next_check_at <= NOW()
        `);

        const dueFlights = dueFlightsResult.rows;
        console.log(`Found ${dueFlights.length} flights due for a price check.`);

        if (dueFlights.length === 0) {
            return;
        }

        // Process all due flights
        // Using a for...of loop to process them sequentially to avoid overwhelming APIs.
        // For higher throughput, Promise.all with a batching mechanism could be used.
        for (const flight of dueFlights) {
            try {
                await checkFlightPrice(flight);
                
                // Update the next_check_at timestamp for this flight
                await client.query(
                    `UPDATE flights SET next_check_at = NOW() + INTERVAL '${flight.check_frequency_hours || 24} hours' WHERE flight_id = $1`,
                    [flight.flight_id]
                );
            } catch (error) {
                console.error(`Failed to process flight ID ${flight.flight_id}. Error:`, error.message);
                // Continue to the next flight even if one fails
            }
        }

    } catch (error) {
        console.error('CRITICAL ERROR in flight processing job:', error);
    } finally {
        client.release();
        console.log('--- Finished scheduled flight price check process ---');
    }
};

module.exports = {
    processAllDueFlights,
    checkFlightPrice, // Exporting for potential single-use checks
};
