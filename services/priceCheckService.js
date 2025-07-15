const { pool } = require('../database');
const { getFlightPrice } = require('./amadeusService');
const notificationService = require('./notificationService');

/**
 * Processes a single flight, checks its price, and triggers alerts if necessary.
 * @param {object} flight - A flight object from the database.
 */
const checkFlightPrice = async (flight) => {
    console.log(`Checking price for flight ID: ${flight.flight_id} (${flight.departure_airport} to ${flight.arrival_airport})`);

    // A flight is considered round-trip if the 'all_dates' JSON array contains more than one date.
    const isRoundTrip = Array.isArray(flight.all_dates) && flight.all_dates.length > 1;

    const priceData = await getFlightPrice({
        departureAirport: flight.departure_airport,
        arrivalAirport: flight.arrival_airport,
        departureDate: flight.departure_date,
        returnDate: isRoundTrip ? flight.all_dates[1] : null, // Use the second date as the return date
        airline: flight.airline_iata_code, // This column should be populated by the scraper/form
        departureTime: flight.departure_time,
    });

    if (!priceData) {
        console.log(`No current price found for flight ID: ${flight.flight_id}. Skipping.`);
        await pool.query('UPDATE flights SET last_checked_at = NOW() WHERE flight_id = $1', [flight.flight_id]);
        return;
    }

    const { currentPrice } = priceData;
    const { original_price, last_alerted_price, user_id, flight_id } = flight;

    let shouldAlert = false;
    let priceThreshold = 0;

    // Ensure original_price is a valid number before doing calculations
    if (original_price === null || isNaN(original_price)) {
        console.warn(`Flight ID ${flight_id} has an invalid original price. Skipping alert check.`);
        await pool.query('UPDATE flights SET last_checked_price = $1, last_checked_at = NOW() WHERE flight_id = $2', [currentPrice, flight_id]);
        return;
    }

    if (last_alerted_price === null) {
        priceThreshold = original_price * 0.90; // 10% drop from original
        if (currentPrice < priceThreshold) {
            shouldAlert = true;
            console.log(`ALERT TRIGGER (Initial): Flight ${flight_id} dropped from $${original_price} to $${currentPrice}.`);
        }
    } else {
        priceThreshold = last_alerted_price * 0.90; // 10% drop from last alert
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
            savingsThisDrop,
            flightDetails: flight, // Pass full flight object for email content
        });
    } else {
        await pool.query(
            'UPDATE flights SET last_checked_price = $1, last_checked_at = NOW() WHERE flight_id = $2',
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
    const { flight_id, user_id, currentPrice, savingsThisDrop, flightDetails } = alertData;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const flightUpdateQuery = `
            UPDATE flights 
            SET last_checked_price = $1, last_alerted_price = $1, last_checked_at = NOW() 
            WHERE flight_id = $2
        `;
        await client.query(flightUpdateQuery, [currentPrice, flight_id]);

        const userUpdateQuery = `
            UPDATE users 
            SET lifetime_savings = lifetime_savings + $1 
            WHERE user_id = $2
        `;
        await client.query(userUpdateQuery, [savingsThisDrop, user_id]);

        await client.query('COMMIT');
        console.log(`SUCCESS: Database updated for flight ${flight_id} and user ${user_id}. Savings of $${savingsThisDrop.toFixed(2)} added.`);

        const userEmailResult = await pool.query('SELECT email FROM users WHERE user_id = $1', [user_id]);
        if (userEmailResult.rows.length > 0) {
            const userEmail = userEmailResult.rows[0].email;
            await notificationService.sendPriceDropEmail({
                userEmail,
                flightDetails: {
                    departureAirport: flightDetails.departure_airport,
                    arrivalAirport: flightDetails.arrival_airport,
                    airline: flightDetails.airline,
                    departureDate: flightDetails.departure_date,
                },
                newPrice: currentPrice,
                savingsThisDrop,
            });
        }

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
        const dueFlightsResult = await client.query(`
            SELECT f.*, u.subscription_plan 
            FROM flights f
            JOIN users u ON f.user_id = u.user_id
            WHERE f.is_active = TRUE 
            AND f.departure_date::date > NOW()
            AND f.next_check_at <= NOW()
        `);

        const dueFlights = dueFlightsResult.rows;
        console.log(`Found ${dueFlights.length} flights due for a price check.`);

        if (dueFlights.length === 0) {
            return;
        }

        for (const flight of dueFlights) {
            try {
                await checkFlightPrice(flight);
                
                // Use the check_frequency_hours stored with the flight
                await client.query(
                    `UPDATE flights SET next_check_at = NOW() + INTERVAL '${flight.check_frequency_hours || 24} hours' WHERE flight_id = $1`,
                    [flight.flight_id]
                );
            } catch (error) {
                console.error(`Failed to process flight ID ${flight.flight_id}. Error:`, error.message);
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
};
