const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

// Use node-fetch for older Node.js versions, or built-in fetch for Node.js 18+
let fetch;
try {
  // Try to use built-in fetch (Node.js 18+)
  if (typeof globalThis.fetch === "function") {
    fetch = globalThis.fetch;
  } else {
    // Fallback to node-fetch for older versions
    fetch = require("node-fetch");
  }
} catch (e) {
  // If node-fetch is not installed and fetch is not available, throw error
  console.error(
    "❌ Error: fetch is not available. Please install node-fetch: npm install node-fetch@2"
  );
  console.error("   Or upgrade to Node.js 18+ which has fetch built-in.");
  process.exit(1);
}

const app = express();
const PORT = 3000;
const DB_PATH = "./data.db";
const API_BASE_4ANM = "https://4anm.top";

// Token/Cookie management for 4anm.top API (server-side)
let apiToken = {
  cookie: "",
  csrfToken: "",
  lastUpdated: 0,
  expiresIn: 30 * 60 * 1000, // 30 minutes
  defaultGetTime: null,
};

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("."));

// Initialize database
function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error("Error opening database:", err);
        reject(err);
        return;
      }
      console.log("Connected to SQLite database");
    });

    // Create table for time slot data
    db.run(
      `
      CREATE TABLE IF NOT EXISTS time_slot_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time_slot TEXT NOT NULL UNIQUE,
        link_mapping TEXT,
        sub_id_mapping TEXT,
        reason_mapping TEXT,
        product_cache TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating table:", err);
          reject(err);
          return;
        }

        // Create table for system status
        db.run(
          `
          CREATE TABLE IF NOT EXISTS system_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            is_active INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `,
          (err) => {
            if (err) {
              console.error("Error creating system_status table:", err);
              reject(err);
              return;
            }

            // Initialize system status if not exists
            db.run(
              `INSERT OR IGNORE INTO system_status (id, is_active) VALUES (1, 1)`,
              (err) => {
                if (err) {
                  console.error("Error initializing system status:", err);
                  reject(err);
                } else {
                  console.log("Database initialized");
                  resolve(db);
                }
              }
            );
          }
        );
      }
    );
  });
}

let db;

// Initialize database on startup
initDatabase()
  .then((database) => {
    db = database;
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });

// API: Get all time slot data
app.get("/api/data", (req, res) => {
  db.all("SELECT * FROM time_slot_data", (err, rows) => {
    if (err) {
      console.error("Error fetching data:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    // Convert rows to object format
    const result = {};
    rows.forEach((row) => {
      result[row.time_slot] = {
        linkMapping: row.link_mapping ? JSON.parse(row.link_mapping) : {},
        subIdMapping: row.sub_id_mapping ? JSON.parse(row.sub_id_mapping) : {},
        reasonMapping: row.reason_mapping ? JSON.parse(row.reason_mapping) : {},
        productCache: row.product_cache ? JSON.parse(row.product_cache) : {},
      };
    });

    res.json(result);
  });
});

// API: Get data for specific time slot
app.get("/api/data/:timeSlot", (req, res) => {
  const timeSlot = decodeURIComponent(req.params.timeSlot);

  db.get(
    "SELECT * FROM time_slot_data WHERE time_slot = ?",
    [timeSlot],
    (err, row) => {
      if (err) {
        console.error("Error fetching time slot data:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      if (!row) {
        res.json({
          linkMapping: {},
          subIdMapping: {},
          reasonMapping: {},
          productCache: {},
        });
        return;
      }

      res.json({
        linkMapping: row.link_mapping ? JSON.parse(row.link_mapping) : {},
        subIdMapping: row.sub_id_mapping ? JSON.parse(row.sub_id_mapping) : {},
        reasonMapping: row.reason_mapping ? JSON.parse(row.reason_mapping) : {},
        productCache: row.product_cache ? JSON.parse(row.product_cache) : {},
      });
    }
  );
});

// API: Save time slot data
app.post("/api/data", (req, res) => {
  const { timeSlot, data } = req.body;

  if (!timeSlot) {
    res.status(400).json({ success: false, error: "timeSlot is required" });
    return;
  }

  const linkMapping = JSON.stringify(data.linkMapping || {});
  const subIdMapping = JSON.stringify(data.subIdMapping || {});
  const reasonMapping = JSON.stringify(data.reasonMapping || {});
  const productCache = JSON.stringify(data.productCache || {});

  db.run(
    `INSERT INTO time_slot_data (time_slot, link_mapping, sub_id_mapping, reason_mapping, product_cache, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(time_slot) DO UPDATE SET
       link_mapping = excluded.link_mapping,
       sub_id_mapping = excluded.sub_id_mapping,
       reason_mapping = excluded.reason_mapping,
       product_cache = excluded.product_cache,
       updated_at = CURRENT_TIMESTAMP`,
    [timeSlot, linkMapping, subIdMapping, reasonMapping, productCache],
    function (err) {
      if (err) {
        console.error("Error saving data:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      res.json({ success: true, message: "Data saved successfully" });
    }
  );
});

// API: Save all time slot data (batch)
app.post("/api/data/batch", (req, res) => {
  const allData = req.body;

  if (!allData || typeof allData !== "object") {
    res.status(400).json({ success: false, error: "Invalid data format" });
    return;
  }

  const timeSlots = Object.keys(allData);
  let completed = 0;
  let errors = [];

  if (timeSlots.length === 0) {
    res.json({ success: true, message: "No data to save" });
    return;
  }

  timeSlots.forEach((timeSlot) => {
    const data = allData[timeSlot];
    const linkMapping = JSON.stringify(data.linkMapping || {});
    const subIdMapping = JSON.stringify(data.subIdMapping || {});
    const reasonMapping = JSON.stringify(data.reasonMapping || {});
    const productCache = JSON.stringify(data.productCache || {});

    db.run(
      `INSERT INTO time_slot_data (time_slot, link_mapping, sub_id_mapping, reason_mapping, product_cache, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(time_slot) DO UPDATE SET
         link_mapping = excluded.link_mapping,
         sub_id_mapping = excluded.sub_id_mapping,
         reason_mapping = excluded.reason_mapping,
         product_cache = excluded.product_cache,
         updated_at = CURRENT_TIMESTAMP`,
      [timeSlot, linkMapping, subIdMapping, reasonMapping, productCache],
      function (err) {
        if (err) {
          console.error(`Error saving data for ${timeSlot}:`, err);
          errors.push({ timeSlot, error: err.message });
        }

        completed++;
        if (completed === timeSlots.length) {
          if (errors.length > 0) {
            res.status(500).json({ success: false, errors });
          } else {
            res.json({ success: true, message: "All data saved successfully" });
          }
        }
      }
    );
  });
});

// API: Delete time slot data
app.delete("/api/data/:timeSlot", (req, res) => {
  const timeSlot = decodeURIComponent(req.params.timeSlot);

  db.run(
    "DELETE FROM time_slot_data WHERE time_slot = ?",
    [timeSlot],
    function (err) {
      if (err) {
        console.error("Error deleting time slot data:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      res.json({ success: true, message: "Data deleted successfully" });
    }
  );
});

// API: Delete all data
app.delete("/api/data", (req, res) => {
  db.run("DELETE FROM time_slot_data", (err) => {
    if (err) {
      console.error("Error deleting all data:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    res.json({ success: true, message: "All data deleted successfully" });
  });
});

// API: Get list of time slots that have data in DB
app.get("/api/time-slots", (req, res) => {
  db.all("SELECT time_slot FROM time_slot_data", (err, rows) => {
    if (err) {
      console.error("Error fetching time slots:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    const timeSlots = rows.map((row) => row.time_slot);
    res.json({ success: true, data: timeSlots });
  });
});

// API: Get system status
app.get("/api/system-status", (req, res) => {
  db.get("SELECT is_active FROM system_status WHERE id = 1", (err, row) => {
    if (err) {
      console.error("Error fetching system status:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    const isActive = row ? row.is_active === 1 : true; // Default to active if not found
    res.json({ success: true, isActive: isActive });
  });
});

// API: Update system status
app.post("/api/system-status", (req, res) => {
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    res
      .status(400)
      .json({ success: false, error: "isActive must be a boolean" });
    return;
  }

  db.run(
    `UPDATE system_status SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    [isActive ? 1 : 0],
    function (err) {
      if (err) {
        console.error("Error updating system status:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      res.json({
        success: true,
        message: "System status updated",
        isActive: isActive,
      });
    }
  );
});

