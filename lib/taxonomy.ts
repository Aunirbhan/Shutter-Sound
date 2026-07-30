// Tag tables. Pure data, so both the client and the eval runner can import it.
// Each tag = prompts to score against, a valence/energy point, and ranked genres.

export type BankId =
  | 'setting' | 'time' | 'weather' | 'action' | 'mood'
  | 'medium' | 'subject' | 'motion' | 'region';

export interface Tag {
  id: string;
  /** Plain phrases. vision.ts wraps these in SigLIP's template — never score a raw id. */
  prompts: string[];
  /** Valence, -1 (sad) .. 1 (happy). */
  v: number;
  /** Energy, 0 (still) .. 1 (intense). */
  e: number;
  /** Ranked most -> least typical. recommend.ts decays each by 1/(1+index). */
  g: string[];
  /** Overrides the bank floor. Demotes tags SigLIP reads badly. */
  threshold?: number;
  /** Someone's in the photo. Unlocks the action bank. */
  people?: boolean;
  /** Gate only — no genres, no v/e. */
  gateOnly?: boolean;
  /** Spotify `year:` range this implies. */
  era?: [number, number];
}

export interface Bank {
  id: BankId;
  tags: Tag[];
  /** Floor on vision.ts's standardised score, not a raw cosine.
   *  Roughly 0.30 ~ 1 sd over the image's baseline, 0.50 ~ 1.6 sd, 0.64 ~ 2 sd. */
  threshold: number;
  topK: number;
  /** Scales this bank's pull on genre scoring. */
  weight: number;
  vWeight: number;
  eWeight: number;
  /** Silent unless the subject bank saw a person. */
  requiresPeople?: boolean;
  /** Silent unless top-1 beats top-2 by this much. */
  minMargin?: number;
}

// --- setting -----------------------------------------------------------------
// Strongest axis, so it gets the most weight. lake_river / field_meadow / garden_park
// are new — there was no freshwater tag, which is why every lake sounded like ocean.

