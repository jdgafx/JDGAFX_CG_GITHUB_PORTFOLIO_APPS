import { pageMarkerPattern } from './chunk'

export const SAMPLE_TITLE = 'Sample: rooftop solar care guide'

/** The question loaded with the sample, so Ask is one click away. */
export const SAMPLE_QUESTION = 'How often should the panels be cleaned?'

/** A short built-in guide. Its page markers match the ones the PDF reader writes. */
export const SAMPLE_TEXT = `--- Page 1 ---
Rooftop solar care guide

This guide covers routine care for a small rooftop array of about ten panels, with one string inverter and a monitoring app. It is written for an owner who is comfortable with a ladder and a garden hose. Work on the wiring, the inverter cabinet or the roof structure belongs to a licensed installer. Before you touch any cable, switch off the isolator next to the inverter, and never open a junction box while it is wet.

--- Page 2 ---
Cleaning the panels

Clean the panels every six months, or more often in dusty areas and after a long dry spell. How often the panels are cleaned depends on the site, so check the output after each clean to learn what your roof needs. Use plain water and a soft brush or sponge. Avoid abrasive pads, pressure washers and household detergents, because they scratch the glass and can leave a film that cuts output.

--- Page 3 ---
When to clean

Clean in the cool part of the morning or the evening, when the glass is not hot. Water on hot glass dries too fast and leaves streaks. Remove bird droppings and fallen leaves as soon as you see them, because a shaded cell can lower the output of the whole string. A panel that looks clean from the ground can still carry a thin film of pollen, so compare the monitoring figures for the week before and the week after each clean.

--- Page 4 ---
Yearly inspection

Once a year, look at the array from the ground with binoculars. Note cracked or discolored glass, loose clamps and any nests under the frame. Check the cable runs for chafing where they cross the edge of the roof. Write down what you see with the date, so a change from one year to the next is easy to spot. Keep the photographs with the service log.

--- Page 5 ---
The inverter and the app

Check the inverter display at the same time. A fault code, a flashing warning light or a daily yield well below the usual figure is a reason to call an installer. Do not reset the inverter again and again to clear a fault. The fault may return, and repeated resets hide the cause. The monitoring app keeps the history, so note the date of the first fault you see.

--- Page 6 ---
Storms, snow and records

In winter, let snow melt off the panels on its own, and never climb onto the roof to clear it. After a storm, check that the mounting rails are still fixed to the roof and that no panel has shifted. Keep the installation certificate, the warranty card and the service log together in one folder, so an installer can find them quickly.`

/** Page count, counted from the same markers the chunker reads. */
export const SAMPLE_PAGES = [...SAMPLE_TEXT.matchAll(pageMarkerPattern())].length
