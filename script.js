
const MAP_CATALOGUE = [
  {
    slug: "life-expectancy",
    aliases: ["life expectancy", "lifespan", "how long people live"]
  },
  {
    slug: "population-density",
    aliases: ["population density", "people per area"]
  },
  {
    slug: "co2-emissions-per-capita",
    aliases: ["co2 emissions per capita", "carbon emissions per person"]
  },
  {
    slug: "gdp-per-capita-worldbank",
    aliases: ["gdp per capita", "income per person", "economic output per person"]
  },
  {
    slug: "share-of-individuals-using-the-internet",
    aliases: ["internet use", "internet usage", "internet users"]
  }
];

const GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

let maps = [];
let currentIndex = 0;
let score = 0;
let answered = false;
let worldFeatures = [];
let challengeDate = "";


function getUtcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

// Convert a string, such as "2026-10-29", into a repeatable seed.
function hashString(text) {
  let hash = 2166136261;

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

// A seeded random-number generator.
function mulberry32(seed) {
  return function () {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// The same input and date always produce the same order.
function deterministicShuffle(items, dateKey) {
  const random = mulberry32(hashString(dateKey));

  return d3.shuffle([...items], random);
}


const mapElement = d3.select("#map");

async function fetchMapData(item) {
  const base = `https://ourworldindata.org/grapher/${item.slug}`;

  const [csvResponse, metadataResponse] = await Promise.all([
    fetch(`${base}.csv`),
    fetch(`${base}.metadata.json`)
  ]);

  if (!csvResponse.ok || !metadataResponse.ok) {
    throw new Error(`Could not load indicator: ${item.slug}`);
  }

  const csvText = await csvResponse.text();
  const metadata = await metadataResponse.json();
  const rows = d3.csvParse(csvText);

  if (!rows.length) {
    throw new Error(`No data returned for ${item.slug}`);
  }

  const columns = rows.columns;
  const valueColumn = columns.find(
    column => !["Entity", "Code", "Year", "Day"].includes(column)
  );

  if (!valueColumn || !columns.includes("Code")) {
    throw new Error(`Unexpected data format for ${item.slug}`);
  }

  // Keep the most recent available observation for each country.
  const latestByCountry = new Map();

  for (const row of rows) {
    const code = row.Code;
    const value = Number(row[valueColumn]);

    if (!code || code.startsWith("OWID_") || !Number.isFinite(value)) {
      continue;
    }

    const date = row.Year || row.Day || "";

    if (
      !latestByCountry.has(code) ||
      date > latestByCountry.get(code).date
    ) {
      latestByCountry.set(code, { value, date });
    }
  }

  const columnMetadata = metadata.columns?.[valueColumn] || {};

  return {
    ...item,
    title: metadata.chart?.title || columnMetadata.titleShort || item.slug,
    source: columnMetadata.citationShort || "Our World in Data",
    values: new Map(
      [...latestByCountry].map(([code, entry]) => [code, entry.value])
    )
  };
}

function drawMap(mapData) {
  const wrapper = document.querySelector(".map-wrapper");
  const width = wrapper.clientWidth;
  const height = 370;

  mapElement
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width)
    .attr("height", height);

  mapElement.selectAll("*").remove();

  const projection = d3.geoNaturalEarth1()
    .fitExtent(
      [[5, 5], [width - 5, height - 5]],
      {
        type: "FeatureCollection",
        features: worldFeatures
      }
    );

  const path = d3.geoPath(projection);

  // Use country ISO codes to match geography with OWID data.
  const color = d3.scaleSequential()
    .interpolator(d3.interpolateBlues);

  const availableValues = worldFeatures
    .map(feature => getCountryValue(feature, mapData))
    .filter(value => value !== null);

  if (availableValues.length) {
    color.domain(d3.extent(availableValues));
  }

  mapElement.selectAll("path")
    .data(worldFeatures)
    .join("path")
    .attr("d", path)
    .attr("fill", feature => {
      const value = getCountryValue(feature, mapData);
      return value === null ? "#e2e7ec" : color(value);
    })
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.45)
    .append("title")
    .text(() => "Country");

  document.getElementById("map-status").textContent =
    "Mystery map " + (currentIndex + 1) + " of " + maps.length;
}

function getCountryValue(feature, mapData) {
  const properties = feature.properties || {};

  const codes = [
    properties.ISO_A3,
    properties.ADM0_A3,
    properties.SOV_A3
  ];

  for (const code of codes) {
    if (code && mapData.values.has(code)) {
      return mapData.values.get(code);
    }
  }

  return null;
}

function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function checkGuess(event) {
  event.preventDefault();

  if (answered || !maps.length) return;

  const guess = normalise(document.getElementById("guess").value);
  const mapData = maps[currentIndex];

  if (!guess) return;

  const acceptedAnswers = [
    normalise(mapData.title),
    ...mapData.aliases.map(normalise)
  ];

  const correct = acceptedAnswers.some(answer =>
    guess === answer ||
    (answer.length > 5 && guess.includes(answer)) ||
    (guess.length > 5 && answer.includes(guess))
  );

  answered = true;
  document.getElementById("guess").disabled = true;
  document.querySelector("#guess-form button").disabled = true;
  document.getElementById("reveal").disabled = true;

  if (correct) {
    score++;
    document.getElementById("feedback").textContent =
      "Correct! The answer is " + mapData.title + ".";
  } else {
    document.getElementById("feedback").textContent =
      "Not quite. The answer is: " + mapData.title + ".";
  }

  updateScore();
}

function revealAnswer() {
  if (!maps.length || answered) return;

  answered = true;

  document.getElementById("feedback").textContent =
    "Answer: " + maps[currentIndex].title;

  document.getElementById("guess").disabled = true;
  document.querySelector("#guess-form button").disabled = true;
  document.getElementById("reveal").disabled = true;
  updateScore();
}

function updateScore() {
  document.getElementById("score").textContent =
    `Score: ${score}`;

  document.getElementById("progress").textContent =
    `Map ${currentIndex + 1} of ${maps.length}`;
}

function nextMap() {
  if (!maps.length) return;

  currentIndex++;

  if (currentIndex >= maps.length) {
    document.getElementById("map-status").textContent =
      "Challenge complete! Final score: " + score + "/" + maps.length;

    mapElement.selectAll("*").remove();
    document.getElementById("guess-form").hidden = true;
    document.getElementById("reveal").hidden = true;
    document.getElementById("next").hidden = true;
    document.getElementById("feedback").textContent =
      `You scored ${score} out of ${maps.length}. Refresh to play again.`;

    return;
  }

  answered = false;
  document.getElementById("guess").value = "";
  document.getElementById("guess").disabled = false;
  document.querySelector("#guess-form button").disabled = false;
  document.getElementById("reveal").disabled = false;
  document.getElementById("feedback").textContent = "";

  drawMap(maps[currentIndex]);
  updateScore();
}

async function startGame() {
  try {
    challengeDate = getUtcDateKey();

    document.getElementById("challenge-date").textContent =
      `Daily Challenge · ${challengeDate} (UTC)`;

    document.getElementById("map-status").textContent =
      "Loading map data…";

    const geoResponse = await fetch(GEOJSON_URL);

    if (!geoResponse.ok) {
      throw new Error("Could not load world map shapes.");
    }

    const geojson = await geoResponse.json();
    worldFeatures = geojson.features;

    const results = await Promise.allSettled(
      MAP_CATALOGUE.map(fetchMapData)
    );

    maps = results
      .filter(result => result.status === "fulfilled")
      .map(result => result.value);

    
  if (maps.length < 5) {
    throw new Error(
      `Only ${maps.length} maps loaded successfully. ` +
      "Five maps are required for the daily challenge."
    );
}

  if (maps.length < MAP_CATALOGUE.length) {
    console.warn("Some indicators could not be loaded:", results);
  }

  // Deterministically select and order today's five maps.
  maps = deterministicShuffle(maps, challengeDate).slice(0, 5);


    document.getElementById("map-status").textContent = "";
    drawMap(maps[currentIndex]);
    updateScore();
  } catch (error) {
    console.error(error);

    document.getElementById("map-status").textContent =
      "We couldn't load the maps. Check your internet connection " +
      "and the browser console, then try refreshing.";
  }
}

document.getElementById("guess-form")
  .addEventListener("submit", checkGuess);

document.getElementById("reveal")
  .addEventListener("click", revealAnswer);

document.getElementById("next")
  .addEventListener("click", nextMap);

window.addEventListener("resize", () => {
  if (maps.length && currentIndex < maps.length) {
    drawMap(maps[currentIndex]);
  }
});

startGame();