const SETTING: Tag[] = [
  { id: 'city_day', v: 0.4, e: 0.6,
    prompts: ['a city street in daylight', 'a busy downtown sidewalk during the day', 'urban buildings under a bright sky'],
    g: ['hip-hop', 'boom bap', 'funk', 'bebop jazz', 'indie pop', 'garage rock', 'house'] },

  { id: 'city_night', v: 0.0, e: 0.5,
    prompts: ['a city street at night lit by neon signs', 'a downtown street after dark', 'nighttime urban photography with streetlights'],
    g: ['synthwave', 'trip-hop', 'neo-noir jazz', 'deep house', 'alt R&B', 'lo-fi hip-hop', 'UK garage'] },

  { id: 'city_aerial_skyline', v: 0.3, e: 0.5,
    prompts: ['an aerial view of a city skyline', 'a skyline of tall buildings seen from above', 'a drone shot over a metropolis'],
    g: ['cinematic electronic', 'post-rock', 'orchestral hybrid', 'ambient techno'] },

  { id: 'suburb_residential', v: 0.3, e: 0.4,
    prompts: ['a quiet suburban residential street', 'houses with front lawns in a neighbourhood', 'a row of suburban homes'],
    g: ['indie rock', 'bedroom pop', 'emo', 'power pop', 'midwest emo'] },

  { id: 'rural_farmland', v: 0.4, e: 0.4,
    prompts: ['open farmland with fields and barns', 'a rural countryside with crops', 'a farm under an open sky'],
    g: ['country', 'bluegrass', 'americana', 'folk', 'alt-country'] },

  { id: 'desert', v: 0.1, e: 0.4,
    prompts: ['a vast sandy desert', 'arid dunes and dry rock', 'a desert landscape with cacti'],
    g: ['desert blues', 'spaghetti western score', 'stoner rock', 'psychedelic rock', 'ambient americana', 'tuareg guitar'] },

  { id: 'ocean_beach', v: 0.6, e: 0.4,
    prompts: ['a sandy beach at the edge of the ocean', 'waves breaking on a shoreline', 'a coastal beach with surf'],
    g: ['surf rock', 'bossa nova', 'tropical house', 'reggae', 'yacht rock', 'dream pop'] },

  { id: 'ocean_open_deep', v: -0.1, e: 0.3,
    prompts: ['the open ocean far from land', 'deep water stretching to the horizon', 'a vast expanse of sea'],
    g: ['ambient', 'impressionist orchestral', 'drone', 'post-rock', 'new age'] },

  { id: 'lake_river', v: 0.2, e: 0.25,
    prompts: ['a calm lake surrounded by land', 'a river winding through a valley', 'still freshwater with a far shore'],
    g: ['ambient americana', 'chamber folk', 'downtempo', 'impressionist piano', 'slowcore', 'nordic folk'] },

  { id: 'forest', v: 0.2, e: 0.3,
    prompts: ['a dense forest of trees', 'woodland with a canopy overhead', 'a path through tall trees'],
    g: ['folk', 'neofolk', 'celtic', 'ambient field-recording', 'freak folk', 'chamber folk'] },

  { id: 'jungle_tropical', v: 0.3, e: 0.5,
    prompts: ['a lush tropical jungle', 'dense rainforest foliage', 'tropical palms and hanging vines'],
    g: ['afrobeat', 'tribal percussion', 'jungle', 'cumbia', 'world fusion'] },

  { id: 'field_meadow', v: 0.4, e: 0.35,
    prompts: ['an open grassy meadow', 'a field of tall grass and wildflowers', 'rolling green fields'],
    g: ['indie folk', 'pastoral orchestral', 'dream pop', 'americana', 'chamber pop'] },

  { id: 'garden_park', v: 0.45, e: 0.3,
    prompts: ['a cultivated garden with flowers', 'a public park with trees and benches', 'manicured hedges and flowerbeds'],
    g: ['chamber pop', 'bossa nova', 'light jazz', 'impressionist classical', 'sunshine pop'] },

  { id: 'mountain_alpine', v: 0.3, e: 0.4,
    prompts: ['tall mountain peaks', 'an alpine range above the treeline', 'a rocky summit over deep valleys'],
    g: ['post-rock', 'epic orchestral', 'nordic folk', 'neoclassical'] },

  { id: 'snow_arctic', v: -0.1, e: 0.2,
    prompts: ['a snow-covered arctic landscape', 'an expanse of ice and snow', 'a frozen tundra under pale light'],
    g: ['ambient', 'neoclassical piano', 'glacial drone', 'icelandic post-rock', 'dark folk'] },

  { id: 'space_sky_stars', v: 0.0, e: 0.3,
    prompts: ['a night sky full of stars', 'a view of space and distant galaxies', 'the milky way over a dark horizon'],
    g: ['space ambient', 'berlin school electronic', 'sci-fi orchestral', 'drone', 'cosmic synth'] },

  { id: 'interior_cozy_home', v: 0.5, e: 0.2,
    prompts: ['a cozy living room interior', 'a warm home interior with soft furniture', 'a comfortable bedroom indoors'],
    g: ['lo-fi hip-hop', 'jazz ballad', 'acoustic singer-songwriter', 'chamber pop', 'soft rock'] },

  { id: 'interior_industrial_warehouse', v: -0.3, e: 0.5,
    prompts: ['an industrial warehouse interior', 'a factory floor with heavy machinery', 'a large bare concrete industrial space'],
    g: ['industrial', 'EBM', 'dark techno', 'noise rock', 'dark ambient'] },

  { id: 'interior_club_bar', v: 0.5, e: 0.8,
    prompts: ['a crowded nightclub interior', 'a bar with dim lighting and people', 'a dance floor under stage lights'],
    g: ['house', 'disco', 'techno', 'dancehall', 'club rap', 'amapiano'] },

  { id: 'interior_office_lab', v: 0.0, e: 0.4,
    prompts: ['an office interior with desks and monitors', 'a laboratory with scientific equipment', 'a clean modern workspace'],
    g: ['minimal techno', 'IDM', 'krautrock', 'downtempo'] },

  { id: 'church_temple_sacred', v: 0.2, e: 0.2,
    prompts: ['the interior of a church', 'a temple or sacred hall', 'a cathedral with stained glass windows'],
    g: ['choral', 'sacred chant', 'organ works', 'gospel', 'qawwali'] },

  { id: 'ruins_abandoned', v: -0.5, e: 0.2,
    prompts: ['abandoned ruins overgrown with plants', 'a derelict building falling apart', 'crumbling stone ruins'],
    g: ['dark ambient', 'drone', 'funeral doom', 'tape-decay ambient', 'doom metal'] },

  { id: 'battlefield_war', v: -0.6, e: 0.8, threshold: 0.62,
    prompts: ['a battlefield with smoke and debris', 'a war-torn ruined landscape', 'a destroyed street after conflict'],
    g: ['epic hybrid orchestral', 'military percussion', 'trailer music', 'atmospheric black metal'] },

  { id: 'road_highway', v: 0.3, e: 0.6,
    prompts: ['an open highway stretching into the distance', 'a long road through empty land', 'a view down an asphalt road'],
    g: ['motorik krautrock', 'heartland rock', 'synthwave', 'road-trip indie', 'outlaw country'] },

  // Added after a baseball photo matched no setting at all.
  { id: 'stadium_arena', v: 0.5, e: 0.8,
    prompts: ['a sports stadium with a playing field', 'an arena full of spectators', 'a baseball diamond or football pitch'],
    g: ['stadium rock', 'anthemic pop', 'brass band', 'EDM', 'hip-hop'] },
];

