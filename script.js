

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

  // Identify the columns containing geographic coordinates, if present.
  const findColumn = (names) =>
    columns.find(column =>
      names.includes(column.trim().toLowerCase())
    );

  const latitudeColumn = findColumn(["latitude", "lat"]);
  const longitudeColumn = findColumn(["longitude", "lon", "lng"]);

  // These columns describe the location or date, not the measured value.
  const dimensionColumns = [
    "entity", "code", "year", "day", "month", "date",
    "latitude", "longitude", "lat", "lon", "lng"
  ];

  const valueColumn = columns.find(
    column =>
      !dimensionColumns.includes(column.trim().toLowerCase())
  );

  if (!valueColumn) {
    throw new Error(`Could not identify a data column for ${item.slug}`);
  }

  // Convert a value to a number, while rejecting empty cells.
  function toNumber(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  // Keep the latest observation for each geographic entity.
  const latestByEntity = new Map();

  for (const row of rows) {
    const value = toNumber(row[valueColumn]);

    if (value === null) {
      continue;
    }

    const entity = row.Entity || row.Code;

    if (!entity) {
      continue;
    }

    const date = row.Year || row.Day || row.Date || "";

    const latitude = latitudeColumn
      ? toNumber(row[latitudeColumn])
      : null;

    const longitude = longitudeColumn
      ? toNumber(row[longitudeColumn])
      : null;

    const existing = latestByEntity.get(entity);

    if (!existing || date > existing.date) {
      latestByEntity.set(entity, {
        entity: row.Entity || "",
        code: row.Code || "",
        value,
        date,
        latitude,
        longitude
      });
    }
  }

  const records = [...latestByEntity.values()];

  // Keep ISO-style three-letter codes for the existing country map.
  const countryValues = new Map();

  for (const record of records) {
    const code = record.code.toUpperCase();

    if (/^[A-Z]{3}$/.test(code)) {
      countryValues.set(code, record.value);
    }
  }

  // Work out what kind of geographic information this chart contains.
  const hasCoordinates = records.some(
    record =>
      record.latitude !== null &&
      record.longitude !== null &&
      record.latitude >= -90 &&
      record.latitude <= 90 &&
      record.longitude >= -180 &&
      record.longitude <= 180
  );

  const hasCountryCodes = countryValues.size > 0;

  const hasOtherCodes = records.some(
    record =>
      record.code &&
      !/^[A-Z]{3}$/.test(record.code)
  );

  let geographyType = "entity-only";

  if (hasCoordinates && (hasCountryCodes || hasOtherCodes)) {
    geographyType = "mixed";
  } else if (hasCoordinates) {
    geographyType = "point";
  } else if (hasCountryCodes) {
    geographyType = "country";
  } else if (hasOtherCodes) {
    geographyType = "regional-or-coded";
  }

  const columnMetadata = metadata.columns?.[valueColumn] || {};

  return {
    ...item,
    aliases: item.aliases || [],
    title: metadata.chart?.title ||
      columnMetadata.titleShort ||
      item.title ||
      item.slug,
    source: columnMetadata.citationShort || "Our World in Data",
    geographyType,
    records,
    values: countryValues
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

  // Draw the country outlines as the background.
  mapElement.selectAll("path")
    .data(worldFeatures)
    .join("path")
    .attr("d", path)
    .attr("fill", "#e2e7ec")
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 0.45);

  // Find records with valid geographic coordinates.
  const locationRecords = (mapData.records || []).filter(record =>
    Number.isFinite(record.latitude) &&
    Number.isFinite(record.longitude) &&
    record.latitude >= -90 &&
    record.latitude <= 90 &&
    record.longitude >= -180 &&
    record.longitude <= 180
  );

  // LOCATION MAP: draw circles at latitude and longitude.
  if (locationRecords.length > 0) {
    const color = d3.scaleSequential()
      .domain(d3.extent(locationRecords, record => record.value))
      .interpolator(d3.interpolateYlOrRd);

    mapElement.selectAll("circle")
      .data(locationRecords)
      .join("circle")
      .attr("cx", record =>
        projection([record.longitude, record.latitude])[0]
      )
      .attr("cy", record =>
        projection([record.longitude, record.latitude])[1]
      )
      .attr("r", 5)
      .attr("fill", record => color(record.value))
      .attr("fill-opacity", 0.8)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.7)
      .append("title")
      .text(record =>
        `${record.entity || "Location"}: ${record.value}`
      );

  } else {
    // COUNTRY HEATMAP: retain the original country colouring.
    const color = d3.scaleSequential()
      .interpolator(d3.interpolateBlues);

    const availableValues = worldFeatures
      .map(feature => getCountryValue(feature, mapData))
      .filter(value => value !== null);

    if (availableValues.length) {
      color.domain(d3.extent(availableValues));
    }

    mapElement.selectAll("path")
      .attr("fill", feature => {
        const value = getCountryValue(feature, mapData);
        return value === null ? "#e2e7ec" : color(value);
      })
      .append("title")
      .text("Country");
  }

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
      "Loading today's maps…";

    // Load the world map shapes.
    const geoResponse = await fetch(GEOJSON_URL);

    if (!geoResponse.ok) {
      throw new Error("Could not load world map shapes.");
    }

    const geojson = await geoResponse.json();
    worldFeatures = geojson.features;

    // Load the automatically generated OWID catalogue.
    const catalogueResponse = await fetch("./catalogue.json");

    if (!catalogueResponse.ok) {
      throw new Error("Could not load the OWID catalogue.");
    }

    const catalogue = await catalogueResponse.json();

    if (!Array.isArray(catalogue) || catalogue.length < 5) {
      throw new Error("The catalogue contains fewer than five maps.");
    }

    console.log("Available OWID maps:", catalogue.length);

    // Choose a repeatable order for today's maps.
    const candidates = deterministicShuffle(
      catalogue,
      challengeDate
    );

    maps = [];

    // Load indicators one by one, stopping after five work.
    for (const item of candidates) {
      try {
        const mapData = await fetchMapData(item);
        maps.push(mapData);

        console.log("Loaded map:", mapData.title);

        if (maps.length === 5) {
          break;
        }
      } catch (error) {
        console.warn("Skipping unavailable map:", item.slug, error);
      }
    }

    if (maps.length < 5) {
      throw new Error(
        `Only ${maps.length} usable maps could be loaded.`
      );
    }

    currentIndex = 0;
    score = 0;
    answered = false;

    document.getElementById("map-status").textContent = "";

    drawMap(maps[currentIndex]);
    updateScore();

  } catch (error) {
    console.error(error);

    document.getElementById("map-status").textContent =
      "We couldn't load the maps. Check your internet connection " +
      "and try refreshing.";
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
