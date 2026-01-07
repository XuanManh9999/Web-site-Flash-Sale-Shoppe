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
// New API endpoint
const API_BASE_DEALXK = "https://addlivetag.com/api/data_dealxk.php?aff_id=07970797";

// Increase timeout for long-running requests
const REQUEST_TIMEOUT = 300000; // 5 minutes

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("."));

// Middleware to set timeout for all requests
app.use((req, res, next) => {
  req.setTimeout(REQUEST_TIMEOUT);
  res.setTimeout(REQUEST_TIMEOUT);
  next();
});

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

        // Create table for products
        db.run(
          `
          CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time_slot TEXT NOT NULL,
            product_data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(time_slot, product_data)
          )
        `,
          (err) => {
            if (err) {
              console.error("Error creating products table:", err);
              reject(err);
              return;
            }

            // Create index for faster queries
            db.run(
              `CREATE INDEX IF NOT EXISTS idx_products_time_slot ON products(time_slot)`,
              (err) => {
                if (err) {
                  console.error("Error creating products index:", err);
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
                          console.error(
                            "Error initializing system status:",
                            err
                          );
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

// ==================== DEALXK API PROXY ====================

// Helper function to convert Unix timestamp to Vietnam time and format
function getVietnamTimeFromTimestamp(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  
  // Convert to Vietnam time (UTC+7) using toLocaleString
  const vietnamDateStr = date.toLocaleString("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  
  // Parse the formatted string: "MM/DD/YYYY, HH:MM:SS"
  const parts = vietnamDateStr.split(", ");
  const datePart = parts[0].split("/");
  const timePart = parts[1].split(":");
  
  return {
    hours: parseInt(timePart[0]),
    minutes: parseInt(timePart[1]),
    day: parseInt(datePart[1]),
    month: parseInt(datePart[0]),
    year: parseInt(datePart[2]),
  };
}

// Helper function to convert Unix timestamp to time slot format (for matching)
function getTimeSlotFromTimestamp(timestamp) {
  if (!timestamp) return null;
  const vnTime = getVietnamTimeFromTimestamp(timestamp);
  if (!vnTime) return null;
  
  // Format: HHmm (e.g., "0900" for 09:00)
  return `${String(vnTime.hours).padStart(2, "0")}${String(vnTime.minutes).padStart(2, "0")}`;
}

// Helper function to get time slot key from product (use sale_slot if available, else convert sale_time)
function getProductTimeSlotKey(product) {
  if (!product) return null;
  
  // Priority 1: Use sale_slot if available (format: "09:00")
  if (product.sale_slot) {
    const [hours, minutes] = product.sale_slot.split(":");
    return `${String(parseInt(hours || 0)).padStart(2, "0")}${String(parseInt(minutes || 0)).padStart(2, "0")}`;
  }
  
  // Priority 2: Convert sale_time timestamp to "HHmm" format
  if (product.sale_time) {
    return getTimeSlotFromTimestamp(product.sale_time);
  }
  
  return null;
}

// Helper function to normalize time slot for comparison
function normalizeTimeSlot(timeSlot) {
  if (!timeSlot) return null;
  // If it's a Unix timestamp, convert it
  if (/^\d+$/.test(timeSlot) && timeSlot.length > 8) {
    // It's a timestamp (long number)
    return getTimeSlotFromTimestamp(parseInt(timeSlot));
  }
  // If it's in format "HH:mm", convert to "HHmm"
  if (/^\d{1,2}:\d{2}$/.test(timeSlot)) {
    const [hours, minutes] = timeSlot.split(":");
    return `${String(parseInt(hours)).padStart(2, "0")}${String(
      parseInt(minutes)
    ).padStart(2, "0")}`;
  }
  // If it's already in "HHmm" format, return as is
  if (/^\d{4}$/.test(timeSlot)) {
    return timeSlot;
  }
  return timeSlot;
}

// API: Get time slots from external API
app.get("/api/times", async (req, res) => {
  try {
    console.log("🔄 [Server] Fetching time slots from API...");

    // Fetch all products from API
    const response = await fetch(API_BASE_DEALXK, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      throw new Error(
        `API returned ${response.status}: ${response.statusText}`
      );
    }

    const products = await response.json();

    if (!Array.isArray(products)) {
      throw new Error("API returned invalid data format");
    }

    // Extract unique time slots from products
    const timeSlotMap = new Map();

    products.forEach((product) => {
      // Get time slot key (use sale_slot or convert sale_time)
      const timeSlotKey = getProductTimeSlotKey(product);
      
      if (timeSlotKey && !timeSlotMap.has(timeSlotKey)) {
        // Format display: "HH:mm | DD/MM" using correct Vietnam time conversion
        if (product.sale_time) {
          const vnTime = getVietnamTimeFromTimestamp(product.sale_time);
          if (vnTime) {
            const hours = String(vnTime.hours).padStart(2, "0");
            const minutes = String(vnTime.minutes).padStart(2, "0");
            const day = String(vnTime.day).padStart(2, "0");
            const month = String(vnTime.month).padStart(2, "0");

            const displayTime = `${hours}:${minutes} | ${day}/${month}`;

            timeSlotMap.set(timeSlotKey, {
              start_time: timeSlotKey,
              real_time: displayTime,
            });
          }
        }
      }
    });

    // Convert map to array and sort by start_time (HHmm format)
    const getTimes = Array.from(timeSlotMap.values()).sort((a, b) => {
      return a.start_time.localeCompare(b.start_time);
    });

    // Get default get_time (latest time slot)
    const defaultGetTime =
      getTimes.length > 0 ? getTimes[getTimes.length - 1].start_time : null;

    console.log(`✅ [Server] Found ${getTimes.length} time slots`);

    res.json({
      success: true,
      data: {
        get_times: getTimes,
        default_get_time: defaultGetTime,
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

// Helper function to fetch all products from API (single request, no pagination)
async function fetchAllProductsFromAPI() {
  console.log("🔄 [Server] Fetching all products from API (single request, no pagination)...");
  
  const timeout = 60000; // 60 seconds timeout for single request
  
  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(API_BASE_DEALXK, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check if response is array (direct products) or object with products array
    let products = [];
    if (Array.isArray(data)) {
      products = data;
    } else if (data.products && Array.isArray(data.products)) {
      products = data.products;
    } else if (data.data && Array.isArray(data.data)) {
      products = data.data;
    } else {
      throw new Error("API returned invalid data format");
    }

    console.log(`✅ [Server] Fetched ${products.length} products from API (single request, no pagination)`);
    return products;
  } catch (error) {
    console.error("❌ [Server] Error fetching products from API:", error.message);
    throw error;
  }
}

// Helper to normalize price for DB & filtering
function normalizePrice(rawPrice) {
  const p = Number(rawPrice) || 0;
  if (p < 3000) return 1000; // < 3k → 1k
  if (p < 13000) return 9000; // 3k–<13k → 9k
  return p;
}

// Helper function to map product from new format to old format
function mapProductToOldFormat(product) {
  // Extract image ID from URL
  let imageId = "";
  if (product.img) {
    // Handle different URL formats
    const imgUrl = product.img;
    if (imgUrl.includes("/file/")) {
      imageId = imgUrl.split("/file/")[1] || "";
      // Remove any query parameters
      if (imageId.includes("?")) {
        imageId = imageId.split("?")[0];
      }
    } else if (imgUrl.includes("shopee.vn")) {
      // Try to extract from shopee.vn URLs
      const match = imgUrl.match(/file\/([^/?]+)/);
      if (match) {
        imageId = match[1];
      }
    }
  }

  const normalizedPrice = normalizePrice(product.price || 0);
  const normalizedOriginalPrice = normalizePrice(
    product.original_price || product.price || 0
  );

  return {
    name: product.title || "",
    price: String(normalizedPrice),
    price_before_discount: String(normalizedOriginalPrice),
    image: imageId,
    link: product.link || "",
    discount: product.percent || 0,
    stock: product.amount || 0,
    sold: product.sold || 0,
    rating_star: 0, // Not available in new API
    shop_location: "", // Not available in new API
    shop_id: product.shopid || 0,
    item_id: product.itemid || 0,
    start_time: String(product.sale_time || ""),
    // Keep original data for reference
    _original: product,
  };
}

// Helper function to clear products for a time slot
function clearProductsForTimeSlot(timeSlot) {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM products WHERE time_slot = ?", [timeSlot], (err) => {
      if (err) {
        console.error("Error clearing products:", err);
        reject(err);
      } else {
        console.log(
          `🗑️ [Server] Cleared old products for time slot ${timeSlot}`
        );
        resolve();
      }
    });
  });
}

// Helper function to save products to database (optimized with batch insert)
function saveProductsToDB(timeSlot, products) {
  return new Promise((resolve, reject) => {
    if (!products || products.length === 0) {
      resolve(0);
      return;
    }

    db.serialize(() => {
      // Begin transaction
      db.run("BEGIN TRANSACTION", (err) => {
        if (err) {
          reject(err);
          return;
        }

        const stmt = db.prepare(
          "INSERT OR REPLACE INTO products (time_slot, product_data) VALUES (?, ?)"
        );

        let inserted = 0;
        let completed = 0;
        const batchSize = 500; // Process in larger batches for better performance

        const processBatch = (startIndex) => {
          const endIndex = Math.min(startIndex + batchSize, products.length);
          
          for (let i = startIndex; i < endIndex; i++) {
            const product = products[i];
            const productJson = JSON.stringify(product);
            
            stmt.run([timeSlot, productJson], function (err) {
              if (err) {
                console.error("Error inserting product:", err);
              } else {
                inserted++;
              }
              completed++;
              
              if (completed === products.length) {
                stmt.finalize((err) => {
                  if (err) {
                    db.run("ROLLBACK");
                    reject(err);
                    return;
                  }
                  
                  // Commit transaction
                  db.run("COMMIT", (err) => {
                    if (err) {
                      console.error("Error committing transaction:", err);
                      db.run("ROLLBACK");
                      reject(err);
                    } else {
                      resolve(inserted);
                    }
                  });
                });
              } else if (completed % batchSize === 0 && completed < products.length) {
                // Process next batch asynchronously to avoid blocking
                setImmediate(() => processBatch(endIndex));
              }
            });
          }
        };

        processBatch(0);
      });
    });
  });
}

// Cache for all products to avoid refetching
let allProductsCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

// Helper function to load products for a specific time slot (optimized - only save requested time slot)
async function loadAndSaveProductsForTimeSlot(requestedTimeSlot, forceRefresh = false) {
  // Check cache first
  const now = Date.now();
  const cacheKey = `timeSlot_${requestedTimeSlot}`;
  
  if (!forceRefresh && allProductsCache && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    const cached = allProductsCache[cacheKey];
    if (cached) {
      console.log(`📦 [Server] Using cached products data for time slot ${requestedTimeSlot}`);
      return cached;
    }
  }
  
  console.log(`🔄 [Server] Loading products for time slot ${requestedTimeSlot}...`);
  
  try {
    // Fetch ALL products from API (single request, no pagination)
    const allProductsRaw = await fetchAllProductsFromAPI();
    console.log(`📦 [Server] Fetched ${allProductsRaw.length} total products from API`);
    
    // Filter products for requested time slot only
    const normalizedRequestedTimeSlot = normalizeTimeSlot(requestedTimeSlot);
    const productsForTimeSlot = allProductsRaw.filter((product) => {
      const productTimeSlotKey = getProductTimeSlotKey(product);
      return productTimeSlotKey === normalizedRequestedTimeSlot;
    });
    
    console.log(`📊 [Server] Found ${productsForTimeSlot.length} products for time slot ${normalizedRequestedTimeSlot}`);
    
    // Build time slot info map for all time slots (for get_times)
    const timeSlotInfoMap = new Map();
    allProductsRaw.forEach((product) => {
      const timeSlotKey = getProductTimeSlotKey(product);
      if (timeSlotKey && !timeSlotInfoMap.has(timeSlotKey) && product.sale_time) {
        const vnTime = getVietnamTimeFromTimestamp(product.sale_time);
        if (vnTime) {
          const hours = String(vnTime.hours).padStart(2, "0");
          const minutes = String(vnTime.minutes).padStart(2, "0");
          const day = String(vnTime.day).padStart(2, "0");
          const month = String(vnTime.month).padStart(2, "0");
          const displayTime = `${hours}:${minutes} | ${day}/${month}`;
          
          timeSlotInfoMap.set(timeSlotKey, {
            start_time: timeSlotKey,
            real_time: displayTime,
          });
        }
      }
    });
    
    // Convert time slot info map to array
    const getTimes = Array.from(timeSlotInfoMap.values()).sort((a, b) => {
      return a.start_time.localeCompare(b.start_time);
    });
    
    // Save only products for requested time slot to DB
    if (productsForTimeSlot.length > 0) {
      console.log(`💾 [Server] Saving ${productsForTimeSlot.length} products for time slot ${normalizedRequestedTimeSlot}...`);
      
      // Clear old products for this time slot
      await clearProductsForTimeSlot(normalizedRequestedTimeSlot);
      
      // Map products to old format
      const mappedProducts = productsForTimeSlot.map(mapProductToOldFormat);
      
      // Save to database
      await saveProductsToDB(normalizedRequestedTimeSlot, mappedProducts);
      console.log(`✅ [Server] Saved ${productsForTimeSlot.length} products for time slot ${normalizedRequestedTimeSlot}`);
    }
    
    const result = {
      products: productsForTimeSlot.map(mapProductToOldFormat),
      getTimes,
      defaultGetTime: getTimes.length > 0 ? getTimes[getTimes.length - 1].start_time : null,
    };
    
    // Update cache
    if (!allProductsCache) {
      allProductsCache = {};
    }
    allProductsCache[cacheKey] = result;
    cacheTimestamp = now;
    
    return result;
  } catch (error) {
    console.error("❌ [Server] Error loading and saving products:", error);
    // Return cached data if available, even if expired
    if (allProductsCache && allProductsCache[cacheKey]) {
      console.log("⚠️ [Server] Returning stale cache due to error");
      return allProductsCache[cacheKey];
    }
    throw error;
  }
}

// API: Get products from external flashsale API (with pagination)
app.get("/api/products", async (req, res) => {
  try {
    const {
      get_time,
      sort_by = "discount",
      rating_filter = "all",
      query = "",
      fs = "false",
      force_reload = "false",
    } = req.query;

    // Build API parameters
    const getTime = get_time || "";

    if (!getTime) {
      res.status(400).json({
        success: false,
        error: "get_time is required",
      });
      return;
    }

    const shouldForceReload = force_reload === "true" || force_reload === "1";
    
    // Normalize getTime to "HHmm" format for matching
    const normalizedGetTime = normalizeTimeSlot(getTime);

    // Helper function to fetch and filter products by time slot
    const fetchProductsForTimeSlot = async () => {
      console.log(`🔄 [Server] Loading products for time slot ${getTime} (normalized: ${normalizedGetTime})...`);

      // Load and save products for requested time slot only (optimized - no pagination, single API call)
      const result = await loadAndSaveProductsForTimeSlot(normalizedGetTime, shouldForceReload);
      
      console.log(
        `✅ [Server] Returning ${result.products.length} products for time slot ${normalizedGetTime}`
      );

      return {
        products: result.products,
        get_times: result.getTimes,
        default_get_time: result.defaultGetTime,
      };
    };

    // Check if products already exist in DB for this time slot (unless force reload)
    // Use normalized time slot for DB query
    if (!shouldForceReload) {
      db.all(
        "SELECT product_data FROM products WHERE time_slot = ?",
        [normalizedGetTime],
        async (err, rows) => {
          if (err) {
            console.error("Error checking DB for products:", err);
            // Continue to fetch from API
            const result = await fetchProductsForTimeSlot();
            res.json({
              success: true,
              data: {
                products: result.products,
                get_times: result.get_times,
                default_get_time: result.default_get_time,
                has_more: false,
                from_cache: false,
              },
            });
          } else if (rows && rows.length > 0) {
            // Products exist in DB, return them
            console.log(
              `✅ [Server] Found ${rows.length} products in DB for time slot ${normalizedGetTime}`
            );
            // Normalize price fields when loading from DB so filter & UI dùng đúng rule
            const products = rows.map((row) => {
              const p = JSON.parse(row.product_data);
              if (p && typeof p === "object") {
                if (p.price !== undefined) {
                  p.price = String(normalizePrice(p.price));
                }
                if (p.price_before_discount !== undefined) {
                  p.price_before_discount = String(
                    normalizePrice(p.price_before_discount)
                  );
                }
              }
              return p;
            });

            // Get get_times from API
            try {
              const allProductsRaw = await fetchAllProductsFromAPI();
              const timeSlotMap = new Map();
              allProductsRaw.forEach((product) => {
                // Use getProductTimeSlotKey to get consistent time slot key
                const timeSlotKey = getProductTimeSlotKey(product);
                if (timeSlotKey && !timeSlotMap.has(timeSlotKey)) {
                  // Use correct Vietnam time conversion
                  if (product.sale_time) {
                    const vnTime = getVietnamTimeFromTimestamp(product.sale_time);
                    if (vnTime) {
                      const hours = String(vnTime.hours).padStart(2, "0");
                      const minutes = String(vnTime.minutes).padStart(2, "0");
                      const day = String(vnTime.day).padStart(2, "0");
                      const month = String(vnTime.month).padStart(2, "0");

                      const displayTime = `${hours}:${minutes} | ${day}/${month}`;

                      timeSlotMap.set(timeSlotKey, {
                        start_time: timeSlotKey,
                        real_time: displayTime,
                      });
                    }
                  }
                }
              });

              const getTimes = Array.from(timeSlotMap.values()).sort((a, b) => {
                return a.start_time.localeCompare(b.start_time);
              });

              const defaultGetTime =
                getTimes.length > 0
                  ? getTimes[getTimes.length - 1].start_time
                  : null;

              res.json({
                success: true,
                data: {
                  products: products,
                  get_times: getTimes,
                  default_get_time: defaultGetTime,
                  has_more: false,
                  from_cache: true,
                },
              });
            } catch (error) {
              console.error("Error fetching get_times:", error);
              // Return products from DB anyway
              res.json({
                success: true,
                data: {
                  products: products,
                  get_times: [],
                  default_get_time: null,
                  has_more: false,
                  from_cache: true,
                },
              });
            }
          } else {
            // Products not in DB, fetch from API
            const result = await fetchProductsForTimeSlot();
            res.json({
              success: true,
              data: {
                products: result.products,
                get_times: result.get_times,
                default_get_time: result.default_get_time,
                has_more: false,
                from_cache: false,
              },
            });
          }
        }
      );
    } else {
      // Force reload: fetch from API
      const result = await fetchProductsForTimeSlot();
      res.json({
        success: true,
        data: {
          products: result.products,
          get_times: result.get_times,
          default_get_time: result.default_get_time,
          has_more: false,
          from_cache: false,
        },
      });
    }
  } catch (error) {
    console.error("❌ [Server] Error fetching products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch products",
    });
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