// --- time --------------------------------------------------------------------
// Only three tags on purpose. Sunrise vs sunset is undecidable from one frame, so
// they're merged. "3am" isn't visual either — DEEP_NIGHT below comes from luma.

const TIME: Tag[] = [
  { id: 'midday', v: 0.4, e: 0.5,
    prompts: ['a scene under bright midday sun', 'harsh overhead daylight with short shadows', 'a sunlit scene at noon'],
    g: [] },

  { id: 'golden_glow', v: 0.45, e: 0.3,
    prompts: ['a scene bathed in golden hour light', 'warm low sun near the horizon', 'orange and pink light across the sky'],
    g: ['indie folk', 'dream pop', 'chillwave', 'soul', 'ambient', 'post-rock', 'neoclassical'] },

  { id: 'night', v: -0.1, e: 0.35,
    prompts: ['a scene at night after dark', 'a dark nighttime view', 'artificial light against a black sky'],
    g: ['darkwave', 'trip-hop', 'ambient', 'slow jazz', 'deep house'] },
];

/** Kicks in when `night` fires over a near-black frame. Luma reads this better than text. */
export const DEEP_NIGHT = {
  v: -0.3,
  e: 0.2,
  g: ['dark ambient', 'slowcore', 'drone', 'vaporwave'],
  maxBrightness: 0.12,
};

// --- weather -----------------------------------------------------------------
// Dropped `dark_gloomy` — it was a mood in a weather costume and collided with
// cloudy, fog and horror_dread. Its genres moved into those.

const WEATHER: Tag[] = [
  { id: 'sunny_clear', v: 0.6, e: 0.5,
    prompts: ['a clear sunny day with blue sky', 'bright cloudless sunshine', 'a scene under open blue sky'],
    g: ['pop', 'funk', 'ska', 'surf rock', 'afrobeats', 'power pop'] },

  { id: 'cloudy_overcast', v: -0.2, e: 0.3,
    prompts: ['a grey overcast sky', 'flat cloudy daylight without shadows', 'a dull sky covered in cloud'],
    g: ['post-punk', 'shoegaze', 'slowcore', 'sadcore', 'gothic rock', 'britpop'] },

  { id: 'rain', v: -0.3, e: 0.25,
    prompts: ['falling rain and wet surfaces', 'a rainy day with puddles and droplets', 'rain streaking down in a wet scene'],
    g: ['lo-fi hip-hop', 'jazz ballad', 'bossa nova', 'ambient', 'slowcore', 'R&B slow jam'] },

  { id: 'storm_thunder', v: -0.5, e: 0.8, threshold: 0.58,
    prompts: ['a violent thunderstorm with lightning', 'dark storm clouds and dramatic sky', 'a lightning strike over a landscape'],
    g: ['epic orchestral', 'symphonic metal', 'drum & bass', 'industrial'] },

  { id: 'fog_mist', v: -0.4, e: 0.2,
    prompts: ['thick fog obscuring the view', 'a misty hazy scene with low visibility', 'soft mist hanging over the ground'],
    g: ['dark ambient', 'drone', 'shoegaze', 'doom jazz', 'ethereal wave'] },

  { id: 'snow_falling', v: 0.1, e: 0.2,
    prompts: ['snow falling through the air', 'fresh snowfall covering everything', 'snowflakes drifting down'],
    g: ['neoclassical piano', 'ambient', 'dream pop', 'choral'] },

  { id: 'wind_dust', v: -0.2, e: 0.4, threshold: 0.58,
    prompts: ['blowing dust and sand in the wind', 'a dusty haze carried by strong wind', 'wind whipping debris across a scene'],
    g: ['desert blues', 'drone', 'spaghetti western score', 'doom folk'] },
];

