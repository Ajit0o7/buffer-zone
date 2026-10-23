// Heart Hunt: the places a heart can be hidden, in world metres (x, the floor's height there, z). The server picks
// ten of them for each game (server/src/games.js), so a new game hides them somewhere new. Every spot is on open,
// reachable floor: the courtyard, the lounge's corners, both aisles, the salon by the hearth, halfway up the grand
// stair, the landing, the bridge, and both upper galleries.

const spot = (x, floor, z) => ({ x, y: floor + 1.1, z, floor }); // the heart floats at chest height

export const HUNT_SPOTS = [
  spot(-11.0, 0, -1.0), // courtyard, by the piano's tail
  spot(-8.0, 0, -1.5), // courtyard, behind the fountain
  spot(-2.0, 0, -2.4), // courtyard, south of the stair's foot
  spot(-1.2, 0, 1.75), // courtyard, beside the north newel
  spot(12.5, 0, -2.0), // courtyard's east end, under the bridge
  spot(-16.4, 0, 2.4), // the lounge's north corner
  spot(-16.4, 0, -3.2), // the lounge's south corner
  spot(-12.5, 0, 5.2), // study, west
  spot(-5.0, 0, 5.2), // study
  spot(3.5, 0, 5.2), // salon, in front of the hearth
  spot(9.5, 0, 5.2), // salon, east
  spot(-12.5, 0, -5.8), // memory corridor, west
  spot(-5.0, 0, -5.8), // memory corridor
  spot(2.5, 0, -5.8), // memory corridor
  spot(9.5, 0, -5.8), // memory corridor, east
  spot(4.98, 3.21, 0.6), // halfway up the grand stair
  spot(10.6, 6.25, -1.6), // on the landing
  spot(14.2, 4.99, 2.0), // on the east bridge
  spot(-9.0, 4.99, 4.8), // north gallery, west
  spot(-1.0, 4.99, 4.8), // north gallery
  spot(6.5, 4.99, 4.8), // north gallery, east
  spot(-9.0, 4.99, -5.6), // south gallery, west
  spot(-1.0, 4.99, -5.6), // south gallery
  spot(6.5, 4.99, -5.6), // south gallery, east
]; // keep the count equal to HUNT.spots in server/src/games.js

export const COLLECT_RADIUS = 1.1; // metres, along the floor, from the player to the heart
