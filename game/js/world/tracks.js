// Track definitions. Each track is a closed loop through the control points
// (x, z in meters), smoothed with a Catmull-Rom spline. The first point is the
// start/finish line, so keep it in the middle of a straight.
export const TRACKS = [
  {
    id: 'harbor',
    name: 'Harbor Circuit',
    theme: 'meadow',
    points: [
      [0, 0], [160, 0], [320, 0], [430, 40], [480, 140], [440, 250], [340, 290], [240, 250],
      [150, 300], [110, 410], [10, 460], [-130, 440], [-230, 350], [-260, 230], [-330, 140],
      [-310, 30], [-160, 0],
    ],
  },
  {
    id: 'alpine',
    name: 'Alpine Ring',
    theme: 'autumn',
    points: [
      [0, 0], [140, 0], [270, -20], [350, -110], [340, -230], [250, -290], [150, -260],
      [70, -320], [-10, -420], [-150, -440], [-270, -360], [-300, -240], [-240, -160],
      [-250, -70], [-150, 0],
    ],
  },
  {
    id: 'canyon',
    name: 'Canyon Speedway',
    theme: 'desert',
    points: [
      [0, 0], [250, 0], [500, 0], [700, 60], [800, 220], [760, 420], [600, 520], [400, 500],
      [250, 560], [60, 600], [-150, 560], [-300, 420], [-330, 220], [-250, 60], [-130, 5],
    ],
  },
];