// --- action ------------------------------------------------------------------
// Weakest axis, and weighted 2x for energy, so it's gated on seeing a person.
// Sneaking/contemplating/creating/falling get raised floors — a model can see a body,
// not a motive.

const ACTION: Tag[] = [
  { id: 'running_chase', v: 0.0, e: 0.95, people: true,
    prompts: ['a person running at full speed', 'someone sprinting or being chased', 'a runner in mid-stride'],
    g: ['drum & bass', 'breakbeat', 'orchestral action', 'hard techno', 'punk', 'phonk'] },

  { id: 'fighting_conflict', v: -0.4, e: 0.95, people: true,
    prompts: ['people fighting each other', 'a physical confrontation between people', 'a violent struggle'],
    g: ['metal', 'hybrid orchestral', 'industrial', 'hardcore punk', 'aggressive trap'] },

  { id: 'sleeping_resting', v: 0.2, e: 0.05, people: true,
    prompts: ['a person asleep in bed', 'someone resting with eyes closed', 'a sleeping figure'],
    g: ['ambient', 'drone', 'soft piano', 'slowcore', 'new age'] },

  { id: 'walking_strolling', v: 0.3, e: 0.35, people: true,
    prompts: ['a person walking casually', 'someone strolling along a path', 'a figure walking away from the camera'],
    g: ['indie folk', 'mid-tempo pop', 'jazz', 'laid-back boom bap'] },

  { id: 'driving', v: 0.2, e: 0.6, people: true,
    prompts: ['a person driving a car', 'a view from inside a moving vehicle', 'hands on a steering wheel on the road'],
    g: ['synthwave', 'motorik krautrock', 'heartland rock', 'west coast hip-hop', 'night drive R&B'] },

  { id: 'dancing_party', v: 0.7, e: 0.9, people: true,
    prompts: ['people dancing at a party', 'a crowd dancing together', 'someone mid-dance move'],
    g: ['house', 'disco', 'pop', 'dancehall', 'funk', 'amapiano', 'baile funk'] },

  { id: 'working_studying', v: 0.1, e: 0.35, people: true,
    prompts: ['a person working at a desk', 'someone studying with books and notes', 'a person concentrating on a laptop'],
    g: ['lo-fi hip-hop', 'minimal techno', 'modern classical', 'calm IDM'] },

  { id: 'crying_grieving', v: -0.8, e: 0.15, people: true,
    prompts: ['a person crying', 'someone in visible grief', 'a face wet with tears'],
    g: ['sadcore', 'neoclassical strings', 'ambient', 'slow soul', 'sparse singer-songwriter'] },

  { id: 'embracing_romance', v: 0.7, e: 0.3, people: true,
    prompts: ['two people embracing', 'a couple holding each other closely', 'an affectionate hug between two people'],
    g: ['R&B slow jam', 'soul', 'jazz ballad', 'bolero', 'dream pop', 'romantic strings'] },

  { id: 'celebrating_crowd', v: 0.8, e: 0.85, people: true,
    prompts: ['a crowd celebrating with raised arms', 'people cheering at an event', 'a jubilant celebration'],
    g: ['anthemic pop', 'gospel', 'afrobeats', 'stadium rock', 'brass band'] },

  { id: 'sports_exercise', v: 0.5, e: 0.9, people: true,
    prompts: ['an athlete playing a sport', 'a person exercising in a gym', 'a competitive sporting moment'],
    g: ['EDM', 'trap', 'rock anthems', 'jersey club', 'hardstyle'] },

  { id: 'cooking_eating', v: 0.5, e: 0.4, people: true,
    prompts: ['people eating a meal together', 'someone cooking in a kitchen', 'a shared table full of food'],
    g: ['gypsy jazz', 'bossa nova', 'italian retro pop', 'swing', 'chanson'] },

  { id: 'sneaking_hiding', v: -0.4, e: 0.5, people: true, threshold: 0.62,
    prompts: ['a person hiding in shadow', 'someone creeping quietly out of sight', 'a figure concealed and watching'],
    g: ['tense minimal score', 'pizzicato suspense', 'dark jazz', 'glitch'] },

  { id: 'creating_art', v: 0.4, e: 0.4, people: true, threshold: 0.62,
    prompts: ['an artist painting at an easel', 'a musician playing an instrument', 'someone sculpting or drawing'],
    g: ['jazz fusion', 'art pop', 'math rock', 'modern classical'] },

  { id: 'falling_floating', v: 0.1, e: 0.25, people: true, threshold: 0.62,
    prompts: ['a person floating weightlessly', 'someone suspended mid-air', 'a body drifting underwater'],
    g: ['dream pop', 'ambient', 'shoegaze', 'suspended orchestral'] },

  { id: 'staring_contemplating', v: -0.1, e: 0.15, people: true, threshold: 0.62,
    prompts: ['a person staring into the distance', 'someone lost in thought looking away', 'a solitary figure gazing at a view'],
    g: ['ambient', 'minimal piano', 'drone', 'slow post-rock'] },
];