// ==================== 4ANM.TOP API PROXY ====================

// Refresh API token/cookie from 4anm.top
async function refreshApiToken() {
  try {
    console.log("🔄 [Server] Refreshing API token from 4anm.top...");

    // Fetch the main page to get fresh cookies and CSRF token
    const response = await fetch(`${API_BASE_4ANM}/flashsale`, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    // Extract cookies from response headers
    let cookieString = "";
    const cookies = [];

    // Get all Set-Cookie headers
    const setCookieHeaders = response.headers.get("set-cookie");
    if (setCookieHeaders) {
      // Handle multiple cookies (split by comma, but be careful with expires dates)
      const cookieArray = setCookieHeaders.split(/,(?=\s*\w+\s*=)/);
      cookieArray.forEach((cookieHeader) => {
        const parts = cookieHeader.split(";");
        if (parts.length > 0) {
          const [nameValue] = parts;
          const [name, ...valueParts] = nameValue.split("=");
          if (name && valueParts.length > 0) {
            const value = valueParts.join("="); // Rejoin in case value contains =
            cookies.push(`${name.trim()}=${value.trim()}`);
          }
        }
      });
    }

    cookieString = cookies.join("; ");

    // Get CSRF token from response body
    const html = await response.text();
    let csrfToken = "";

    // Try multiple patterns to find CSRF token
    const patterns = [
      /name=["']csrf-token["']\s+content=["']([^"']+)["']/i,
      /csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
      /x-csrf-token["']?\s*[:=]\s*["']([^"']+)["']/i,
      /<meta[^>]*name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i,
      /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']csrf-token["']/i,
      /window\.csrfToken\s*=\s*["']([^"']+)["']/i,
      /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        csrfToken = match[1];
        break;
      }
    }

    // Update token cache
    apiToken.cookie = cookieString;
    apiToken.csrfToken = csrfToken;
    apiToken.lastUpdated = Date.now();

    console.log("✅ [Server] API token refreshed", {
      hasCookie: !!cookieString,
      hasCsrf: !!csrfToken,
      cookieLength: cookieString.length,
    });

    return { cookie: cookieString, csrfToken };
  } catch (error) {
    console.error("❌ [Server] Error refreshing API token:", error);
    // Try to use cached token if available
    if (apiToken.cookie && apiToken.csrfToken) {
      console.log("⚠️ [Server] Using cached token");
      return { cookie: apiToken.cookie, csrfToken: apiToken.csrfToken };
    }
    throw error;
  }
}

// Get valid API token (refresh if expired or about to expire)
async function getValidApiToken() {
  const now = Date.now();
  const timeSinceUpdate = now - apiToken.lastUpdated;
  const refreshThreshold = apiToken.expiresIn * 0.8; // Refresh when 80% of time has passed (24 minutes)

  const isExpired =
    !apiToken.cookie ||
    !apiToken.csrfToken ||
    timeSinceUpdate > apiToken.expiresIn;

  const shouldRefresh = timeSinceUpdate > refreshThreshold;

  if (isExpired || shouldRefresh) {
    console.log(
      `🔄 [Server] Token ${
        isExpired ? "expired" : "about to expire"
      }, refreshing...`
    );
    return await refreshApiToken();
  }

  return { cookie: apiToken.cookie, csrfToken: apiToken.csrfToken };
}

// API: Get time slots from external flashsale API
app.get("/api/times", async (req, res) => {
  try {
    // Get valid token
    let token = await getValidApiToken();

    // Fetch data from API to get get_times
    const defaultTime = apiToken.defaultGetTime || "";
    const apiUrl = `${API_BASE_4ANM}/search_flashsale2025.php?get_time=${defaultTime}&page=1&limit=1&sort_by=discount&rating_filter=all&query=&fs=false`;

    let response;
    try {
      response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Cookie: token.cookie,
          "x-csrf-token": token.csrfToken,
          "x-requested-with": "XMLHttpRequest",
          Referer: `${API_BASE_4ANM}/flashsale`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
    } catch (fetchError) {
      // If fetch fails, try refreshing token
      console.log("⚠️ [Server] Fetch failed, refreshing token...");
      token = await refreshApiToken();
      response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Cookie: token.cookie,
          "x-csrf-token": token.csrfToken,
          "x-requested-with": "XMLHttpRequest",
          Referer: `${API_BASE_4ANM}/flashsale`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
    }

    if (!response.ok) {
      // If unauthorized or forbidden, refresh token and retry
      if (response.status === 401 || response.status === 403) {
        console.log(
          "⚠️ [Server] Unauthorized/Forbidden, refreshing token and retrying..."
        );
        token = await refreshApiToken();
        response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            Cookie: token.cookie,
            "x-csrf-token": token.csrfToken,
            "x-requested-with": "XMLHttpRequest",
            Referer: `${API_BASE_4ANM}/flashsale`,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
          },
        });

        // If still not ok after refresh, throw error
        if (!response.ok) {
          throw new Error(
            `API returned ${response.status}: ${response.statusText} after token refresh`
          );
        }
      } else {
        // For other errors, throw immediately
        throw new Error(
          `API returned ${response.status}: ${response.statusText}`
        );
      }
    }

    const data = await response.json();

    // Store default get_time if available
    if (data.default_get_time) {
      apiToken.defaultGetTime = data.default_get_time;
    }

    res.json({
      success: true,
      data: {
        get_times: data.get_times || [],
        default_get_time: data.default_get_time || null,
      },
    });
  } catch (error) {
    console.error("❌ [Server] Error fetching times:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch time slots",
    });
  }
});

