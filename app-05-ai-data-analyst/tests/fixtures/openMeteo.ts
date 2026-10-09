/**
 * A recorded excerpt of an Open-Meteo archive CSV response (real rows), used only by tests.
 * It keeps the metadata block that precedes the real header. The app itself fetches live.
 */
export const OPEN_METEO_EXCERPT = `latitude,longitude,elevation,utc_offset_seconds,timezone,timezone_abbreviation
40.738136,-74.04254,27.0,-14400,America/New_York,GMT-4

time,temperature_2m_max (°C),temperature_2m_min (°C),precipitation_sum (mm)
2025-10-08,21.8,14.5,5.40
2025-10-09,15.1,8.5,0.00
2025-10-10,16.2,4.9,0.00
2025-10-11,19.0,9.7,1.40
2025-10-12,16.5,13.1,13.90
2025-10-13,14.9,12.3,33.20
2025-10-14,16.2,12.2,0.10
2025-11-01,14.5,7.6,0.00
2025-11-02,15.0,4.0,0.00
2025-11-03,14.0,6.3,0.10
2025-11-04,14.9,8.1,0.00
`