// --- mood --------------------------------------------------------------------
// Was meant to override everything, but it's the least reliable axis — so it's a
// strong bias with a margin gate instead.

const MOOD: Tag[] = [
  { id: 'horror_dread', v: -0.9, e: 0.6,
    prompts: ['a frightening scene full of dread', 'an unsettling horror image', 'something menacing lurking in darkness'],
    g: ['dissonant strings', 'dark ambient', 'musique concrete', 'industrial noise', 'atonal orchestral', 'doom metal'] },

  { id: 'suspense_tension', v: -0.5, e: 0.55,
    prompts: ['a tense suspenseful moment', 'an image charged with impending danger', 'a scene that feels about to break'],
    g: ['ostinato strings', 'pulsing minimal score', 'dark jazz', 'low drones'] },

  { id: 'triumph_victory', v: 0.9, e: 0.85,
    prompts: ['a moment of triumph and victory', 'someone succeeding gloriously', 'a heroic winning moment'],
    g: ['epic orchestral', 'anthem rock', 'brass fanfare', 'gospel choir'] },

  { id: 'nostalgia_memory', v: 0.2, e: 0.25,
    prompts: ['a nostalgic image that feels like an old memory', 'a faded scene from the past', 'a wistful remembered moment'],
    g: ['vaporwave', 'tape-saturated lo-fi', 'doo-wop', 'music box', 'vinyl-crackle jazz'] },

  { id: 'whimsy_playful', v: 0.7, e: 0.5,
    prompts: ['a whimsical playful scene', 'something charmingly silly and light', 'a quirky joyful image'],
    g: ['chamber pop', 'quirky folk', 'accordion waltz', 'pizzicato comedy', 'chiptune'] },

  { id: 'surreal_dreamlike', v: 0.0, e: 0.3,
    prompts: ['a surreal dreamlike scene', 'an image that breaks reality', 'something impossible and hallucinatory'],
    g: ['psychedelic', 'vaporwave', 'musique concrete', 'ethereal wave', 'detuned ambient'] },

  { id: 'isolation_loneliness', v: -0.7, e: 0.15,
    prompts: ['a lonely isolated scene', 'a single small figure in a vast empty space', 'a profound sense of solitude'],
    g: ['slowcore', 'sparse piano', 'drone', 'lo-fi bedroom', 'ambient americana'] },

  { id: 'hope_uplift', v: 0.7, e: 0.45,
    prompts: ['a hopeful uplifting scene', 'light breaking through after darkness', 'an image full of optimism'],
    g: ['post-rock crescendo', 'indie folk', 'major-key neoclassical', 'uplifting orchestral'] },

  { id: 'mystery_wonder', v: 0.2, e: 0.35,
    prompts: ['a scene full of mystery and wonder', 'an enchanting magical view', 'something awe-inspiring and unexplained'],
    g: ['celesta orchestral', 'ambient electronic', 'impressionist classical', 'ethereal choir'] },
];

/** Mood's multiplier once it clears its margin gate. */
export const MOOD_BIAS = 2;

// --- medium ------------------------------------------------------------------
// The big one. SigLIP reads photo style and era well, and the same scene on film vs
// from a drone shouldn't give the same music.