// API: Get products from external flashsale API
app.get("/api/products", async (req, res) => {
  try {
    const {
      get_time,
      page = 1,
      limit = 10000,
      sort_by = "discount",
      rating_filter = "all",
      query = "",
      fs = "false",
    } = req.query;

    // Get valid token
    let token = await getValidApiToken();

    // Build API URL
    const getTime = get_time || apiToken.defaultGetTime || "";
    const apiUrl = `${API_BASE_4ANM}/search_flashsale2025.php?get_time=${getTime}&page=${page}&limit=${limit}&sort_by=${sort_by}&rating_filter=${rating_filter}&query=${encodeURIComponent(
      query
    )}&fs=${fs}`;

    let response;
    try {
      response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Cookie: token.cookie,
          "x-csrf-token": token.csrfToken,
          "x-requested-with": "XMLHttpRequest",
          Referer: `${API_BASE_4ANM}/flashsale`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
    } catch (fetchError) {
      // If fetch fails, try refreshing token
      console.log("⚠️ [Server] Fetch failed, refreshing token...");
      token = await refreshApiToken();
      response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Cookie: token.cookie,
          "x-csrf-token": token.csrfToken,
          "x-requested-with": "XMLHttpRequest",
          Referer: `${API_BASE_4ANM}/flashsale`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
    }

    // If unauthorized or forbidden, refresh token and retry
    if (response.status === 401 || response.status === 403) {
      console.log(
        "⚠️ [Server] Unauthorized/Forbidden, refreshing token and retrying..."
      );
      token = await refreshApiToken();
      response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Cookie: token.cookie,
          "x-csrf-token": token.csrfToken,
          "x-requested-with": "XMLHttpRequest",
          Referer: `${API_BASE_4ANM}/flashsale`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      // If still not ok after refresh, throw error
      if (!response.ok) {
        throw new Error(
          `API returned ${response.status}: ${response.statusText} after token refresh`
        );
      }
    } else if (!response.ok) {
      // For other errors, throw immediately
      throw new Error(
        `API returned ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();

    // Store default get_time if available
    if (data.default_get_time) {
      apiToken.defaultGetTime = data.default_get_time;
    }

    res.json({
      success: true,
      data: {
        products: data.products || [],
        get_times: data.get_times || [],
        default_get_time: data.default_get_time || null,
        has_more: data.has_more || false,
      },
    });
  } catch (error) {
    console.error("❌ [Server] Error fetching products:", error);
    // Try to refresh token and retry once
    try {
      console.log("🔄 [Server] Retrying with fresh token...");
      const newToken = await refreshApiToken();
      const {
        get_time,
        page = 1,
        limit = 10000,
        sort_by = "discount",
        rating_filter = "all",
        query = "",
        fs = "false",
      } = req.query;
      const getTime = get_time || apiToken.defaultGetTime || "";
      const retryUrl = `${API_BASE_4ANM}/search_flashsale2025.php?get_time=${getTime}&page=${page}&limit=${limit}&sort_by=${sort_by}&rating_filter=${rating_filter}&query=${encodeURIComponent(
        query
      )}&fs=${fs}`;

      const retryResponse = await fetch(retryUrl, {
        method: "GET",
        headers: {
          Cookie: newToken.cookie,
          "x-csrf-token": newToken.csrfToken,
          "x-requested-with": "XMLHttpRequest",
          Referer: `${API_BASE_4ANM}/flashsale`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        if (retryData.default_get_time) {
          apiToken.defaultGetTime = retryData.default_get_time;
        }
        res.json({
          success: true,
          data: {
            products: retryData.products || [],
            get_times: retryData.get_times || [],
            default_get_time: retryData.default_get_time || null,
            has_more: retryData.has_more || false,
          },
        });
      } else {
        throw error;
      }
    } catch (retryError) {
      console.error("❌ [Server] Retry also failed:", retryError);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to fetch products",
      });
    }
  }
});

// Start server
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server is running on http://103.200.23.43:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  if (db) {
    db.close((err) => {
      if (err) {
        console.error("Error closing database:", err);
      } else {
        console.log("Database connection closed");
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});