const MEDIUM: Tag[] = [
  { id: 'film_35mm', v: 0.3, e: 0.3, era: [1975, 2005],
    prompts: ['a 35mm film photograph with visible grain', 'an analog film photo with soft halation', 'a grainy film still'],
    g: ['dream pop', 'chillwave', 'indie folk', 'sadcore', 'tape-saturated lo-fi', 'jangle pop'] },

  { id: 'black_and_white', v: -0.2, e: 0.35, era: [1955, 1990],
    prompts: ['a black and white photograph', 'a monochrome image with no colour', 'a greyscale photo'],
    g: ['post-punk', 'cool jazz', 'noir jazz', 'chamber strings', 'minimal piano', 'gothic rock'] },

  { id: 'polaroid', v: 0.35, e: 0.3, era: [1972, 1995],
    prompts: ['a polaroid instant photo with a white border', 'a faded instant camera print', 'a washed-out square snapshot'],
    g: ['bedroom pop', 'twee pop', 'lo-fi indie', 'sunshine pop', 'vaporwave'] },

  { id: 'long_exposure', v: 0.0, e: 0.4,
    prompts: ['a long exposure photograph with light trails', 'silky blurred water from a slow shutter', 'streaked lights across a long exposure'],
    g: ['ambient techno', 'post-rock', 'drone', 'berlin school electronic', 'shoegaze'] },

  { id: 'drone_aerial', v: 0.3, e: 0.55,
    prompts: ['a drone photograph looking straight down', 'a high aerial view from above', 'a sweeping birds eye landscape shot'],
    g: ['cinematic electronic', 'orchestral hybrid', 'progressive house', 'ambient techno'] },

  { id: 'macro_closeup', v: 0.2, e: 0.2,
    prompts: ['an extreme macro close-up', 'a tiny subject filling the frame in fine detail', 'a shallow-focus detail shot'],
    g: ['minimal piano', 'glitch', 'IDM', 'chamber music', 'field-recording ambient'] },

  { id: 'flash_snapshot', v: 0.4, e: 0.75, era: [2001, 2012],
    prompts: ['a harsh direct-flash party snapshot', 'a blown-out flash photo at night', 'a candid photo lit by camera flash'],
    g: ['indie sleaze', 'electroclash', 'garage punk', 'dance punk', 'hyperpop'] },

  { id: 'vintage_70s', v: 0.35, e: 0.45, era: [1968, 1982],
    prompts: ['a faded 1970s photograph with warm colour cast', 'a vintage retro photo from decades ago', 'an aged print with yellowed tones'],
    g: ['psychedelic rock', 'funk', 'soul', 'yacht rock', 'krautrock', 'folk rock'] },

  { id: 'studio_lit', v: 0.4, e: 0.5,
    prompts: ['a professional studio photograph with controlled lighting', 'a polished editorial shot on a seamless backdrop', 'a glossy commercial photograph'],
    g: ['pop', 'R&B', 'art pop', 'disco', 'synth-pop'] },

  { id: 'phone_snapshot', v: 0.3, e: 0.45, era: [2012, 2026],
    prompts: ['a casual smartphone snapshot', 'an everyday phone photo', 'an unposed quick mobile picture'],
    g: ['bedroom pop', 'hyperpop', 'cloud rap', 'indie pop', 'lo-fi hip-hop'] },
];

// --- subject -----------------------------------------------------------------
// Gates the action bank, and pulls its own weight — a portrait says soul/singer-
// songwriter no matter where it was shot.

const SUBJECT: Tag[] = [
  // The actual gate. The tags below miss people who are small in frame (a wide sports
  // shot scored them all negative), which silently disarmed the action bank.
  { id: 'people_present', v: 0, e: 0.45, people: true, gateOnly: true, threshold: 0.32,
    prompts: ['a photograph containing people', 'one or more human figures in the frame', 'a scene with a person in it'],
    g: [] },

  { id: 'single_portrait', v: 0.2, e: 0.3, people: true,
    prompts: ['a portrait of one person', 'a close portrait of a single face', 'one person posed for the camera'],
    g: ['soul', 'singer-songwriter', 'alt R&B', 'neo soul', 'chamber pop', 'torch song'] },

  { id: 'group_of_people', v: 0.5, e: 0.5, people: true,
    prompts: ['a small group of people together', 'a handful of friends in one frame', 'several people posing together'],
    g: ['funk', 'indie rock', 'afrobeats', 'pop', 'ska'] },

  { id: 'crowd', v: 0.6, e: 0.8, people: true,
    prompts: ['a large crowd of many people', 'a packed audience filling the frame', 'a dense mass of people'],
    g: ['stadium rock', 'house', 'anthemic pop', 'gospel', 'brass band'] },

  { id: 'animal', v: 0.4, e: 0.3,
    prompts: ['an animal as the main subject', 'wildlife photographed up close', 'a pet filling the frame'],
    g: ['folk', 'pastoral orchestral', 'freak folk', 'ambient field-recording', 'chamber folk'] },

  { id: 'architecture_no_people', v: 0.0, e: 0.3,
    prompts: ['a building photographed with nobody in it', 'empty architecture and clean geometry', 'a deserted structure with no figures'],
    g: ['minimal techno', 'modern classical', 'ambient', 'krautrock', 'drone'] },

  { id: 'object_closeup', v: 0.1, e: 0.25,
    prompts: ['a single object isolated in the frame', 'a still life of one item', 'a close study of an inanimate thing'],
    g: ['IDM', 'minimal piano', 'glitch', 'musique concrete'] },

  { id: 'food', v: 0.55, e: 0.4,
    prompts: ['a plate of prepared food', 'an appetising dish photographed close up', 'a spread of food on a table'],
    g: ['gypsy jazz', 'bossa nova', 'italian retro pop', 'swing', 'chanson'] },

  { id: 'vehicle', v: 0.25, e: 0.6,
    prompts: ['a car or motorcycle as the subject', 'a vehicle photographed prominently', 'a parked or moving automobile'],
    g: ['synthwave', 'motorik krautrock', 'heartland rock', 'west coast hip-hop', 'phonk'] },
];

// --- motion ------------------------------------------------------------------
// Feeds energy for photos with no people, which is most of them.

const MOTION: Tag[] = [
  { id: 'motion_blur', v: 0.1, e: 0.8,
    prompts: ['a photo full of motion blur', 'a smeared image of fast movement', 'a blurred subject streaking past'],
    g: ['drum & bass', 'breakbeat', 'shoegaze', 'hard techno', 'jungle'] },

  { id: 'frozen_action', v: 0.3, e: 0.85,
    prompts: ['fast action frozen sharply in place', 'a high-speed moment captured crisply', 'mid-air movement caught perfectly still'],
    g: ['trap', 'EDM', 'punk', 'orchestral action', 'jersey club'] },

  { id: 'still_calm', v: 0.2, e: 0.15,
    prompts: ['a completely still and calm scene', 'a quiet motionless view', 'perfect stillness with nothing moving'],
    g: ['ambient', 'minimal piano', 'drone', 'slowcore', 'new age'] },

  { id: 'crowded_busy', v: 0.4, e: 0.7,
    prompts: ['a busy cluttered scene packed with detail', 'a chaotic frame full of activity', 'a dense overwhelming amount going on'],
    g: ['house', 'boom bap', 'funk', 'amapiano', 'baile funk'] },

  { id: 'empty_sparse', v: -0.3, e: 0.2,
    prompts: ['a sparse minimal scene with lots of empty space', 'a nearly empty frame', 'vast negative space around a small subject'],
    g: ['dark ambient', 'slowcore', 'sparse piano', 'ambient americana', 'drone'] },
];

// --- region ------------------------------------------------------------------
// Tiebreaker only — decent on architecture, poor on nature. But it's what turns
// "beach" into afrobeats or bossa nova instead of always tropical house.

const REGION: Tag[] = [
  { id: 'japan', v: 0.3, e: 0.45,
    prompts: ['a scene photographed in Japan', 'Japanese signage and architecture', 'a Tokyo street with kanji signs'],
    g: ['city pop', 'shibuya-kei', 'japanese jazz fusion', 'kankyo ongaku', 'j-pop'] },

  { id: 'west_africa', v: 0.6, e: 0.7,
    prompts: ['a scene photographed in West Africa', 'a West African market or street', 'people in West African dress'],
    g: ['afrobeats', 'highlife', 'afrobeat', 'desert blues', 'juju'] },

  { id: 'latin_america', v: 0.6, e: 0.65,
    prompts: ['a scene photographed in Latin America', 'colourful Latin American street architecture', 'a South American plaza'],
    g: ['cumbia', 'bossa nova', 'salsa', 'MPB', 'tropicalia'] },

  { id: 'scandinavia', v: 0.0, e: 0.3,
    prompts: ['a scene photographed in Scandinavia', 'Nordic minimalist architecture and pale light', 'an Icelandic or Norwegian landscape'],
    g: ['nordic folk', 'icelandic post-rock', 'neoclassical piano', 'glacial drone', 'scandinavian jazz'] },

  { id: 'american_south', v: 0.3, e: 0.5,
    prompts: ['a scene photographed in the American South', 'a southern US porch and oak trees', 'a Mississippi delta roadside'],
    g: ['blues', 'southern rock', 'gospel', 'outlaw country', 'zydeco'] },

  { id: 'middle_east', v: 0.2, e: 0.5,
    prompts: ['a scene photographed in the Middle East', 'Middle Eastern architecture with arches', 'an old souk with arabic signage'],
    g: ['arabic classical', 'dabke', 'qawwali', 'anatolian psychedelic rock', 'oud instrumental'] },

  { id: 'india', v: 0.4, e: 0.5,
    prompts: ['a scene photographed in India', 'an Indian street with colourful textiles', 'Indian temple architecture'],
    g: ['hindustani classical', 'retro bollywood', 'carnatic fusion', 'morning raga', 'bhangra'] },

  { id: 'mediterranean', v: 0.5, e: 0.45,
    prompts: ['a Mediterranean coastal town', 'whitewashed buildings above blue water', 'a southern European seaside village'],
    g: ['flamenco', 'rebetiko', 'italian retro pop', 'chanson', 'greek folk'] },
];

// --- banks -------------------------------------------------------------------
// Floors were set by running the real taxonomy over sample photos, not guessed.

export const BANKS: Bank[] = [
  { id: 'setting', tags: SETTING, threshold: 0.35, topK: 2, weight: 1.0, vWeight: 1, eWeight: 1 },
  { id: 'time',    tags: TIME,    threshold: 0.35, topK: 1, weight: 0.7, vWeight: 1, eWeight: 1 },
  { id: 'weather', tags: WEATHER, threshold: 0.42, topK: 2, weight: 0.8, vWeight: 2, eWeight: 1 },
  { id: 'action',  tags: ACTION,  threshold: 0.45, topK: 1, weight: 0.9, vWeight: 1, eWeight: 2, requiresPeople: true },
  { id: 'mood',    tags: MOOD,    threshold: 0.45, topK: 1, weight: 0.8, vWeight: 2, eWeight: 2, minMargin: 0.08 },
  { id: 'medium',  tags: MEDIUM,  threshold: 0.38, topK: 2, weight: 1.0, vWeight: 1, eWeight: 1 },
  { id: 'subject', tags: SUBJECT, threshold: 0.38, topK: 2, weight: 0.8, vWeight: 1, eWeight: 1 },
  { id: 'motion',  tags: MOTION,  threshold: 0.40, topK: 1, weight: 0.9, vWeight: 1, eWeight: 2 },
  // Noisiest axis by far, so it has to be near-certain.
  { id: 'region',  tags: REGION,  threshold: 0.60, topK: 1, weight: 0.4, vWeight: 1, eWeight: 1 },
];

export const BANK_BY_ID = new Map(BANKS.map((b) => [b.id, b]));

export function findTag(bank: BankId, id: string): Tag | undefined {
  return BANK_BY_ID.get(bank)?.tags.find((t) => t.id === id);
}

/** Every prompt across every bank, in a stable order, for warmup embedding. */
export function allPrompts(): { bank: BankId; tag: string; prompts: string[] }[] {
  return BANKS.flatMap((b) => b.tags.map((t) => ({ bank: b.id, tag: t.id, prompts: t.prompts })));
}

// Spotify's `genre:` filter matches artist tags and returns nothing for most subgenre
// strings. Only these go out as filters; the rest are free text. Short on purpose —
// a zero-result query is worse than a loose one.
export const GENRE_FILTER_SAFE = new Set([
  'ambient', 'americana', 'blues', 'bluegrass', 'chanson', 'choral', 'classical',
  'country', 'disco', 'drum & bass', 'dub', 'dancehall', 'electronic', 'emo', 'flamenco',
  'folk', 'funk', 'gospel', 'grunge', 'hardcore punk', 'hip-hop', 'house', 'idm',
  'industrial', 'jazz', 'j-pop', 'metal', 'new age', 'opera', 'pop', 'post-punk',
  'post-rock', 'psychedelic rock', 'punk', 'reggae', 'reggaeton', 'rock', 'salsa',
  'shoegaze', 'ska', 'soul', 'synth-pop', 'techno', 'trance', 'trap', 'vaporwave',
]);

/** Fallback when nothing clears threshold. */
export const NEUTRAL_FALLBACK = {
  v: 0,
  e: 0.3,
  g: ['ambient', 'neoclassical', 'modern classical', 'downtempo'],
};
